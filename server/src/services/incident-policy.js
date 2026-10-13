export function getIncidentTransition(recentStatuses, hasOpenIncident) {
  if (recentStatuses.length < 2 || recentStatuses[0] !== recentStatuses[1]) return 'NONE';
  if (recentStatuses[0] === 'DOWN' && !hasOpenIncident) return 'OPEN';
  if (recentStatuses[0] === 'UP' && hasOpenIncident) return 'RESOLVE';
  return 'NONE';
}
