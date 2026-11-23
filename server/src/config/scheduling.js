export const MIN_WORKER_INTERVAL_SECONDS = 30;
export const MIN_EFFECTIVE_INTERVAL_SECONDS = 900;
export const MAX_INTERVAL_SECONDS = 86400;

export function schedulingPolicy(mode = 'cron', hostedMinimum = MIN_EFFECTIVE_INTERVAL_SECONDS) {
  const minIntervalSeconds = mode === 'worker' ? MIN_WORKER_INTERVAL_SECONDS : hostedMinimum;
  return {
    mode,
    minIntervalSeconds,
    maxIntervalSeconds: MAX_INTERVAL_SECONDS,
    defaultIntervalSeconds: Math.max(300, minIntervalSeconds)
  };
}
