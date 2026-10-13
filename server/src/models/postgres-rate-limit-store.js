import { createHash } from 'node:crypto';

const CLEANUP_EVERY = 128;

export function createPostgresRateLimitStore(pool, namespace = 'login') {
  let windowMs = 15 * 60 * 1000;
  let incrementsSinceCleanup = 0;

  function keyHash(key) {
    return createHash('sha256').update(`pulsecheck-${namespace}:${key}`).digest('hex');
  }

  async function deleteExpiredBatch(limit = 500) {
    const result = await pool.query(
      `WITH expired AS (
         SELECT key_hash FROM login_rate_limits
         WHERE reset_at <= clock_timestamp()
         ORDER BY reset_at, key_hash
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM login_rate_limits AS limits
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

    async increment(key) {
      const result = await pool.query(
        `INSERT INTO login_rate_limits (key_hash, hits, reset_at)
         VALUES ($1, 1, clock_timestamp() + ($2 * INTERVAL '1 millisecond'))
         ON CONFLICT (key_hash) DO UPDATE
         SET hits = CASE
               WHEN login_rate_limits.reset_at <= statement_timestamp() THEN 1
               ELSE login_rate_limits.hits + 1
             END,
             reset_at = CASE
               WHEN login_rate_limits.reset_at <= statement_timestamp() THEN EXCLUDED.reset_at
               ELSE login_rate_limits.reset_at
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
        `UPDATE login_rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key_hash = $1`,
        [keyHash(key)]
      );
    },

    async resetKey(key) {
      await pool.query('DELETE FROM login_rate_limits WHERE key_hash = $1', [keyHash(key)]);
    },

    deleteExpiredBatch
  };
}
