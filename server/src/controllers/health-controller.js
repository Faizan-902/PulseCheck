export function createHealthController(model) {
  return async (_request, response) => {
    try {
      await model.ping();
      response.json({ data: { status: 'ok', database: 'ok' } });
    } catch {
      response.status(503).json({
        error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable.' }
      });
    }
  };
}
