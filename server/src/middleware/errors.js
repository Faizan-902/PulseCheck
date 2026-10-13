export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export function notFoundHandler(_request, _response, next) {
  next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'));
}

export function errorHandler(error, _request, response, _next) {
  if (error?.name === 'ZodError') {
    response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request is invalid.',
        details: error.issues.map(({ path, message }) => ({ path: path.join('.'), message }))
      }
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message }
    });
    return;
  }

  if (error?.name === 'TargetValidationError') {
    const status = ['DNS_ERROR', 'UNSAFE_TARGET'].includes(error.code) ? 422 : 400;
    response.status(status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  if (error?.type === 'entity.parse.failed') {
    response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
    return;
  }

  if (error?.type === 'entity.too.large') {
    response.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'Request body is too large.' } });
    return;
  }

  console.error('Unhandled API error:', error?.message ?? error);
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred.' } });
}
