import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { createEndpointModel } from './models/endpoint-model.js';

const model = createEndpointModel(pool);
const app = createApp({
  model,
  defaultTimeoutMs: env.CHECK_TIMEOUT_MS,
  frontendOrigin: env.FRONTEND_ORIGIN
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
