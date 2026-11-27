import { Router } from 'express';
import { createEndpointRateLimiters } from '../middleware/endpoint-rate-limits.js';
import { createEndpointController } from '../controllers/endpoint-controller.js';
import { checksQuerySchema, endpointIdSchema, registerEndpointSchema } from '../validation/schemas.js';

function validate(schema, source) {
  return (request, _response, next) => {
    try {
      const value = schema.parse(request[source]);
      if (source === 'query') request.validatedQuery = value;
      else request[source] = value;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createEndpointsRouter(dependencies) {
  const router = Router();
  const controller = createEndpointController(dependencies);

  const { requireCsrf } = dependencies.authentication;
  const limits = createEndpointRateLimiters(dependencies.endpointRateLimitStores);
  router.post('/',
    requireCsrf,
    validate(registerEndpointSchema(dependencies.scheduling), 'body'),
    limits.create,
    controller.create
  );
  router.get('/', controller.list);
  router.get('/incident-feed', controller.incidentFeed);
  router.get('/:id', validate(endpointIdSchema, 'params'), controller.get);
  router.delete('/:id', dependencies.authentication.requireCsrf, validate(endpointIdSchema, 'params'), controller.remove);
  router.post('/:id/check',
    requireCsrf,
    validate(endpointIdSchema, 'params'),
    controller.loadOwnedEndpoint,
    limits.checkEndpoint,
    limits.checkUser,
    controller.check
  );
  router.get('/:id/checks',
    validate(endpointIdSchema, 'params'),
    validate(checksQuerySchema, 'query'),
    controller.history
  );
  router.get('/:id/incidents', validate(endpointIdSchema, 'params'), controller.incidents);

  return router;
}
