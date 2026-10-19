import { cleanupExpiredData } from './data-retention.js';
import { runWorkerCycle } from './monitor-worker.js';

export const CLEANUP_BATCH_SIZE = 500;
export const CLEANUP_MAX_BATCHES = 4;

export async function runWorkerOnce({
  model,
  checkEndpoint,
  authModel,
  rateLimitStore,
  batchSize = 10,
  logger = console
}) {
  const checks = await runWorkerCycle({ model, checkEndpoint, batchSize, logger });

  let cleanup = null;
  let cleanupError = null;
  try {
    cleanup = await cleanupExpiredData({
      authModel,
      rateLimitStore,
      batchSize: CLEANUP_BATCH_SIZE,
      maxBatches: CLEANUP_MAX_BATCHES
    });
  } catch (error) {
    cleanupError = error.message;
    logger.error(`Expired data cleanup failed: ${error.message}`);
  }

  logger.log(
    `One-shot worker completed: checks=${checks.length}, ` +
      `sessions=${cleanup?.sessions?.deleted ?? 0}, rateLimits=${cleanup?.rateLimits?.deleted ?? 0}`
  );
  return { checks: checks.length, cleanup, cleanupError };
}
