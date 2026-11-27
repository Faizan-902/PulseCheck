import { createHash } from 'node:crypto';

const CLEANUP_EVERY = 128;

export function createPostgresRateLimitStore(pool, namespace = 'login') {
  return createStore(pool, namespace, 'login_rate_limits');
}

export function createEndpointRateLimitStore(pool, namespace) {
  return createStore(pool, namespace, 'rate_limits');
}

export function createEndpointRateLimitStores(pool) {
  return {
    create: createEndpointRateLimitStore(pool, 'create'),
    checkUser: createEndpointRateLimitStore(pool, 'check-user'),
    checkEndpoint: createEndpointRateLimitStore(pool, 'check-endpoint')
  };
}

function createStore(pool, namespace, table) {
  let windowMs = 15 * 60 * 1000;
  let incrementsSinceCleanup = 0;

  function keyHash(key) {
    return createHash('sha256').update(`pulsecheck-${namespace}:${key}`).digest('hex');
  }

  async function deleteExpiredBatch(limit = 500) {
    const result = await pool.query(
      `WITH expired AS (
         SELECT key_hash FROM ${table}
         WHERE reset_at <= clock_timestamp()
         ORDER BY reset_at, key_hash
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM ${table} AS limits
       USING expired
       WHERE limits.key_hash = expired.key_hash
       RETURNING limits.key_hash`,
      [limit]
    );
    return result.rowCount;
  }

  return {
    localKeys: false,

    init(options) {
      windowMs = options.windowMs;
    },

    async get(key) {
      const result = await pool.query(
        `SELECT hits AS "totalHits", reset_at AS "resetTime"
         FROM ${table}
         WHERE key_hash = $1 AND reset_at > clock_timestamp()`,
        [keyHash(key)]
      );
      return result.rows[0];
    },

    async increment(key) {
      const result = await pool.query(
        `INSERT INTO ${table} AS limits (key_hash, hits, reset_at)
         VALUES ($1, 1, clock_timestamp() + ($2 * INTERVAL '1 millisecond'))
         ON CONFLICT (key_hash) DO UPDATE
         SET hits = CASE
               WHEN limits.reset_at <= statement_timestamp() THEN 1
               ELSE limits.hits + 1
             END,
             reset_at = CASE
               WHEN limits.reset_at <= statement_timestamp() THEN EXCLUDED.reset_at
               ELSE limits.reset_at
             END
         RETURNING hits AS "totalHits", reset_at AS "resetTime"`,
        [keyHash(key), windowMs]
      );

      incrementsSinceCleanup += 1;
      if (incrementsSinceCleanup >= CLEANUP_EVERY) {
        incrementsSinceCleanup = 0;
        await deleteExpiredBatch();
      }

      return result.rows[0];
    },

    async decrement(key) {
      await pool.query(
        `UPDATE ${table} SET hits = GREATEST(hits - 1, 0) WHERE key_hash = $1`,
        [keyHash(key)]
      );
    },

    async resetKey(key) {
      await pool.query(`DELETE FROM ${table} WHERE key_hash = $1`, [keyHash(key)]);
    },

    deleteExpiredBatch
  };
}
