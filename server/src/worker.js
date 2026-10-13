import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { createEndpointModel } from './models/endpoint-model.js';
import { createAuthModel } from './models/auth-model.js';
import { createPostgresRateLimitStore } from './models/postgres-rate-limit-store.js';
import { performHealthCheck } from './services/health-check.js';
import { runWorkerCycle } from './services/monitor-worker.js';
import { cleanupExpiredData } from './services/data-retention.js';

const model = createEndpointModel(pool);
const authModel = createAuthModel(pool);
const rateLimitStore = createPostgresRateLimitStore(pool, 'maintenance');
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 500;
const CLEANUP_MAX_BATCHES = 4;
let stopping = false;
let timer;
let activeCycle;
let activeCleanup;
let nextCleanupAt = 0;

async function poll() {
  if (stopping) return;
  try {
    activeCycle = runWorkerCycle({
      model,
      checkEndpoint: performHealthCheck,
      batchSize: env.WORKER_BATCH_SIZE
    });
    const results = await activeCycle;
    if (results.length) console.log(`Scheduled checks completed: ${results.length}`);
  } catch (error) {
    console.error('Monitoring worker cycle failed:', error.message);
  } finally {
    activeCycle = null;
  }
  if (!stopping && Date.now() >= nextCleanupAt) {
    activeCleanup = cleanupExpiredData({
      authModel,
      rateLimitStore,
      batchSize: CLEANUP_BATCH_SIZE,
      maxBatches: CLEANUP_MAX_BATCHES
    });
    try {
      const cleanup = await activeCleanup;
      console.log(`Expired data cleanup completed: sessions=${cleanup.sessions.deleted}, rateLimits=${cleanup.rateLimits.deleted}`);
      nextCleanupAt = Date.now() + (cleanup.hasMore ? env.WORKER_POLL_INTERVAL_MS : CLEANUP_INTERVAL_MS);
    } catch (error) {
      console.error('Expired data cleanup failed:', error.message);
      nextCleanupAt = Date.now() + CLEANUP_INTERVAL_MS;
    } finally {
      activeCleanup = null;
    }
  }
  if (!stopping) timer = setTimeout(poll, env.WORKER_POLL_INTERVAL_MS);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  console.log(`Received ${signal}; stopping monitoring worker.`);
  await Promise.allSettled([activeCycle, activeCleanup].filter(Boolean));
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await model.ping();
  console.log('PulseCheck monitoring worker started.');
  await poll();
} catch (error) {
  console.error('Monitoring worker could not connect to PostgreSQL:', error.message);
  await pool.end();
  process.exit(1);
}
