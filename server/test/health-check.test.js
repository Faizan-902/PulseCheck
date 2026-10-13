import { describe, expect, it, vi } from 'vitest';
import { performHealthCheck } from '../src/services/health-check.js';

const endpoint = {
  id: '1d7f9e6e-2dce-4e1a-8930-9651dfbd4b7c',
  url: 'https://api.example.com/health',
  timeoutMs: 1000
};
const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

function fakeResponse(status, location = null) {
  return {
    status,
    headers: { get: (name) => name === 'location' ? location : null },
    body: { cancel: vi.fn(async () => {}) }
  };
}

describe('performHealthCheck', () => {
  it('marks a successful HTTP response UP and does not read its body', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(204));

    const result = await performHealthCheck(endpoint, { fetchImpl, resolver: publicResolver });

    expect(result).toMatchObject({ status: 'UP', httpStatus: 204, errorType: null });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('api.example.com'), expect.objectContaining({
      method: 'GET',
      redirect: 'manual',
      dispatcher: expect.anything()
    }));
  });

  it('marks a server error DOWN while preserving the HTTP status', async () => {
    const result = await performHealthCheck(endpoint, {
      fetchImpl: async () => fakeResponse(503),
      resolver: publicResolver
    });

    expect(result).toMatchObject({ status: 'DOWN', httpStatus: 503, errorType: 'HTTP_ERROR' });
  });

  it('blocks a private DNS answer before making an HTTP request', async () => {
    const fetchImpl = vi.fn();
    const result = await performHealthCheck(endpoint, {
      fetchImpl,
      resolver: async () => [{ address: '192.168.1.4', family: 4 }]
    });

    expect(result).toMatchObject({ status: 'DOWN', httpStatus: null, errorType: 'UNSAFE_TARGET' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('revalidates a redirect target before following it', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(302, 'https://127.0.0.1/admin'));

    const result = await performHealthCheck(endpoint, { fetchImpl, resolver: publicResolver });

    expect(result).toMatchObject({ status: 'DOWN', httpStatus: 302, errorType: 'UNSAFE_TARGET' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('classifies a request timeout', async () => {
    const timeout = new Error('request exceeded timeout');
    timeout.name = 'TimeoutError';

    const result = await performHealthCheck(endpoint, {
      fetchImpl: async () => { throw timeout; },
      resolver: publicResolver
    });

    expect(result).toMatchObject({ status: 'DOWN', httpStatus: null, errorType: 'TIMEOUT' });
  });
});
