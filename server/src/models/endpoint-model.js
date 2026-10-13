import { getIncidentTransition } from '../services/incident-policy.js';

export function createEndpointModel(pool) {
  async function insertCheckAndUpdateIncident(client, {
    endpointId,
    status,
    httpStatus,
    latencyMs,
    errorType,
    checkSource
  }) {
    const saved = await client.query(
      `INSERT INTO check_results
         (endpoint_id, checked_at, check_source, status, http_status, latency_ms, error_type)
       VALUES ($1, clock_timestamp(), $2, $3, $4, $5, $6)
       RETURNING id, endpoint_id AS "endpointId", checked_at AS "checkedAt",
                 check_source AS "checkSource", status, http_status AS "httpStatus",
                 latency_ms AS "latencyMs", error_type AS "errorType"`,
      [endpointId, checkSource, status, httpStatus, latencyMs, errorType]
    );

    if (checkSource === 'SCHEDULED') {
      const recent = await client.query(
        `SELECT status FROM check_results
         WHERE endpoint_id = $1 AND check_source = 'SCHEDULED'
         ORDER BY checked_at DESC, id DESC LIMIT 2`,
        [endpointId]
      );
      const openIncident = await client.query(
        `SELECT id FROM incidents WHERE endpoint_id = $1 AND resolved_at IS NULL FOR UPDATE`,
        [endpointId]
      );
      const transition = getIncidentTransition(
        recent.rows.map((row) => row.status),
        openIncident.rows.length > 0
      );

      if (transition === 'OPEN') {
        await client.query(
          `INSERT INTO incidents (endpoint_id)
           VALUES ($1) ON CONFLICT (endpoint_id) WHERE resolved_at IS NULL DO NOTHING`,
          [endpointId]
        );
      } else if (transition === 'RESOLVE') {
        await client.query(
          `UPDATE incidents SET resolved_at = clock_timestamp()
           WHERE endpoint_id = $1 AND resolved_at IS NULL`,
          [endpointId]
        );
      }
    }

    return saved.rows[0];
  }

  return {
    async ping() {
      await pool.query('SELECT 1');
    },

    async createEndpoint({ ownerId, name, url, timeoutMs, checkIntervalSeconds = 300 }) {
      const result = await pool.query(
        `INSERT INTO monitored_endpoints (owner_id, name, url, timeout_ms, check_interval_seconds)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, url, timeout_ms AS "timeoutMs",
                   check_interval_seconds AS "checkIntervalSeconds",
                   next_check_at AS "nextCheckAt", is_active AS "isActive", created_at AS "createdAt"`,
        [ownerId, name, url, timeoutMs, checkIntervalSeconds]
      );
      return result.rows[0];
    },

    async listEndpoints(ownerId) {
      const result = await pool.query(
        `SELECT endpoint.id, endpoint.name, endpoint.url,
                endpoint.timeout_ms AS "timeoutMs",
                endpoint.check_interval_seconds AS "checkIntervalSeconds",
                endpoint.next_check_at AS "nextCheckAt",
                endpoint.is_active AS "isActive",
                endpoint.created_at AS "createdAt",
                latest.status AS "latestStatus",
                latest.http_status AS "latestHttpStatus",
                latest.latency_ms AS "latestLatencyMs",
                latest.checked_at AS "latestCheckedAt"
         FROM monitored_endpoints AS endpoint
         LEFT JOIN LATERAL (
           SELECT status, http_status, latency_ms, checked_at
           FROM check_results
           WHERE endpoint_id = endpoint.id
           ORDER BY checked_at DESC, id DESC
           LIMIT 1
         ) AS latest ON TRUE
         WHERE endpoint.owner_id = $1
         ORDER BY endpoint.created_at DESC, endpoint.id`,
        [ownerId]
      );
      return result.rows;
    },

    async findEndpointById(id, ownerId) {
      const result = await pool.query(
        `SELECT id, name, url, timeout_ms AS "timeoutMs",
                check_interval_seconds AS "checkIntervalSeconds",
                next_check_at AS "nextCheckAt", is_active AS "isActive", created_at AS "createdAt"
         FROM monitored_endpoints WHERE id = $1 AND owner_id = $2`,
        [id, ownerId]
      );
      return result.rows[0] ?? null;
    },

    async deleteEndpoint(id, ownerId) {
      const result = await pool.query(
        `DELETE FROM monitored_endpoints
         WHERE id = $1 AND owner_id = $2
         RETURNING id`,
        [id, ownerId]
      );
      return result.rowCount === 1;
    },

    async createCheck({ endpointId, ownerId, status, httpStatus, latencyMs, errorType }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const owned = await client.query(
          'SELECT id FROM monitored_endpoints WHERE id = $1 AND owner_id = $2 FOR UPDATE',
          [endpointId, ownerId]
        );
        if (!owned.rows[0]) {
          await client.query('COMMIT');
          return null;
        }
        const saved = await insertCheckAndUpdateIncident(client, {
          endpointId, status, httpStatus, latencyMs, errorType, checkSource: 'MANUAL'
        });
        await client.query('COMMIT');
        return saved;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listChecks(endpointId, limit, ownerId) {
      const result = await pool.query(
        `SELECT id, endpoint_id AS "endpointId", checked_at AS "checkedAt", status,
                check_source AS "checkSource", http_status AS "httpStatus",
                latency_ms AS "latencyMs", error_type AS "errorType"
         FROM check_results
         WHERE endpoint_id = $1
           AND EXISTS (
             SELECT 1 FROM monitored_endpoints
             WHERE monitored_endpoints.id = check_results.endpoint_id
               AND monitored_endpoints.owner_id = $3
           )
         ORDER BY checked_at DESC, id DESC
         LIMIT $2`,
        [endpointId, limit, ownerId]
      );
      return result.rows;
    },

    async claimDueEndpoints(limit = 10) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const claimed = await client.query(
          `SELECT id FROM monitored_endpoints
           WHERE is_active = TRUE AND next_check_at <= NOW()
             AND (check_lease_until IS NULL OR check_lease_until <= NOW())
           ORDER BY next_check_at, id
           LIMIT $1
           FOR UPDATE SKIP LOCKED`,
          [limit]
        );
        const ids = claimed.rows.map(({ id }) => id);
        if (ids.length === 0) {
          await client.query('COMMIT');
          return [];
        }
        await client.query(
          `UPDATE monitored_endpoints
           SET check_lease_until = NOW() + (timeout_ms + 30000) * INTERVAL '1 millisecond',
               check_lease_token = gen_random_uuid()
           WHERE id = ANY($1::uuid[])`,
          [ids]
        );
        const result = await client.query(
          `SELECT id, name, url, timeout_ms AS "timeoutMs",
                  check_interval_seconds AS "checkIntervalSeconds",
                  check_lease_token AS "leaseToken"
           FROM monitored_endpoints WHERE id = ANY($1::uuid[]) ORDER BY next_check_at, id`,
          [ids]
        );
        await client.query('COMMIT');
        return result.rows;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async recordScheduledCheck({ endpointId, leaseToken, status, httpStatus, latencyMs, errorType }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const endpoint = await client.query(
          `SELECT id FROM monitored_endpoints
           WHERE id = $1 AND is_active = TRUE AND check_lease_token = $2 FOR UPDATE`,
          [endpointId, leaseToken]
        );
        if (!endpoint.rows[0]) {
          await client.query('COMMIT');
          return null;
        }
        const saved = await insertCheckAndUpdateIncident(client, {
          endpointId, status, httpStatus, latencyMs, errorType, checkSource: 'SCHEDULED'
        });
        await client.query(
          `UPDATE monitored_endpoints
           SET next_check_at = clock_timestamp() + check_interval_seconds * INTERVAL '1 second',
               check_lease_until = NULL, check_lease_token = NULL
           WHERE id = $1`,
          [endpointId]
        );
        await client.query('COMMIT');
        return saved;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listIncidents(endpointId, ownerId) {
      const result = await pool.query(
        `SELECT id, endpoint_id AS "endpointId", opened_at AS "openedAt",
                resolved_at AS "resolvedAt"
         FROM incidents
         WHERE endpoint_id = $1 AND EXISTS (
           SELECT 1 FROM monitored_endpoints
           WHERE monitored_endpoints.id = incidents.endpoint_id
             AND monitored_endpoints.owner_id = $2
         )
         ORDER BY opened_at DESC, id DESC`,
        [endpointId, ownerId]
      );
      return result.rows;
    }
  };
}
