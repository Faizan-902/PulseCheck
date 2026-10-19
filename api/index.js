const INTERNAL_PATH_PARAM = '__pulsecheck_path';
const DEPENDENCY_ERROR_CODES = new Set([
  'ERR_DLOPEN_FAILED',
  'ERR_MODULE_NOT_FOUND',
  'ERR_REQUIRE_ESM',
  'MODULE_NOT_FOUND'
]);

function sendJson(response, status, code, message) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify({ error: { code, message } }));
}

function classifyInitializationError(error) {
  if (error?.code === 'INVALID_ENVIRONMENT_CONFIGURATION') {
    return {
      code: 'API_CONFIGURATION_ERROR',
      message: 'PulseCheck API configuration is incomplete or invalid.',
      category: 'configuration'
    };
  }

  if (DEPENDENCY_ERROR_CODES.has(error?.code)) {
    return {
      code: 'API_DEPENDENCY_ERROR',
      message: 'A required PulseCheck API runtime dependency could not be loaded.',
      category: 'dependency'
    };
  }

  return {
    code: 'API_INITIALIZATION_ERROR',
    message: 'PulseCheck API could not initialize.',
    category: 'initialization'
  };
}

function logInitializationFailure(logger, error, classification) {
  const diagnostic = {
    category: classification.category,
    errorName: /^[A-Za-z][A-Za-z0-9]*$/.test(error?.name || '') ? error.name : 'Error'
  };

  if (typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)) {
    diagnostic.errorCode = error.code;
  }

  if (classification.category === 'configuration' && Array.isArray(error.invalidVariables)) {
    diagnostic.invalidVariables = error.invalidVariables.filter(
      (name) => typeof name === 'string' && /^[A-Z][A-Z0-9_]*$/.test(name)
    );
  }

  // Do not log exception messages or stacks; they can contain connection data.
  logger.error('PulseCheck API initialization failed', diagnostic);
}

function badRequest(response) {
  sendJson(response, 400, 'INVALID_API_PATH', 'The API request path could not be resolved.');
}

export function createApiHandler({
  loadApp = async () => (await import('../server/src/runtime.js')).default,
  logger = console
} = {}) {
  let appPromise;

  return async function handler(request, response) {
    let incomingUrl;
    try {
      incomingUrl = new URL(request.url || '/', 'http://vercel.internal');
    } catch {
      return badRequest(response);
    }

    const pathValues = incomingUrl.searchParams.getAll(INTERNAL_PATH_PARAM);
    if (pathValues.length !== 1) return badRequest(response);

    const routePath = pathValues[0];
    if (
      !routePath ||
      routePath.length > 2048 ||
      routePath.startsWith('/') ||
      routePath.includes('\\') ||
      routePath.includes('\0') ||
      routePath.includes('?') ||
      routePath.includes('#') ||
      routePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      return badRequest(response);
    }

    incomingUrl.searchParams.delete(INTERNAL_PATH_PARAM);
    const query = incomingUrl.searchParams.toString();
    const encodedPath = routePath.split('/').map(encodeURIComponent).join('/');
    request.url = `/api/${encodedPath}${query ? `?${query}` : ''}`;

    try {
      appPromise ??= Promise.resolve().then(loadApp);
      const app = await appPromise;
      return app(request, response);
    } catch (error) {
      const classification = classifyInitializationError(error);
      logInitializationFailure(logger, error, classification);
      appPromise = undefined;
      return sendJson(response, 503, classification.code, classification.message);
    }
  };
}

export default createApiHandler();
