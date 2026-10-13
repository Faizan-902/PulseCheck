import { AppError } from '../middleware/errors.js';
import { validateTargetUrl } from '../security/target-url.js';

export function createEndpointController({ model, checkEndpoint, resolver, defaultTimeoutMs }) {
  async function requireEndpoint(id) {
    const endpoint = await model.findEndpointById(id);
    if (!endpoint) throw new AppError(404, 'ENDPOINT_NOT_FOUND', 'The endpoint was not found.');
    return endpoint;
  }

  return {
    async create(request, response) {
      const target = await validateTargetUrl(request.body.url, resolver);
      const endpoint = await model.createEndpoint({
        name: request.body.name,
        url: target.url.href,
        timeoutMs: request.body.timeoutMs ?? defaultTimeoutMs,
        checkIntervalSeconds: request.body.checkIntervalSeconds ?? 300
      });
      response.status(201).json({ data: endpoint });
    },

    async list(_request, response) {
      response.json({ data: await model.listEndpoints() });
    },

    async get(request, response) {
      response.json({ data: await requireEndpoint(request.params.id) });
    },

    async check(request, response) {
      const endpoint = await requireEndpoint(request.params.id);
      const result = await checkEndpoint(endpoint, { resolver });
      const saved = await model.createCheck({ endpointId: endpoint.id, ...result });
      response.status(201).json({ data: saved });
    },

    async history(request, response) {
      await requireEndpoint(request.params.id);
      const checks = await model.listChecks(request.params.id, request.validatedQuery.limit);
      response.json({ data: checks });
    },

    async incidents(request, response) {
      await requireEndpoint(request.params.id);
      response.json({ data: await model.listIncidents(request.params.id) });
    }
  };
}
