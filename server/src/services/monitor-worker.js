export async function runWorkerCycle(options) {
  return (await runWorkerBatch(options)).checks;
}

export async function runWorkerBatch({ model, checkEndpoint, resolver, batchSize = 10, logger = console, scheduling }) {
  const endpoints = scheduling
    ? await model.claimDueEndpoints(batchSize, scheduling.cutoff)
    : await model.claimDueEndpoints(batchSize);
  const checkEndpointOnce = async (endpoint) => {
    let check;
    try {
      check = await checkEndpoint(endpoint, { resolver });
    } catch (error) {
      logger.error(`Unexpected check failure for ${endpoint.id}: ${error.message}`);
      check = { status: 'DOWN', httpStatus: null, latencyMs: null, errorType: 'NETWORK_ERROR' };
    }

    try {
      const result = { endpointId: endpoint.id, leaseToken: endpoint.leaseToken, ...check };
      return scheduling
        ? await model.recordScheduledCheck(result, scheduling)
        : await model.recordScheduledCheck(result);
    } catch (error) {
      logger.error(`Could not persist scheduled check for ${endpoint.id}: ${error.message}`);
      throw error;
    }
  };

  // All claimed checks start together so a later row in the batch cannot exhaust
  // its lease while waiting for earlier network requests to finish.
  const settled = await Promise.allSettled(endpoints.map(checkEndpointOnce));
  const failures = settled.filter((result) => result.status === 'rejected');
  if (failures.length) {
    throw new AggregateError(failures.map((result) => result.reason), 'One or more scheduled checks failed to persist.');
  }

  const checks = settled.map((result) => result.value).filter(Boolean);
  return { checks, claimed: endpoints.length };
}
