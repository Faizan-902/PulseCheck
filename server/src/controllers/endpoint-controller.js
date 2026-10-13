import { AppError } from '../middleware/errors.js';
import { validateTargetUrl } from '../security/target-url.js';

export function createEndpointController({ model, checkEndpoint, resolver, defaultTimeoutMs }) {
  async function requireEndpoint(id, ownerId) {
    const endpoint = await model.findEndpointById(id, ownerId);
    if (!endpoint) throw new AppError(404, 'ENDPOINT_NOT_FOUND', 'The endpoint was not found.');
    return endpoint;
  }

  return {
    async create(request, response) {
      const target = await validateTargetUrl(request.body.url, resolver);
      const endpoint = await model.createEndpoint({
        ownerId: request.user.id,
        name: request.body.name,
        url: target.url.href,
        timeoutMs: request.body.timeoutMs ?? defaultTimeoutMs,
        checkIntervalSeconds: request.body.checkIntervalSeconds ?? 300
      });
      response.status(201).json({ data: endpoint });
    },

    async list(request, response) {
      response.json({ data: await model.listEndpoints(request.user.id) });
    },

    async get(request, response) {
      response.json({ data: await requireEndpoint(request.params.id, request.user.id) });
    },

    async remove(request, response) {
      const deleted = await model.deleteEndpoint(request.params.id, request.user.id);
      if (!deleted) throw new AppError(404, 'ENDPOINT_NOT_FOUND', 'The endpoint was not found.');
      response.json({ data: { deleted: true } });
    },

    async check(request, response) {
      const endpoint = await requireEndpoint(request.params.id, request.user.id);
      const result = await checkEndpoint(endpoint, { resolver });
      const saved = await model.createCheck({ endpointId: endpoint.id, ownerId: request.user.id, ...result });
      if (!saved) throw new AppError(404, 'ENDPOINT_NOT_FOUND', 'The endpoint was not found.');
      response.status(201).json({ data: saved });
    },

    async history(request, response) {
      await requireEndpoint(request.params.id, request.user.id);
      const checks = await model.listChecks(request.params.id, request.validatedQuery.limit, request.user.id);
      response.json({ data: checks });
    },

    async incidents(request, response) {
      await requireEndpoint(request.params.id, request.user.id);
      response.json({ data: await model.listIncidents(request.params.id, request.user.id) });
    }
  };
}
