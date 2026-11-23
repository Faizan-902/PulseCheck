import { cleanupExpiredData } from './data-retention.js';
import { runWorkerBatch } from './monitor-worker.js';

export const CLEANUP_BATCH_SIZE = 500;
export const CLEANUP_MAX_BATCHES = 4;

export async function runWorkerOnce({
  model,
  checkEndpoint,
  authModel,
  rateLimitStore,
  batchSize = 10,
  minIntervalSeconds,
  logger = console
}) {
  const run = await model.withScheduledRun(async (cutoff) => {
    let total = 0;
    let claimed;
    do {
      const result = await runWorkerBatch({
        model, checkEndpoint, batchSize, logger, scheduling: { cutoff, minIntervalSeconds }
      });
      total += result.checks.length;
      claimed = result.claimed;
    } while (claimed === batchSize);
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
    return { checks: total, cleanup, cleanupError };
  });
  if (!run) {
    logger.log('One-shot worker skipped: another scheduled run is active.');
    return { checks: 0, cleanup: null, cleanupError: null, skipped: true };
  }

  logger.log(
    `One-shot worker completed: checks=${run.checks}, ` +
      `sessions=${run.cleanup?.sessions?.deleted ?? 0}, rateLimits=${run.cleanup?.rateLimits?.deleted ?? 0}`
  );
  return run;
}
