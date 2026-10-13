import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { createEndpointModel } from './models/endpoint-model.js';
import { performHealthCheck } from './services/health-check.js';
import { runWorkerCycle } from './services/monitor-worker.js';

const model = createEndpointModel(pool);
let stopping = false;
let timer;
let activeCycle;

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
  if (!stopping) timer = setTimeout(poll, env.WORKER_POLL_INTERVAL_MS);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  console.log(`Received ${signal}; stopping monitoring worker.`);
  await activeCycle?.catch(() => {});
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
