const INTERNAL_PATH_PARAM = '__pulsecheck_path';
let appPromise;

function badRequest(response) {
  response.statusCode = 400;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({
    error: {
      code: 'INVALID_API_PATH',
      message: 'The API request path could not be resolved.'
    }
  }));
}

function apiUnavailable(response) {
  response.statusCode = 503;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify({
    error: {
      code: 'API_UNAVAILABLE',
      message: 'PulseCheck API is not configured or is temporarily unavailable.'
    }
  }));
}

export default async function handler(request, response) {
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
    routePath.startsWith('/') ||
    routePath.includes('\\') ||
    routePath.includes('\0') ||
    routePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return badRequest(response);
  }

  incomingUrl.searchParams.delete(INTERNAL_PATH_PARAM);
  const query = incomingUrl.searchParams.toString();
  request.url = `/api/${routePath}${query ? `?${query}` : ''}`;

  try {
    // Lazy loading lets the function return a JSON setup error if required
    // server-side environment variables are missing at deployment time.
    appPromise ??= import('../server/src/runtime.js').then((module) => module.default);
    const app = await appPromise;
    return app(request, response);
  } catch (error) {
    // Log the error class only; never log configuration values or credentials.
    console.error('PulseCheck API initialization failed:', error?.name ?? 'UnknownError');
    appPromise = undefined;
    return apiUnavailable(response);
  }
}
