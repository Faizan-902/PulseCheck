import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { createEndpointModel } from './models/endpoint-model.js';
import { createAuthModel } from './models/auth-model.js';
import { createPostgresRateLimitStore } from './models/postgres-rate-limit-store.js';

const model = createEndpointModel(pool);
const authModel = createAuthModel(pool);
const app = createApp({
  model,
  authModel,
  defaultTimeoutMs: env.CHECK_TIMEOUT_MS,
  frontendOrigin: env.FRONTEND_ORIGIN,
  cookieSecure: env.SESSION_COOKIE_SECURE,
  cookieSameSite: env.SESSION_COOKIE_SAME_SITE,
  sessionTtlHours: env.AUTH_SESSION_TTL_HOURS,
  loginRateLimitStore: createPostgresRateLimitStore(pool, 'login'),
  signupRateLimitStore: createPostgresRateLimitStore(pool, 'signup')
});

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`PulseCheck API listening on http://${env.HOST}:${env.PORT}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
