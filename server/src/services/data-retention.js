async function deleteBatches(deleteBatch, batchSize, maxBatches) {
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const count = await deleteBatch(batchSize);
    deleted += count;
    if (count < batchSize) return { deleted, hasMore: false };
  }
  return { deleted, hasMore: true };
}

export async function cleanupExpiredData({
  authModel,
  rateLimitStore,
  batchSize = 500,
  maxBatches = 4
}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError('Cleanup batchSize must be an integer from 1 to 500.');
  }
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 4) {
    throw new RangeError('Cleanup maxBatches must be an integer from 1 to 4.');
  }
  const sessions = await deleteBatches(
    (limit) => authModel.deleteExpiredSessionsBatch(limit), batchSize, maxBatches
  );
  const rateLimits = await deleteBatches(
    (limit) => rateLimitStore.deleteExpiredBatch(limit), batchSize, maxBatches
  );
  return { sessions, rateLimits, hasMore: sessions.hasMore || rateLimits.hasMore };
}
