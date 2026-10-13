import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const endpointId = '1d7f9e6e-2dce-4e1a-8930-9651dfbd4b7c';
const checkId = 'ae2dad26-3305-411e-91f0-08d04fc8c2e5';
const publicResolver = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);

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
    listEndpoints: vi.fn(async () => [...endpoints.values()]),
    findEndpointById: vi.fn(async (id) => endpoints.get(id) ?? null),
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
    listChecks: vi.fn(async (id, limit) => checks.filter((check) => check.endpointId === id).slice(0, limit))
  };
}

describe('PulseCheck API', () => {
  let repository;
  let app;
  let checkEndpoint;

  beforeEach(() => {
    repository = makeRepository();
    publicResolver.mockClear();
    checkEndpoint = vi.fn(async () => ({
      status: 'UP',
      httpStatus: 200,
      latencyMs: 41,
      errorType: null
    }));
    app = createApp({
      model: repository,
      resolver: publicResolver,
      checkEndpoint,
      defaultTimeoutMs: 5000
    });
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
    const response = await request(app)
      .post('/api/endpoints')
      .send({ name: '', url: 'ftp://api.example.com/health' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.length).toBeGreaterThan(0);
    expect(repository.createEndpoint).not.toHaveBeenCalled();
  });

  it('rejects a hostname that resolves to a private address', async () => {
    const appWithPrivateResolver = createApp({
      model: repository,
      resolver: async () => [{ address: '10.0.0.8', family: 4 }]
    });

    const response = await request(appWithPrivateResolver)
      .post('/api/endpoints')
      .send({ name: 'Internal API', url: 'https://api.example.com/health' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNSAFE_TARGET');
    expect(repository.createEndpoint).not.toHaveBeenCalled();
  });

  it('creates an endpoint and uses the configured default timeout', async () => {
    const response = await request(app)
      .post('/api/endpoints')
      .send({ name: 'Public API', url: 'https://api.example.com/health' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      id: endpointId,
      name: 'Public API',
      url: 'https://api.example.com/health',
      timeoutMs: 5000,
      isActive: true
    });
    expect(repository.createEndpoint).toHaveBeenCalledWith({
      name: 'Public API',
      url: 'https://api.example.com/health',
      timeoutMs: 5000
    });
    expect(publicResolver).toHaveBeenCalledWith('api.example.com');
  });

  it('runs and persists a successful manual check', async () => {
    await request(app).post('/api/endpoints').send({
      name: 'Public API',
      url: 'https://api.example.com/health'
    });

    const response = await request(app).post(`/api/endpoints/${endpointId}/check`);

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
      status: 'UP',
      httpStatus: 200,
      latencyMs: 41,
      errorType: null
    });
  });

  it('persists failed checks and exposes them in endpoint history', async () => {
    await request(app).post('/api/endpoints').send({
      name: 'Public API',
      url: 'https://api.example.com/health'
    });
    checkEndpoint.mockResolvedValueOnce({
      status: 'DOWN',
      httpStatus: null,
      latencyMs: 5000,
      errorType: 'TIMEOUT'
    });

    const checkResponse = await request(app).post(`/api/endpoints/${endpointId}/check`);
    const historyResponse = await request(app).get(`/api/endpoints/${endpointId}/checks`);

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
    const response = await request(app).post(`/api/endpoints/${missingId}/check`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ENDPOINT_NOT_FOUND');
    expect(checkEndpoint).not.toHaveBeenCalled();
  });
});
