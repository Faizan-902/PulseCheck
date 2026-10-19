import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { createEndpointModel } from './models/endpoint-model.js';
import { createAuthModel } from './models/auth-model.js';
import { createPostgresRateLimitStore } from './models/postgres-rate-limit-store.js';
import { performHealthCheck } from './services/health-check.js';
import { runWorkerOnce } from './services/worker-once.js';

const model = createEndpointModel(pool);
const authModel = createAuthModel(pool);
const rateLimitStore = createPostgresRateLimitStore(pool, 'maintenance');

try {
  await model.ping();
  await runWorkerOnce({
    model,
    checkEndpoint: performHealthCheck,
    authModel,
    rateLimitStore,
    batchSize: env.WORKER_BATCH_SIZE
  });
  await pool.end();
} catch (error) {
  console.error('One-shot monitoring worker failed:', error.message);
  await pool.end();
  process.exitCode = 1;
}
