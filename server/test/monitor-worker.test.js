import { describe, expect, it, vi } from 'vitest';
import { runWorkerCycle } from '../src/services/monitor-worker.js';
import { getIncidentTransition } from '../src/services/incident-policy.js';

const endpoint = { id: 'endpoint-1', timeoutMs: 1000, leaseToken: 'lease-token-1' };

describe('scheduled monitoring worker', () => {
  it('runs and persists checks for endpoints returned by the due queue', async () => {
    const model = {
      claimDueEndpoints: vi.fn().mockResolvedValue([endpoint]),
      recordScheduledCheck: vi.fn().mockResolvedValue({ id: 'check-1', status: 'UP' })
    };
    const checkEndpoint = vi.fn().mockResolvedValue({
      status: 'UP', httpStatus: 200, latencyMs: 12, errorType: null
    });

    const result = await runWorkerCycle({ model, checkEndpoint, resolver: vi.fn(), logger: { error: vi.fn() } });

    expect(result).toEqual([{ id: 'check-1', status: 'UP' }]);
    expect(model.recordScheduledCheck).toHaveBeenCalledWith({
      endpointId: endpoint.id, leaseToken: endpoint.leaseToken,
      status: 'UP', httpStatus: 200, latencyMs: 12, errorType: null
    });
  });

  it('persists failed checks returned by the shared checker', async () => {
    const model = {
      claimDueEndpoints: vi.fn().mockResolvedValue([endpoint]),
      recordScheduledCheck: vi.fn().mockResolvedValue({ status: 'DOWN' })
    };
    const checkEndpoint = vi.fn().mockResolvedValue({
      status: 'DOWN', httpStatus: null, latencyMs: 1000, errorType: 'TIMEOUT'
    });

    await runWorkerCycle({ model, checkEndpoint, logger: { error: vi.fn() } });

    expect(model.recordScheduledCheck).toHaveBeenCalledWith(expect.objectContaining({
      endpointId: endpoint.id, leaseToken: endpoint.leaseToken,
      status: 'DOWN', errorType: 'TIMEOUT'
    }));
  });

  it('does not fabricate zero latency when the checker unexpectedly throws', async () => {
    const model = {
      claimDueEndpoints: vi.fn().mockResolvedValue([endpoint]),
      recordScheduledCheck: vi.fn().mockResolvedValue({ status: 'DOWN' })
    };
    const logger = { error: vi.fn() };

    await runWorkerCycle({ model, checkEndpoint: vi.fn().mockRejectedValue(new Error('unexpected checker failure')), logger });

    expect(model.recordScheduledCheck).toHaveBeenCalledWith({
      endpointId: endpoint.id,
      leaseToken: endpoint.leaseToken,
      status: 'DOWN',
      httpStatus: null,
      latencyMs: null,
      errorType: 'NETWORK_ERROR'
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('rejects a cycle when result persistence fails instead of reporting success', async () => {
    const model = {
      claimDueEndpoints: vi.fn().mockResolvedValue([endpoint]),
      recordScheduledCheck: vi.fn().mockRejectedValue(new Error('database write failed'))
    };
    const checkEndpoint = vi.fn().mockResolvedValue({
      status: 'UP', httpStatus: 200, latencyMs: 12, errorType: null
    });
    const logger = { error: vi.fn() };

    await expect(runWorkerCycle({ model, checkEndpoint, logger })).rejects.toThrow(
      'One or more scheduled checks failed to persist.'
    );
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Could not persist scheduled check'));
  });

  it('does not check an endpoint when another worker has already claimed the due queue', async () => {
    const claimDueEndpoints = vi.fn()
      .mockResolvedValueOnce([endpoint])
      .mockResolvedValueOnce([]);
    const model = { claimDueEndpoints, recordScheduledCheck: vi.fn() };
    const checkEndpoint = vi.fn().mockResolvedValue({ status: 'UP', httpStatus: 200, latencyMs: 1, errorType: null });

    await Promise.all([
      runWorkerCycle({ model, checkEndpoint, logger: { error: vi.fn() } }),
      runWorkerCycle({ model, checkEndpoint, logger: { error: vi.fn() } })
    ]);

    expect(checkEndpoint).toHaveBeenCalledTimes(1);
    expect(model.recordScheduledCheck).toHaveBeenCalledTimes(1);
  });
});

describe('incident transitions', () => {
  it('opens only after two consecutive failures and avoids duplicate open incidents', () => {
    expect(getIncidentTransition(['DOWN'], false)).toBe('NONE');
    expect(getIncidentTransition(['DOWN', 'UP'], false)).toBe('NONE');
    expect(getIncidentTransition(['DOWN', 'DOWN'], false)).toBe('OPEN');
    expect(getIncidentTransition(['DOWN', 'DOWN'], true)).toBe('NONE');
  });

  it('resolves only after two consecutive successful checks', () => {
    expect(getIncidentTransition(['UP'], true)).toBe('NONE');
    expect(getIncidentTransition(['UP', 'DOWN'], true)).toBe('NONE');
    expect(getIncidentTransition(['UP', 'UP'], true)).toBe('RESOLVE');
    expect(getIncidentTransition(['UP', 'UP'], false)).toBe('NONE');
  });
});
