import { describe, expect, it, vi } from 'vitest';
import { runWorkerOnce } from '../src/services/worker-once.js';

const cutoff = new Date('2026-01-01T00:00:00Z');

function buildDeps(overrides = {}) {
  const model = {
    withScheduledRun: vi.fn((run) => run(cutoff)),
    claimDueEndpoints: vi.fn().mockResolvedValue([]).mockResolvedValueOnce([
      { id: 'endpoint-1', timeoutMs: 1000, leaseToken: 'lease-token-1' }
    ]),
    recordScheduledCheck: vi.fn().mockResolvedValue({ id: 'check-1', status: 'UP' })
  };
  return {
    model,
    checkEndpoint: vi.fn().mockResolvedValue({
      status: 'UP', httpStatus: 200, latencyMs: 12, errorType: null
    }),
    authModel: { deleteExpiredSessionsBatch: vi.fn().mockResolvedValue(0) },
    rateLimitStore: { deleteExpiredBatch: vi.fn().mockResolvedValue(0) },
    logger: { log: vi.fn(), error: vi.fn() },
    ...overrides
  };
}

describe('one-shot monitoring worker', () => {
  it('runs a single cycle and then expires old sessions and rate limits', async () => {
    const deps = buildDeps();

    const result = await runWorkerOnce(deps);

    expect(deps.model.claimDueEndpoints).toHaveBeenCalledOnce();
    expect(deps.model.claimDueEndpoints).toHaveBeenCalledWith(10, cutoff);
    expect(deps.model.recordScheduledCheck).toHaveBeenCalledOnce();
    expect(deps.authModel.deleteExpiredSessionsBatch).toHaveBeenCalled();
    expect(deps.rateLimitStore.deleteExpiredBatch).toHaveBeenCalled();
    expect(result.checks).toBe(1);
    expect(result.cleanupError).toBeNull();
    expect(deps.logger.log).toHaveBeenCalledWith(
      'One-shot worker completed: checks=1, sessions=0, rateLimits=0'
    );
  });

  it('honours the configured batch size', async () => {
    const deps = buildDeps();

    await runWorkerOnce({ ...deps, batchSize: 3 });

    expect(deps.model.claimDueEndpoints).toHaveBeenCalledWith(3, cutoff);
  });

  it('drains multiple batches with one cutoff and bounded concurrency', async () => {
    const deps = buildDeps();
    deps.model.claimDueEndpoints.mockResolvedValueOnce([
      { id: 'endpoint-2', timeoutMs: 1000, leaseToken: 'lease-token-2' }
    ]);

    const result = await runWorkerOnce({ ...deps, batchSize: 1, minIntervalSeconds: 900 });

    expect(result.checks).toBe(2);
    expect(deps.model.claimDueEndpoints.mock.calls).toEqual([[1, cutoff], [1, cutoff], [1, cutoff]]);
    expect(deps.model.recordScheduledCheck).toHaveBeenCalledWith(
      expect.objectContaining({ endpointId: 'endpoint-2' }), { cutoff, minIntervalSeconds: 900 }
    );
  });

  it('still expires stale data when nothing is due', async () => {
    const deps = buildDeps();
    deps.model.claimDueEndpoints.mockReset().mockResolvedValue([]);

    const result = await runWorkerOnce(deps);

    expect(deps.authModel.deleteExpiredSessionsBatch).toHaveBeenCalledOnce();
    expect(result.checks).toBe(0);
  });

  it('rejects when a scheduled check cannot be persisted so the job fails', async () => {
    const deps = buildDeps();
    deps.model.recordScheduledCheck.mockRejectedValue(new Error('database write failed'));

    await expect(runWorkerOnce(deps)).rejects.toThrow(
      'One or more scheduled checks failed to persist.'
    );
    expect(deps.authModel.deleteExpiredSessionsBatch).not.toHaveBeenCalled();
  });

  it('reports cleanup failures without discarding successful checks', async () => {
    const deps = buildDeps();
    deps.authModel.deleteExpiredSessionsBatch.mockRejectedValue(new Error('cleanup unavailable'));

    const result = await runWorkerOnce(deps);

    expect(result.checks).toBe(1);
    expect(result.cleanup).toBeNull();
    expect(result.cleanupError).toBe('cleanup unavailable');
    expect(deps.logger.error).toHaveBeenCalledWith(
      'Expired data cleanup failed: cleanup unavailable'
    );
  });
});
