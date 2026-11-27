import { createApp } from './app.js';
import { env } from './config/env.js';
import { schedulingPolicy } from './config/scheduling.js';
import { pool } from './db/pool.js';
import { createEndpointModel } from './models/endpoint-model.js';
import { createAuthModel } from './models/auth-model.js';
import { createEndpointRateLimitStores, createPostgresRateLimitStore } from './models/postgres-rate-limit-store.js';
import { createGoogleOAuthClient } from './services/google-oauth.js';

const model = createEndpointModel(pool);
const authModel = createAuthModel(pool);
const googleOAuth = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
  ? createGoogleOAuthClient({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET })
  : null;

export const app = createApp({
  model,
  authModel,
  maxEndpointsPerUser: env.MAX_ENDPOINTS_PER_USER,
  endpointRateLimitStores: createEndpointRateLimitStores(pool),
  scheduling: schedulingPolicy(env.SCHEDULER_MODE, env.MIN_EFFECTIVE_INTERVAL_SECONDS),
  defaultTimeoutMs: env.CHECK_TIMEOUT_MS,
  frontendOrigin: env.FRONTEND_ORIGIN,
  trustProxy: env.TRUST_PROXY,
  cookieSecure: env.SESSION_COOKIE_SECURE,
  cookieSameSite: env.SESSION_COOKIE_SAME_SITE,
  sessionTtlHours: env.AUTH_SESSION_TTL_HOURS,
  googleOAuth,
  googleRedirectUri: env.GOOGLE_REDIRECT_URI,
  loginRateLimitStore: createPostgresRateLimitStore(pool, 'login'),
  signupRateLimitStore: createPostgresRateLimitStore(pool, 'signup')
});

export { pool };
export default app;
