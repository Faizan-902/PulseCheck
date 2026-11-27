import { rateLimit } from 'express-rate-limit';
import { ENDPOINT_RATE_LIMITS } from '../config/endpoint-limits.js';

export function createEndpointRateLimiters(stores = {}) {
  const userKey = (request) => request.user.id;

  function build(name, message, keyGenerator = userKey, extraOptions = {}) {
    return rateLimit({
      ...ENDPOINT_RATE_LIMITS[name],
      ...(stores[name] ? { store: stores[name] } : {}),
      ...extraOptions,
      keyGenerator,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (request, response) => response.status(429).json({
        error: {
          code: 'ENDPOINT_RATE_LIMITED',
          message: typeof message === 'function' ? message(request) : message
        }
      })
    });
  }

  const checkUser = build('checkUser', 'You can run up to 20 manual checks per hour. Try again later.');

  return {
    create: build('create', 'You can add up to 10 monitors per hour. Try again later.'),
    checkUser,
    checkEndpoint: build(
      'checkEndpoint',
      (request) => {
        const resetMs = request.rateLimit?.resetTime instanceof Date
          ? request.rateLimit.resetTime.getTime()
          : Date.now() + ENDPOINT_RATE_LIMITS.checkEndpoint.windowMs;
        const remaining = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
        return `Wait ${remaining} ${remaining === 1 ? 'second' : 'seconds'} between manual checks of this monitor.`;
      },
      (request) => `${request.user.id}:${request.params.id}`,
      {
        skip: async (request) => {
          const info = await checkUser.getKey(userKey(request));
          return Boolean(
            info &&
            info.totalHits >= ENDPOINT_RATE_LIMITS.checkUser.limit &&
            info.resetTime > new Date()
          );
        }
      }
    )
  };
}
