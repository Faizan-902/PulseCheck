const DEFAULT_CHECK_COOLDOWN_MS = 30_000;

export function remainingCooldownSeconds(untilMs, now = Date.now()) {
  if (!Number.isFinite(untilMs) || untilMs <= now) return 0;
  return Math.ceil((untilMs - now) / 1000);
}

export function nextCooldownUntil({
  currentUntil = 0,
  retryAfterSeconds = null,
  now = Date.now(),
  defaultWindowMs = DEFAULT_CHECK_COOLDOWN_MS
}) {
  const durationMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : defaultWindowMs;
  const candidateUntil = now + durationMs;
  if (Number.isFinite(currentUntil) && currentUntil > now) {
    return Math.min(currentUntil, candidateUntil);
  }
  return candidateUntil;
}
