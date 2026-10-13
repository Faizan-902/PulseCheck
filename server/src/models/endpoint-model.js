export function createEndpointModel(pool) {
  return {
    async ping() {
      await pool.query('SELECT 1');
    },

    async createEndpoint({ name, url, timeoutMs }) {
      const result = await pool.query(
        `INSERT INTO monitored_endpoints (name, url, timeout_ms)
         VALUES ($1, $2, $3)
         RETURNING id, name, url, timeout_ms AS "timeoutMs", is_active AS "isActive", created_at AS "createdAt"`,
        [name, url, timeoutMs]
      );
      return result.rows[0];
    },

    async listEndpoints() {
      const result = await pool.query(
        `SELECT endpoint.id, endpoint.name, endpoint.url,
                endpoint.timeout_ms AS "timeoutMs",
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
         ORDER BY endpoint.created_at DESC, endpoint.id`
      );
      return result.rows;
    },

    async findEndpointById(id) {
      const result = await pool.query(
        `SELECT id, name, url, timeout_ms AS "timeoutMs",
                is_active AS "isActive", created_at AS "createdAt"
         FROM monitored_endpoints WHERE id = $1`,
        [id]
      );
      return result.rows[0] ?? null;
    },

    async createCheck({ endpointId, status, httpStatus, latencyMs, errorType }) {
      const result = await pool.query(
        `INSERT INTO check_results (endpoint_id, status, http_status, latency_ms, error_type)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, endpoint_id AS "endpointId", checked_at AS "checkedAt", status,
                   http_status AS "httpStatus", latency_ms AS "latencyMs", error_type AS "errorType"`,
        [endpointId, status, httpStatus, latencyMs, errorType]
      );
      return result.rows[0];
    },

    async listChecks(endpointId, limit) {
      const result = await pool.query(
        `SELECT id, endpoint_id AS "endpointId", checked_at AS "checkedAt", status,
                http_status AS "httpStatus", latency_ms AS "latencyMs", error_type AS "errorType"
         FROM check_results
         WHERE endpoint_id = $1
         ORDER BY checked_at DESC, id DESC
         LIMIT $2`,
        [endpointId, limit]
      );
      return result.rows;
    }
  };
}
