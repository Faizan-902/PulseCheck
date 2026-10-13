import { Router } from 'express';
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

  router.post('/', validate(registerEndpointSchema, 'body'), controller.create);
  router.get('/', controller.list);
  router.get('/:id', validate(endpointIdSchema, 'params'), controller.get);
  router.post('/:id/check', validate(endpointIdSchema, 'params'), controller.check);
  router.get('/:id/checks',
    validate(endpointIdSchema, 'params'),
    validate(checksQuerySchema, 'query'),
    controller.history
  );

  return router;
}
