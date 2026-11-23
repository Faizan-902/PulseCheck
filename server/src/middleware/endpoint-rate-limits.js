import { rateLimit } from 'express-rate-limit';
import { ENDPOINT_RATE_LIMITS } from '../config/endpoint-limits.js';

export function createEndpointRateLimiters(stores = {}) {
  const userKey = (request) => request.user.id;

  function build(name, message, keyGenerator = userKey) {
    return rateLimit({
      ...ENDPOINT_RATE_LIMITS[name],
      ...(stores[name] ? { store: stores[name] } : {}),
      keyGenerator,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_request, response) => response.status(429).json({
        error: { code: 'ENDPOINT_RATE_LIMITED', message }
      })
    });
  }

  return {
    create: build('create', 'You can add up to 10 monitors per hour. Try again later.'),
    checkUser: build('checkUser', 'You can run up to 20 manual checks per hour. Try again later.'),
    checkEndpoint: build(
      'checkEndpoint',
      'Wait 30 seconds between manual checks of this monitor.',
      (request) => `${request.user.id}:${request.params.id}`
    )
  };
}
