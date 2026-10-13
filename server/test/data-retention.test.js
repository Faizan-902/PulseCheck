import { describe, expect, it, vi } from 'vitest';
import { cleanupExpiredData } from '../src/services/data-retention.js';

describe('expired data cleanup', () => {
  it('processes a bounded number of bounded batches and reports remaining work', async () => {
    const deleteExpiredSessionsBatch = vi.fn().mockResolvedValue(2);
    const deleteExpiredBatch = vi.fn().mockResolvedValue(2);
    const result = await cleanupExpiredData({
      authModel: { deleteExpiredSessionsBatch },
      rateLimitStore: { deleteExpiredBatch },
      batchSize: 2,
      maxBatches: 2
    });
    expect(deleteExpiredSessionsBatch).toHaveBeenCalledTimes(2);
    expect(deleteExpiredBatch).toHaveBeenCalledTimes(2);
    expect(deleteExpiredSessionsBatch).toHaveBeenNthCalledWith(1, 2);
    expect(result).toEqual({
      sessions: { deleted: 4, hasMore: true },
      rateLimits: { deleted: 4, hasMore: true },
      hasMore: true
    });
  });

  it('rejects cleanup limits beyond the hard bounds', async () => {
    await expect(cleanupExpiredData({
      authModel: { deleteExpiredSessionsBatch: vi.fn() },
      rateLimitStore: { deleteExpiredBatch: vi.fn() },
      batchSize: 501
    })).rejects.toThrow('batchSize');
    await expect(cleanupExpiredData({
      authModel: { deleteExpiredSessionsBatch: vi.fn() },
      rateLimitStore: { deleteExpiredBatch: vi.fn() },
      maxBatches: 5
    })).rejects.toThrow('maxBatches');
  });
});
