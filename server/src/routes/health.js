import { Router } from 'express';
import { createHealthController } from '../controllers/health-controller.js';

export function createHealthRouter(model) {
  const router = Router();
  router.get('/', createHealthController(model));
  return router;
}
