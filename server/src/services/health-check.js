import { performance } from 'node:perf_hooks';
import { createPinnedDispatcher, TargetValidationError, validateTargetUrl } from '../security/target-url.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function isTimeoutError(error) {
  return error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(error?.code);
}

function classifyError(error, signal) {
  if (signal.aborted || isTimeoutError(error)) return 'TIMEOUT';
  if (error instanceof TargetValidationError) {
    if (error.code === 'DNS_ERROR') return 'DNS_ERROR';
    if (error.code === 'REDIRECT_ERROR') return 'REDIRECT_ERROR';
    return 'UNSAFE_TARGET';
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NONAME', 'EAI_ADDRFAMILY'].includes(error?.code)) {
    return 'DNS_ERROR';
  }
  return 'NETWORK_ERROR';
}

function makeTimeoutError() {
  const error = new Error('The endpoint check timed out.');
  error.name = 'TimeoutError';
  return error;
}

async function closeDispatcher(dispatcher, destroy = false) {
  try {
    if (destroy) await dispatcher.destroy();
    else await dispatcher.close();
  } catch {
    // A failed or timed-out socket may already have been destroyed by fetch.
  }
}

async function fetchWithoutFollowingUnvalidatedRedirects({ endpoint, fetchImpl, resolver, signal, onStatus }) {
  let currentUrl = new URL(endpoint.url);
  let redirects = 0;

  while (true) {
    if (signal.aborted) throw signal.reason ?? makeTimeoutError();

    const target = await validateTargetUrl(currentUrl.href, resolver);
    if (signal.aborted) throw signal.reason ?? makeTimeoutError();

    const dispatcher = createPinnedDispatcher(target.hostname, target.addresses);
    let response;
    try {
      response = await fetchImpl(target.url.href, {
        method: 'GET',
        redirect: 'manual',
        signal,
        dispatcher,
        headers: { 'user-agent': 'PulseCheck/1.0', accept: '*/*' }
      });
      onStatus(response.status);

      // PulseCheck only needs response headers and status; cancel the body immediately.
      if (response.body && typeof response.body.cancel === 'function') {
        await response.body.cancel().catch(() => {});
      }
    } catch (error) {
      await closeDispatcher(dispatcher, true);
      throw error;
    }
    await closeDispatcher(dispatcher);

    const location = response.headers?.get?.('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) return response.status;

    if (redirects >= MAX_REDIRECTS) {
      throw new TargetValidationError('REDIRECT_ERROR', 'The endpoint redirected too many times.');
    }

    const nextUrl = new URL(location, currentUrl);
    if (currentUrl.protocol === 'https:' && nextUrl.protocol === 'http:') {
      throw new TargetValidationError('REDIRECT_ERROR', 'HTTPS endpoints cannot redirect to HTTP.');
    }

    // The next loop iteration resolves and pins the new destination before connecting.
    currentUrl = nextUrl;
    redirects += 1;
  }
}

export async function performHealthCheck(endpoint, {
  fetchImpl = globalThis.fetch,
  resolver
} = {}) {
  const startedAt = performance.now();
  const timeoutMs = endpoint.timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  let httpStatus = null;
  let timeoutListener;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutListener = () => reject(signal.reason ?? makeTimeoutError());
    signal.addEventListener('abort', timeoutListener, { once: true });
    if (signal.aborted) timeoutListener();
  });

  try {
    const requestPromise = fetchWithoutFollowingUnvalidatedRedirects({
      endpoint,
      fetchImpl,
      resolver,
      signal,
      onStatus: (status) => { httpStatus = status; }
    });
    httpStatus = await Promise.race([requestPromise, timeoutPromise]);

    const isUp = httpStatus >= 200 && httpStatus < 500;
    return {
      status: isUp ? 'UP' : 'DOWN',
      httpStatus,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      errorType: isUp ? null : 'HTTP_ERROR'
    };
  } catch (error) {
    return {
      status: 'DOWN',
      httpStatus,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      errorType: classifyError(error, signal)
    };
  } finally {
    signal.removeEventListener('abort', timeoutListener);
  }
}
