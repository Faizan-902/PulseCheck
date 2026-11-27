export function shouldFetchIncidentFeed({ enabled, page }) {
  return Boolean(enabled) && page === 'incidents';
}

export function shouldFetchLatencyHistory({ enabled, page, selectedEndpointId }) {
  return Boolean(enabled) && page !== 'incidents' && Boolean(selectedEndpointId);
}

export function shouldClearLatencyOnMonitorDelete({ selectedEndpointId, deletedEndpointId }) {
  return Boolean(selectedEndpointId) && selectedEndpointId === deletedEndpointId;
}
