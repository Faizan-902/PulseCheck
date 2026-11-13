import { env } from './config/env.js';
import { closePrisma, connectPrisma, prisma } from './db/prisma.js';
import { createEndpointModel } from './models/endpoint-model.js';
import { createAuthModel } from './models/auth-model.js';
import { createPostgresRateLimitStore } from './models/postgres-rate-limit-store.js';
import { performHealthCheck } from './services/health-check.js';
import { runWorkerOnce } from './services/worker-once.js';

const model = createEndpointModel(prisma);
const authModel = createAuthModel(prisma);
const rateLimitStore = createPostgresRateLimitStore(prisma, 'maintenance');

try {
  await connectPrisma();
  await runWorkerOnce({
    model,
    checkEndpoint: performHealthCheck,
    authModel,
    rateLimitStore,
    batchSize: env.WORKER_BATCH_SIZE
  });
  await closePrisma();
} catch (error) {
  console.error('One-shot monitoring worker failed:', error.message);
  await closePrisma();
  process.exitCode = 1;
}
