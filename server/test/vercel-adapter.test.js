import express from 'express';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { pool } from '../src/runtime.js';
import apiHandler, { createApiHandler } from '../../api/index.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

afterAll(async () => {
  await pool.end();
});

function captureRequestApp() {
  const app = express();
  app.use(express.json());
  app.use((request, response) => {
    response.status(202).json({
      method: request.method,
      path: request.path,
      query: request.query,
      cookie: request.get('cookie'),
      body: request.body
    });
  });
  return app;
}

describe('Vercel Express adapter', () => {
  it('preserves the original API path, query, method, cookies, and JSON body', async () => {
    const app = captureRequestApp();
    const handler = createApiHandler({ loadApp: async () => app });
    const response = await request(handler)
      .post('/api/index?__pulsecheck_path=endpoints%2Fabc%2Fchecks&limit=10&status=DOWN')
      .set('Cookie', 'pulsecheck_session=test-session')
      .send({ includeFailures: true });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      method: 'POST',
      path: '/api/endpoints/abc/checks',
      query: { limit: '10', status: 'DOWN' },
      cookie: 'pulsecheck_session=test-session',
      body: { includeFailures: true }
    });
  });

  it('shares one Express runtime initialization across concurrent cold-start requests', async () => {
    const app = captureRequestApp();
    const loadApp = vi.fn(async () => app);
    const handler = createApiHandler({ loadApp });

    const responses = await Promise.all([
      request(handler).get('/api/index?__pulsecheck_path=health'),
      request(handler).get('/api/index?__pulsecheck_path=auth%2Fme')
    ]);

    expect(responses.map(({ status }) => status)).toEqual([202, 202]);
    expect(loadApp).toHaveBeenCalledTimes(1);
  });

  it('restores unknown API paths and returns Express JSON 404 instead of SPA HTML', async () => {
    const response = await request(apiHandler)
      .get('/api/index?__pulsecheck_path=__vercel_adapter_test__&probe=1');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('serves the real health route through the adapter and verifies the configured PostgreSQL connection', async () => {
    const response = await request(apiHandler)
      .get('/api/index?__pulsecheck_path=health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.data).toEqual({ status: 'ok', database: 'ok' });
  });

  it('rejects duplicate or unsafe internal path parameters', async () => {
    const handler = createApiHandler({ loadApp: async () => captureRequestApp() });
    const duplicate = await request(handler)
      .get('/api/index?__pulsecheck_path=health&__pulsecheck_path=auth%2Fme');
    const traversal = await request(handler)
      .get('/api/index?__pulsecheck_path=..%2Fauth%2Fme');

    for (const response of [duplicate, traversal]) {
      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body.error.code).toBe('INVALID_API_PATH');
    }
  });

  it('reports invalid environment configuration distinctly without exposing values', async () => {
    const logger = { error: vi.fn() };
    const handler = createApiHandler({
      loadApp: async () => {
        throw Object.assign(new Error('PGPASSWORD=do-not-log'), {
          name: 'EnvironmentConfigurationError',
          code: 'INVALID_ENVIRONMENT_CONFIGURATION',
          invalidVariables: ['PGHOST', 'PGDATABASE']
        });
      },
      logger
    });
    const response = await request(handler)
      .get('/api/index?__pulsecheck_path=health');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('API_CONFIGURATION_ERROR');
    expect(response.text).not.toContain('do-not-log');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('do-not-log');
    expect(logger.error.mock.calls[0][1]).toEqual({
      category: 'configuration',
      errorName: 'EnvironmentConfigurationError',
      errorCode: 'INVALID_ENVIRONMENT_CONFIGURATION',
      invalidVariables: ['PGHOST', 'PGDATABASE']
    });
  });

  it('reports dependency and generic initialization failures as separate safe JSON errors', async () => {
    const cases = [
      { error: Object.assign(new Error('native loader details'), { code: 'ERR_DLOPEN_FAILED' }), code: 'API_DEPENDENCY_ERROR' },
      { error: new Error('internal details'), code: 'API_INITIALIZATION_ERROR' }
    ];

    for (const testCase of cases) {
      const logger = { error: vi.fn() };
      const handler = createApiHandler({ loadApp: async () => { throw testCase.error; }, logger });
      const response = await request(handler).get('/api/index?__pulsecheck_path=health');

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe(testCase.code);
      expect(response.text).not.toContain('details');
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('details');
    }
  });

  it('routes API requests before the SPA fallback', async () => {
    const config = JSON.parse(await readFile(resolve(repositoryRoot, 'vercel.json'), 'utf8'));

    expect(config.rewrites[0]).toEqual({
      source: '/api/:path*',
      destination: '/api/index?__pulsecheck_path=:path*'
    });
    expect(config.rewrites[1]).toEqual({
      source: '/(.*)',
      destination: '/index.html'
    });
  });
});
