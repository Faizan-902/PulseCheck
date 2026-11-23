export const DEFAULT_MAX_ENDPOINTS_PER_USER = 10;

const HOUR_MS = 60 * 60 * 1000;

export const ENDPOINT_RATE_LIMITS = {
  create: { windowMs: HOUR_MS, limit: 10 },
  checkUser: { windowMs: HOUR_MS, limit: 20 },
  checkEndpoint: { windowMs: 30_000, limit: 1 }
};
