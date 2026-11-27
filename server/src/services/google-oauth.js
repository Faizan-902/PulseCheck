import { createHash, createPublicKey, verify } from 'node:crypto';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const VALID_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export function createPkceChallenge(codeVerifier) {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

export function buildGoogleAuthorizationUrl({
  clientId,
  redirectUri,
  state,
  nonce,
  codeChallenge
}) {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  return url.href;
}

function decodeJwtPart(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function parseMaxAge(cacheControl) {
  const match = cacheControl?.match(/max-age=(\d+)/i);
  return match ? Number(match[1]) * 1000 : 5 * 60 * 1000;
}

export function createGoogleOAuthClient({
  clientId,
  clientSecret,
  fetchImpl = globalThis.fetch
}) {
  let jwksCache = { keys: [], expiresAt: 0 };

  async function fetchJwks() {
    const response = await fetchImpl(GOOGLE_JWKS_ENDPOINT, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      throw new Error(`Google JWKS fetch failed (${response.status})`);
    }
    const body = await response.json();
    if (!Array.isArray(body?.keys)) {
      throw new Error('Google JWKS response is invalid.');
    }
    jwksCache = {
      keys: body.keys,
      expiresAt: Date.now() + parseMaxAge(response.headers?.get?.('cache-control'))
    };
    return jwksCache.keys;
  }

  async function findSigningKey(kid) {
    if (Date.now() < jwksCache.expiresAt) {
      const cached = jwksCache.keys.find((key) => key.kid === kid && key.kty === 'RSA');
      if (cached) return cached;
    }
    const keys = await fetchJwks();
    return keys.find((key) => key.kid === kid && key.kty === 'RSA') ?? null;
  }

  async function verifyIdToken(idToken, expectedNonce) {
    if (typeof idToken !== 'string') throw new Error('Missing Google ID token.');
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Invalid Google ID token format.');

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJwtPart(encodedHeader);
    if (header?.alg !== 'RS256' || typeof header?.kid !== 'string') {
      throw new Error('Unsupported Google ID token algorithm.');
    }

    const jwk = await findSigningKey(header.kid);
    if (!jwk) throw new Error('Matching Google signing key not found.');

    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    const isValidSignature = verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      publicKey,
      Buffer.from(encodedSignature, 'base64url')
    );
    if (!isValidSignature) throw new Error('Invalid Google ID token signature.');

    const payload = decodeJwtPart(encodedPayload);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!VALID_ISSUERS.has(payload?.iss)) throw new Error('Invalid Google token issuer.');
    if (payload?.aud !== clientId) throw new Error('Invalid Google token audience.');
    if (!Number.isFinite(payload?.exp) || payload.exp <= nowSec) throw new Error('Google token expired.');
    if (payload?.nonce !== expectedNonce) throw new Error('Invalid Google token nonce.');
    if (payload?.email_verified !== true) throw new Error('Google email is not verified.');
    if (typeof payload?.sub !== 'string' || !payload.sub) throw new Error('Missing Google subject.');
    if (typeof payload?.email !== 'string' || !payload.email.trim()) {
      throw new Error('Missing Google email.');
    }

    const email = payload.email.trim().toLowerCase();
    const rawName = typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : email.split('@')[0];

    return {
      sub: payload.sub,
      email,
      name: rawName.slice(0, 100)
    };
  }

  return {
    clientId,

    authorizationUrl({ redirectUri, state, nonce, codeChallenge }) {
      return buildGoogleAuthorizationUrl({ clientId, redirectUri, state, nonce, codeChallenge });
    },

    async exchangeCodeForUser({ code, codeVerifier, redirectUri, expectedNonce }) {
      const params = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code'
      });

      const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        throw new Error(`Google token exchange failed (${response.status})`);
      }
      const tokenPayload = await response.json();
      return verifyIdToken(tokenPayload?.id_token, expectedNonce);
    }
  };
}
