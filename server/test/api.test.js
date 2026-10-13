import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';

const endpointId = '1d7f9e6e-2dce-4e1a-8930-9651dfbd4b7c';
const checkId = 'ae2dad26-3305-411e-91f0-08d04fc8c2e5';
const ownerId = 'abbbd2e1-564d-4d4d-8e76-795c78ca2729';
const sessionHash = createHash('sha256').update('test-session').digest('hex');
const frontendOrigin = 'http://localhost:5173';
const publicResolver = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
let testApp;

function makeRepository() {
  const endpoints = new Map();
  const checks = [];

  return {
    ping: vi.fn(async () => {}),
    createEndpoint: vi.fn(async (values) => {
      const endpoint = {
        id: endpointId,
        ...values,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z'
      };
      endpoints.set(endpoint.id, endpoint);
      return endpoint;
    }),
    listEndpoints: vi.fn(async (userId) => [...endpoints.values()].filter((endpoint) => endpoint.ownerId === userId)),
    findEndpointById: vi.fn(async (id, userId) => {
      const endpoint = endpoints.get(id);
      return endpoint?.ownerId === userId ? endpoint : null;
    }),
    deleteEndpoint: vi.fn(async (id, userId) => {
      const endpoint = endpoints.get(id);
      if (endpoint?.ownerId !== userId) return false;
      endpoints.delete(id);
      return true;
    }),
    createCheck: vi.fn(async (values) => {
      const check = {
        id: checkId,
        endpointId: values.endpointId,
        checkedAt: '2026-01-01T00:01:00.000Z',
        status: values.status,
        httpStatus: values.httpStatus,
        latencyMs: values.latencyMs,
        errorType: values.errorType
      };
      checks.unshift(check);
      return check;
    }),
    listChecks: vi.fn(async (id, limit) => checks.filter((check) => check.endpointId === id).slice(0, limit)),
    listIncidents: vi.fn(async () => [])
  };
}

function makeAuthModel() {
  return {
    findSessionByTokenHash: vi.fn(async (tokenHash) => tokenHash === sessionHash
      ? { userId: ownerId, name: 'Test User', email: 'test@example.com', csrfToken: 'test-csrf' }
      : null)
  };
}

function apiRequestFor(method, path) {
  let call = request(testApp)[method](path)
    .set('Cookie', 'pulsecheck_session=test-session')
    .set('Origin', frontendOrigin);
  if (['post', 'put', 'patch', 'delete'].includes(method)) call = call.set('X-CSRF-Token', 'test-csrf');
  return call;
}

describe('PulseCheck API', () => {
  let repository;
  let app;
  let checkEndpoint;
  let authModel;

  beforeEach(() => {
    repository = makeRepository();
    authModel = makeAuthModel();
    publicResolver.mockClear();
    checkEndpoint = vi.fn(async () => ({
      status: 'UP',
      httpStatus: 200,
      latencyMs: 41,
      errorType: null
    }));
    app = createApp({
      model: repository,
      authModel,
      resolver: publicResolver,
      checkEndpoint,
      defaultTimeoutMs: 5000,
      frontendOrigin
    });
    testApp = app;
  });

  it('reports API and database health', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: 'ok', database: 'ok' } });
  });

  it('returns 503 when the database health query fails', async () => {
    repository.ping.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
  });

  it('rejects invalid request data with a consistent validation response', async () => {
    const response = await apiRequestFor('post', '/api/endpoints')
      .send({ name: '', url: 'ftp://api.example.com/health' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.length).toBeGreaterThan(0);
    expect(repository.createEndpoint).not.toHaveBeenCalled();
  });

  it('rejects a hostname that resolves to a private address', async () => {
    const appWithPrivateResolver = createApp({
      model: repository,
      authModel,
      frontendOrigin,
      resolver: async () => [{ address: '10.0.0.8', family: 4 }]
    });

    const response = await request(appWithPrivateResolver)
      .post('/api/endpoints')
      .set('Cookie', 'pulsecheck_session=test-session')
      .set('Origin', frontendOrigin)
      .set('X-CSRF-Token', 'test-csrf')
      .send({ name: 'Internal API', url: 'https://api.example.com/health' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNSAFE_TARGET');
    expect(repository.createEndpoint).not.toHaveBeenCalled();
  });

  it('creates an endpoint and uses the configured default timeout', async () => {
    const response = await apiRequestFor('post', '/api/endpoints')
      .send({ name: 'Public API', url: 'https://api.example.com/health' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      id: endpointId,
      name: 'Public API',
      url: 'https://api.example.com/health',
      timeoutMs: 5000,
      checkIntervalSeconds: 300,
      isActive: true
    });
    expect(repository.createEndpoint).toHaveBeenCalledWith({
      ownerId,
      name: 'Public API',
      url: 'https://api.example.com/health',
      timeoutMs: 5000,
      checkIntervalSeconds: 300
    });
    expect(publicResolver).toHaveBeenCalledWith('api.example.com');
  });

  it('rejects a check interval outside the supported range', async () => {
    const response = await apiRequestFor('post', '/api/endpoints')
      .send({ name: 'Public API', url: 'https://api.example.com/health', checkIntervalSeconds: 5 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(repository.createEndpoint).not.toHaveBeenCalled();
  });

  it('returns incident history for an endpoint', async () => {
    await apiRequestFor('post', '/api/endpoints').send({
      name: 'Public API', url: 'https://api.example.com/health'
    });
    const response = await apiRequestFor('get', `/api/endpoints/${endpointId}/incidents`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [] });
    expect(repository.listIncidents).toHaveBeenCalledWith(endpointId, ownerId);
  });

  it('runs and persists a successful manual check', async () => {
    await apiRequestFor('post', '/api/endpoints').send({
      name: 'Public API',
      url: 'https://api.example.com/health'
    });

    const response = await apiRequestFor('post', `/api/endpoints/${endpointId}/check`);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      endpointId,
      status: 'UP',
      httpStatus: 200,
      latencyMs: 41,
      errorType: null
    });
    expect(checkEndpoint).toHaveBeenCalled();
    expect(repository.createCheck).toHaveBeenCalledWith({
      endpointId,
      ownerId,
      status: 'UP',
      httpStatus: 200,
      latencyMs: 41,
      errorType: null
    });
  });

  it('persists failed checks and exposes them in endpoint history', async () => {
    await apiRequestFor('post', '/api/endpoints').send({
      name: 'Public API',
      url: 'https://api.example.com/health'
    });
    checkEndpoint.mockResolvedValueOnce({
      status: 'DOWN',
      httpStatus: null,
      latencyMs: 5000,
      errorType: 'TIMEOUT'
    });

    const checkResponse = await apiRequestFor('post', `/api/endpoints/${endpointId}/check`);
    const historyResponse = await apiRequestFor('get', `/api/endpoints/${endpointId}/checks`);

    expect(checkResponse.status).toBe(201);
    expect(checkResponse.body.data).toMatchObject({ status: 'DOWN', errorType: 'TIMEOUT' });
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.data[0]).toMatchObject({
      endpointId,
      status: 'DOWN',
      latencyMs: 5000,
      errorType: 'TIMEOUT'
    });
  });

  it('returns 404 for a valid but missing endpoint ID', async () => {
    const missingId = 'b03462a2-c797-487d-81c3-f96860abc311';
    const response = await apiRequestFor('post', `/api/endpoints/${missingId}/check`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ENDPOINT_NOT_FOUND');
    expect(checkEndpoint).not.toHaveBeenCalled();
  });

  it('deletes an owned monitor and requires ownership and CSRF protection', async () => {
    await apiRequestFor('post', '/api/endpoints').send({
      name: 'Delete target', url: 'https://api.example.com/health'
    });

    const missingCsrf = await request(app)
      .delete(`/api/endpoints/${endpointId}`)
      .set('Cookie', 'pulsecheck_session=test-session')
      .set('Origin', frontendOrigin);
    expect(missingCsrf.status).toBe(403);

    const otherUserApp = createApp({
      model: repository,
      authModel: { findSessionByTokenHash: vi.fn(async () => ({ userId: '35de2362-1c2f-42ab-8bb6-b56ce8e0e9f2', name: 'Other', email: 'other@example.com', csrfToken: 'other-csrf' })) },
      frontendOrigin
    });
    const forbiddenByOwnership = await request(otherUserApp)
      .delete(`/api/endpoints/${endpointId}`)
      .set('Cookie', 'pulsecheck_session=other-session')
      .set('Origin', frontendOrigin)
      .set('X-CSRF-Token', 'other-csrf');
    expect(forbiddenByOwnership.status).toBe(404);
    expect(repository.deleteEndpoint).toHaveBeenCalledWith(endpointId, '35de2362-1c2f-42ab-8bb6-b56ce8e0e9f2');

    const deleted = await apiRequestFor('delete', `/api/endpoints/${endpointId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ data: { deleted: true } });
    expect(repository.deleteEndpoint).toHaveBeenLastCalledWith(endpointId, ownerId);
    await expect(repository.findEndpointById(endpointId, ownerId)).resolves.toBeNull();

    const repeated = await apiRequestFor('delete', `/api/endpoints/${endpointId}`);
    expect(repeated.status).toBe(404);
    expect(repeated.body.error.code).toBe('ENDPOINT_NOT_FOUND');
  });

  it('matches DELETE route and returns an owner-scoped 404 for a nonexistent monitor ID', async () => {
    const missing = await apiRequestFor('delete', '/api/endpoints/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toEqual({
      code: 'ENDPOINT_NOT_FOUND',
      message: 'The endpoint was not found.'
    });
  });

  it('distinguishes an unmatched DELETE path from an owner-scoped missing monitor', async () => {
    const response = await apiRequestFor('delete', `/api/endpoints/${endpointId}/unknown`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(repository.deleteEndpoint).not.toHaveBeenCalled();
  });

  it('returns a safe server error when the database delete fails', async () => {
    repository.deleteEndpoint.mockRejectedValueOnce(new Error('database connection detail'));
    const failed = await apiRequestFor('delete', `/api/endpoints/${endpointId}`);
    expect(failed.status).toBe(500);
    expect(failed.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An internal error occurred.' });
  });

  it('requires a session and hides endpoints owned by another user', async () => {
    const unauthorized = await request(app).get('/api/endpoints');
    expect(unauthorized.status).toBe(401);

    await apiRequestFor('post', '/api/endpoints').send({ name: 'Owned API', url: 'https://api.example.com/health' });
    const list = await apiRequestFor('get', '/api/endpoints');
    expect(list.status).toBe(200);
    expect(list.headers['cache-control']).toBe('no-store');
    expect(list.body.data).toHaveLength(1);
    expect(repository.listEndpoints).toHaveBeenCalledWith(ownerId);

    const otherUserApp = createApp({
      model: repository,
      authModel: { findSessionByTokenHash: vi.fn(async () => ({ userId: '35de2362-1c2f-42ab-8bb6-b56ce8e0e9f2', name: 'Other', email: 'other@example.com', csrfToken: 'other-csrf' })) },
      frontendOrigin,
      resolver: publicResolver
    });
    const endpointResponse = await request(otherUserApp)
      .get(`/api/endpoints/${endpointId}`)
      .set('Cookie', 'pulsecheck_session=other-session');
    const checkResponse = await request(otherUserApp)
      .post(`/api/endpoints/${endpointId}/check`)
      .set('Cookie', 'pulsecheck_session=other-session')
      .set('Origin', frontendOrigin)
      .set('X-CSRF-Token', 'other-csrf');
    const historyResponse = await request(otherUserApp)
      .get(`/api/endpoints/${endpointId}/checks`)
      .set('Cookie', 'pulsecheck_session=other-session');
    const incidentResponse = await request(otherUserApp)
      .get(`/api/endpoints/${endpointId}/incidents`)
      .set('Cookie', 'pulsecheck_session=other-session');
    for (const response of [endpointResponse, checkResponse, historyResponse, incidentResponse]) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ENDPOINT_NOT_FOUND');
    }
    expect(checkEndpoint).not.toHaveBeenCalled();
  });

  it('requires a CSRF token for endpoint mutations', async () => {
    const response = await request(app)
      .post('/api/endpoints')
      .set('Cookie', 'pulsecheck_session=test-session')
      .set('Origin', frontendOrigin)
      .send({ name: 'Public API', url: 'https://api.example.com/health' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_INVALID');
  });
});
