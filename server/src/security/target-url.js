import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home.arpa',
  '.test',
  '.example',
  '.invalid'
];

export class TargetValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetValidationError';
    this.code = code;
  }
}

function normalizeHostname(hostname) {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

function isPublicAddress(address) {
  try {
    const parsed = ipaddr.parse(address);
    // Reject mapped IPv4 in IPv6 form to prevent address-family filter bypasses.
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) return false;
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

function assertPublicAddress(address) {
  if (!isPublicAddress(address)) {
    throw new TargetValidationError(
      'UNSAFE_TARGET',
      'The endpoint resolves to a private, reserved, or otherwise non-public IP address.'
    );
  }
}

export async function validateTargetUrl(rawUrl, resolver = (hostname) => dns.lookup(hostname, {
  all: true,
  verbatim: true
})) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TargetValidationError('INVALID_URL', 'The endpoint URL is invalid.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TargetValidationError('INVALID_URL', 'Only HTTP and HTTPS endpoint URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new TargetValidationError('INVALID_URL', 'Endpoint URLs cannot contain credentials.');
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))) {
    throw new TargetValidationError('UNSAFE_TARGET', 'Local and internal hostnames are not allowed.');
  }

  try {
    const literal = ipaddr.parse(hostname);
    assertPublicAddress(literal.toString());
    const family = literal.kind() === 'ipv4' ? 4 : 6;
    return { url, hostname, addresses: [{ address: literal.toString(), family }] };
  } catch (error) {
    if (error instanceof TargetValidationError) throw error;
    // Non-IP hostnames are resolved below.
  }

  let addresses;
  try {
    addresses = await resolver(hostname);
  } catch (error) {
    const dnsError = new TargetValidationError('DNS_ERROR', 'The endpoint hostname could not be resolved.');
    dnsError.cause = error;
    throw dnsError;
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new TargetValidationError('DNS_ERROR', 'The endpoint hostname did not resolve to an IP address.');
  }

  // Reject the entire hostname if even one answer is private/reserved; mixed DNS answers
  // could otherwise make the result dependent on address selection or a rebinding race.
  for (const record of addresses) assertPublicAddress(record.address);

  return {
    url,
    hostname,
    addresses: addresses.map(({ address, family }) => ({
      address: ipaddr.parse(address).toString(),
      family: family ?? (ipaddr.parse(address).kind() === 'ipv4' ? 4 : 6)
    }))
  };
}

export function createPinnedDispatcher(hostname, addresses) {
  const expectedHostname = normalizeHostname(hostname);
  const lookup = (requestedHostname, options, callback) => {
    if (normalizeHostname(requestedHostname) !== expectedHostname) {
      callback(new TargetValidationError('UNSAFE_TARGET', 'The connection hostname changed unexpectedly.'));
      return;
    }

    const matchingAddresses = addresses.filter((record) => !options?.family || record.family === options.family);
    if (matchingAddresses.length === 0) {
      callback(new Error('No validated address is available for this connection family.'));
      return;
    }

    if (options?.all) {
      callback(null, matchingAddresses);
    } else {
      callback(null, matchingAddresses[0].address, matchingAddresses[0].family);
    }
  };

  return new Agent({ connect: { lookup } });
}
