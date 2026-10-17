import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const projectEnvPath = resolve(fileURLToPath(new URL('../../../.env', import.meta.url)));
dotenv.config({ path: projectEnvPath });

const envSchema = z.object({
  PGHOST: z.string().trim().min(1),
  PGPORT: z.coerce.number().int().min(1).max(65535).default(5432),
  PGDATABASE: z.string().trim().min(1),
  PGUSER: z.string().trim().min(1),
  PGPASSWORD: z.string().default(''),
  PGPOOL_MAX: z.coerce.number().int().min(1).max(10).default(process.env.VERCEL ? 2 : 10),
  PGSSLMODE: z.enum(['disable', 'require']).default(process.env.NODE_ENV === 'production' ? 'require' : 'disable'),
  HOST: z.string().trim().min(1).default(process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  FRONTEND_ORIGIN: z.string().url().refine((value) => {
    try { return new URL(value).origin === value; }
    catch { return false; }
  }, 'Must be an origin without a path.').default('http://localhost:5173'),
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).default(process.env.NODE_ENV === 'production' ? 'true' : 'false').transform((value) => value === 'true'),
  SESSION_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  CHECK_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(5000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10)
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`);
  throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
}

export const env = parsed.data;

if (env.SESSION_COOKIE_SAME_SITE === 'none' && !env.SESSION_COOKIE_SECURE) {
  throw new Error('SESSION_COOKIE_SECURE must be true when SESSION_COOKIE_SAME_SITE is none.');
}

if (process.env.NODE_ENV === 'production') {
  if (env.PGSSLMODE !== 'require') {
    throw new Error('PGSSLMODE=require is required in production.');
  }
  if (!env.SESSION_COOKIE_SECURE) {
    throw new Error('SESSION_COOKIE_SECURE must be true in production.');
  }
  const frontendUrl = new URL(env.FRONTEND_ORIGIN);
  if (frontendUrl.protocol !== 'https:') {
    throw new Error('FRONTEND_ORIGIN must use HTTPS in production.');
  }
  const frontendHostname = frontendUrl.hostname.replace(/^\[|\]$/g, '');
  if (frontendHostname === 'localhost' || frontendHostname === '127.0.0.1' || frontendHostname === '::1') {
    throw new Error('FRONTEND_ORIGIN must be the deployed frontend origin in production.');
  }
}
