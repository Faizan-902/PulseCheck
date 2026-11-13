import { getIncidentTransition } from '../services/incident-policy.js';

const endpointFields = {
  id: true,
  name: true,
  url: true,
  timeoutMs: true,
  checkIntervalSeconds: true,
  nextCheckAt: true,
  isActive: true,
  createdAt: true
};

function checkResultFields(result) {
  return {
    id: result.id,
    endpointId: result.endpointId,
    checkedAt: result.checkedAt,
    checkSource: result.checkSource,
    status: result.status,
    httpStatus: result.httpStatus,
    latencyMs: result.latencyMs,
    errorType: result.errorType
  };
}

async function insertCheckAndUpdateIncident(tx, {
  endpointId,
  status,
  httpStatus,
  latencyMs,
  errorType,
  checkSource
}) {
  const saved = await tx.checkResult.create({
    data: { endpointId, status, httpStatus, latencyMs, errorType, checkSource }
  });

  if (checkSource === 'SCHEDULED') {
    const recent = await tx.checkResult.findMany({
      where: { endpointId, checkSource: 'SCHEDULED' },
      select: { status: true },
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
      take: 2
    });
    const openIncident = await tx.incident.findFirst({
      where: { endpointId, resolvedAt: null },
      select: { id: true }
    });
    const transition = getIncidentTransition(recent.map(({ status: checkStatus }) => checkStatus), Boolean(openIncident));

    if (transition === 'OPEN') {
      await tx.incident.create({ data: { endpointId } });
    } else if (transition === 'RESOLVE') {
      await tx.incident.updateMany({
        where: { endpointId, resolvedAt: null },
        data: { resolvedAt: new Date() }
      });
    }
  }

  return checkResultFields(saved);
}

export function createEndpointModel(prisma) {
  return {
    async ping() {
      await prisma.$queryRaw`SELECT 1`;
    },

    async createEndpoint({ ownerId, name, url, timeoutMs, checkIntervalSeconds = 300 }) {
      return prisma.monitoredEndpoint.create({
        data: { ownerId, name, url, timeoutMs, checkIntervalSeconds },
        select: endpointFields
      });
    },

    async listEndpoints(ownerId) {
      const endpoints = await prisma.monitoredEndpoint.findMany({
        where: { ownerId },
        select: {
          ...endpointFields,
          checkResults: {
            take: 1,
            orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
            select: { status: true, httpStatus: true, latencyMs: true, checkedAt: true }
          }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
      });

      return endpoints.map(({ checkResults, ...endpoint }) => ({
        ...endpoint,
        latestStatus: checkResults[0]?.status ?? null,
        latestHttpStatus: checkResults[0]?.httpStatus ?? null,
        latestLatencyMs: checkResults[0]?.latencyMs ?? null,
        latestCheckedAt: checkResults[0]?.checkedAt ?? null
      }));
    },

    async findEndpointById(id, ownerId) {
      return prisma.monitoredEndpoint.findFirst({
        where: { id, ownerId },
        select: endpointFields
      });
    },

    async deleteEndpoint(id, ownerId) {
      const result = await prisma.monitoredEndpoint.deleteMany({ where: { id, ownerId } });
      return result.count === 1;
    },

    async createCheck({ endpointId, ownerId, status, httpStatus, latencyMs, errorType }) {
      return prisma.$transaction(async (tx) => {
        const owned = await tx.monitoredEndpoint.findFirst({
          where: { id: endpointId, ownerId },
          select: { id: true }
        });
        if (!owned) return null;

        // Lock the endpoint to serialize manual and scheduled incident transitions.
        const locked = await tx.$queryRaw`
          SELECT id FROM monitored_endpoints
          WHERE id = ${endpointId}::uuid AND owner_id = ${ownerId}::uuid
          FOR UPDATE
        `;
        if (locked.length === 0) return null;
        return insertCheckAndUpdateIncident(tx, {
          endpointId, status, httpStatus, latencyMs, errorType, checkSource: 'MANUAL'
        });
      });
    },

    async listChecks(endpointId, limit, ownerId) {
      const results = await prisma.checkResult.findMany({
        where: { endpointId, endpoint: { ownerId } },
        select: {
          id: true,
          endpointId: true,
          checkedAt: true,
          status: true,
          checkSource: true,
          httpStatus: true,
          latencyMs: true,
          errorType: true
        },
        orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
        take: limit
      });
      return results.map(checkResultFields);
    },

    async claimDueEndpoints(limit = 10) {
      return prisma.$transaction(async (tx) => tx.$queryRaw`
        WITH due AS (
          SELECT id FROM monitored_endpoints
          WHERE is_active = TRUE AND next_check_at <= NOW()
            AND (check_lease_until IS NULL OR check_lease_until <= NOW())
          ORDER BY next_check_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        ), claimed AS (
          UPDATE monitored_endpoints AS endpoint
          SET check_lease_until = NOW() + (endpoint.timeout_ms + 30000) * INTERVAL '1 millisecond',
              check_lease_token = gen_random_uuid()
          FROM due
          WHERE endpoint.id = due.id
          RETURNING endpoint.id, endpoint.name, endpoint.url,
                    endpoint.timeout_ms AS "timeoutMs",
                    endpoint.check_interval_seconds AS "checkIntervalSeconds",
                    endpoint.check_lease_token AS "leaseToken",
                    endpoint.next_check_at AS "nextCheckAt"
        )
        SELECT * FROM claimed ORDER BY "nextCheckAt", id
      `);
    },

    async recordScheduledCheck({ endpointId, leaseToken, status, httpStatus, latencyMs, errorType }) {
      return prisma.$transaction(async (tx) => {
        const endpoint = await tx.$queryRaw`
          SELECT id FROM monitored_endpoints
          WHERE id = ${endpointId}::uuid AND is_active = TRUE
            AND check_lease_token = ${leaseToken}::uuid
          FOR UPDATE
        `;
        if (endpoint.length === 0) return null;

        const saved = await insertCheckAndUpdateIncident(tx, {
          endpointId, status, httpStatus, latencyMs, errorType, checkSource: 'SCHEDULED'
        });
        await tx.monitoredEndpoint.update({
          where: { id: endpointId },
          data: { checkLeaseUntil: null, checkLeaseToken: null }
        });
        await tx.$executeRaw`
          UPDATE monitored_endpoints
          SET next_check_at = clock_timestamp() + check_interval_seconds * INTERVAL '1 second'
          WHERE id = ${endpointId}::uuid
        `;
        return saved;
      });
    },

    async listIncidents(endpointId, ownerId) {
      return prisma.incident.findMany({
        where: { endpointId, endpoint: { ownerId } },
        select: { id: true, endpointId: true, openedAt: true, resolvedAt: true },
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }]
      });
    }
  };
}
