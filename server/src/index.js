import app, { pool } from './runtime.js';
import { env } from './config/env.js';

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
