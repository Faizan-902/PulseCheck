import app from '../server/src/runtime.js';

const INTERNAL_PATH_PARAM = '__pulsecheck_path';

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

export default function handler(request, response) {
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

  // vercel.json forwards /api/<original-path> to this fixed function route.
  // Restore the application path while preserving the caller's query parameters.
  incomingUrl.searchParams.delete(INTERNAL_PATH_PARAM);
  const query = incomingUrl.searchParams.toString();
  request.url = `/api/${routePath}${query ? `?${query}` : ''}`;

  return app(request, response);
}
