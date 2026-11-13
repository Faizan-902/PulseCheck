import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { createEndpointModel } from './models/endpoint-model.js';
import { createAuthModel } from './models/auth-model.js';
import { createPostgresRateLimitStore } from './models/postgres-rate-limit-store.js';

const model = createEndpointModel(prisma);
const authModel = createAuthModel(prisma);

export const app = createApp({
  model,
  authModel,
  defaultTimeoutMs: env.CHECK_TIMEOUT_MS,
  frontendOrigin: env.FRONTEND_ORIGIN,
  cookieSecure: env.SESSION_COOKIE_SECURE,
  cookieSameSite: env.SESSION_COOKIE_SAME_SITE,
  sessionTtlHours: env.AUTH_SESSION_TTL_HOURS,
  loginRateLimitStore: createPostgresRateLimitStore(prisma, 'login'),
  signupRateLimitStore: createPostgresRateLimitStore(prisma, 'signup')
});

export { prisma };
export default app;
