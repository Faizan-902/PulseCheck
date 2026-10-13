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
  PGSSLMODE: z.enum(['disable', 'require']).default('disable'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
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
