import express from 'express';
import { createEndpointsRouter } from './routes/endpoints.js';
import { createHealthRouter } from './routes/health.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { performHealthCheck } from './services/health-check.js';

export function createApp({ model, resolver, defaultTimeoutMs = 5000, checkEndpoint = performHealthCheck, frontendOrigin = 'http://localhost:5173' }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    const isAllowedOrigin = request.headers.origin === frontendOrigin;
    if (isAllowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', frontendOrigin);
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.sendStatus(isAllowedOrigin ? 204 : 403);
      return;
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/health', createHealthRouter(model));
  app.use('/api/endpoints', createEndpointsRouter({ model, checkEndpoint, resolver, defaultTimeoutMs }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
