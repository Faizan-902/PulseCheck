import pg from 'pg';
import { DEFAULT_MAX_ENDPOINTS_PER_USER } from '../config/endpoint-limits.js';
import { AppError } from '../middleware/errors.js';
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

    async createEndpoint({
      ownerId, name, url, timeoutMs, checkIntervalSeconds = 300,
      maxEndpointsPerUser = DEFAULT_MAX_ENDPOINTS_PER_USER
    }) {
      const client = await pool.connect();
      try {
        // Serialize creates by owner. The count runs after the lock is granted,
        // so it sees a competing create that committed while this request waited.
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const owner = await client.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [ownerId]);
        if (!owner.rowCount) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');

        const { rows: [{ count }] } = await client.query(
          'SELECT count(*)::integer AS count FROM monitored_endpoints WHERE owner_id = $1',
          [ownerId]
        );
        if (count >= maxEndpointsPerUser) {
          throw new AppError(409, 'endpoint_limit_reached', `You can register up to ${maxEndpointsPerUser} monitors.`);
        }

        const result = await client.query(
          `INSERT INTO monitored_endpoints (owner_id, name, url, timeout_ms, check_interval_seconds)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, url, timeout_ms AS "timeoutMs",
                     check_interval_seconds AS "checkIntervalSeconds",
                     next_check_at AS "nextCheckAt", is_active AS "isActive", created_at AS "createdAt"`,
          [ownerId, name, url, timeoutMs, checkIntervalSeconds]
        );
        await client.query('COMMIT');
        return result.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
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
                latest.checked_at AS "latestCheckedAt",
                open_incident.count AS open_incident_count,
                recent_incidents.items AS "recentIncidents"
         FROM monitored_endpoints AS endpoint
         LEFT JOIN LATERAL (
           SELECT status, http_status, latency_ms, checked_at
           FROM check_results
           WHERE endpoint_id = endpoint.id
           ORDER BY checked_at DESC, id DESC
           LIMIT 1
         ) AS latest ON TRUE
         CROSS JOIN LATERAL (
           SELECT count(*)::integer AS count
           FROM incidents
           WHERE endpoint_id = endpoint.id AND resolved_at IS NULL
         ) AS open_incident
         CROSS JOIN LATERAL (
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', id, 'openedAt', opened_at, 'resolvedAt', resolved_at
           ) ORDER BY opened_at DESC, id DESC), '[]'::jsonb) AS items
           FROM (
             SELECT id, opened_at, resolved_at
             FROM incidents
             WHERE endpoint_id = endpoint.id
             ORDER BY opened_at DESC, id DESC
             LIMIT 5
           ) AS recent
         ) AS recent_incidents
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

    async withScheduledRun(run) {
      // Use a dedicated connection so claims and writes can use the pool even at max=1.
      // A transaction-scoped lock also works through a transaction-mode pooler.
      const client = new pg.Client(pool.options);
      client.on('error', () => {});
      await client.connect();
      try {
        await client.query('BEGIN');
        const { rows: [lock] } = await client.query(
          'SELECT pg_try_advisory_xact_lock(529041, 1) AS acquired, clock_timestamp() AS cutoff'
        );
        return lock.acquired ? await run(lock.cutoff) : null;
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        await client.end().catch(() => {});
      }
    },

    async claimDueEndpoints(limit = 10, cutoff = null) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const claimed = await client.query(
          `SELECT id FROM monitored_endpoints
           WHERE is_active = TRUE AND next_check_at <= COALESCE($2::timestamptz, NOW())
             AND (check_lease_until IS NULL OR check_lease_until <= NOW())
           ORDER BY next_check_at, id
           LIMIT $1
           FOR UPDATE SKIP LOCKED`,
          [limit, cutoff]
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

    async recordScheduledCheck({ endpointId, leaseToken, status, httpStatus, latencyMs, errorType }, scheduling = {}) {
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
           SET next_check_at = COALESCE($2::timestamptz, clock_timestamp())
                                 + GREATEST(check_interval_seconds, $3) * INTERVAL '1 second',
               check_lease_until = NULL, check_lease_token = NULL
           WHERE id = $1`,
          [endpointId, scheduling.cutoff ?? null, scheduling.minIntervalSeconds ?? 0]
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

    async listIncidentFeed(ownerId, limit = 100) {
      const result = await pool.query(
        `SELECT incident.id, incident.endpoint_id AS "endpointId",
                incident.opened_at AS "openedAt", incident.resolved_at AS "resolvedAt",
                endpoint.name AS "endpointName"
         FROM monitored_endpoints AS endpoint
         JOIN incidents AS incident ON incident.endpoint_id = endpoint.id
         WHERE endpoint.owner_id = $1
         ORDER BY incident.opened_at DESC, incident.id DESC
         LIMIT $2`,
        [ownerId, limit]
      );
      return result.rows;
    },

    async listIncidents(endpointId, ownerId, limit = 100) {
      const result = await pool.query(
        `SELECT id, endpoint_id AS "endpointId", opened_at AS "openedAt",
                resolved_at AS "resolvedAt"
         FROM incidents
         WHERE endpoint_id = $1 AND EXISTS (
           SELECT 1 FROM monitored_endpoints
           WHERE monitored_endpoints.id = incidents.endpoint_id
             AND monitored_endpoints.owner_id = $2
         )
         ORDER BY opened_at DESC, id DESC
         LIMIT $3`,
        [endpointId, ownerId, limit]
      );
      return result.rows;
    }
  };
}
