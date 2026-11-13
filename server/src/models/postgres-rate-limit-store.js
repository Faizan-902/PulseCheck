import { createHash } from 'node:crypto';

const CLEANUP_EVERY = 128;

export function createPostgresRateLimitStore(prisma, namespace = 'login') {
  let windowMs = 15 * 60 * 1000;
  let incrementsSinceCleanup = 0;

  function keyHash(key) {
    return createHash('sha256').update(`pulsecheck-${namespace}:${key}`).digest('hex');
  }

  async function deleteExpiredBatch(limit = 500) {
    const deleted = await prisma.$queryRaw`
      WITH expired AS (
        SELECT key_hash FROM login_rate_limits
        WHERE reset_at <= clock_timestamp()
        ORDER BY reset_at, key_hash
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM login_rate_limits AS limits
      USING expired
      WHERE limits.key_hash = expired.key_hash
      RETURNING limits.key_hash
    `;
    return deleted.length;
  }

  return {
    localKeys: false,

    init(options) {
      windowMs = options.windowMs;
    },

    async increment(key) {
      const rows = await prisma.$queryRaw`
        INSERT INTO login_rate_limits (key_hash, hits, reset_at)
        VALUES (${keyHash(key)}, 1, clock_timestamp() + (${windowMs} * INTERVAL '1 millisecond'))
        ON CONFLICT (key_hash) DO UPDATE
        SET hits = CASE
              WHEN login_rate_limits.reset_at <= statement_timestamp() THEN 1
              ELSE login_rate_limits.hits + 1
            END,
            reset_at = CASE
              WHEN login_rate_limits.reset_at <= statement_timestamp()
                THEN EXCLUDED.reset_at
              ELSE login_rate_limits.reset_at
            END
        RETURNING hits AS "totalHits", reset_at AS "resetTime"
      `;

      incrementsSinceCleanup += 1;
      if (incrementsSinceCleanup >= CLEANUP_EVERY) {
        incrementsSinceCleanup = 0;
        await deleteExpiredBatch();
      }

      return rows[0];
    },

    async decrement(key) {
      await prisma.$executeRaw`
        UPDATE login_rate_limits
        SET hits = GREATEST(hits - 1, 0)
        WHERE key_hash = ${keyHash(key)}
      `;
    },

    async resetKey(key) {
      await prisma.$executeRaw`DELETE FROM login_rate_limits WHERE key_hash = ${keyHash(key)}`;
    },

    deleteExpiredBatch
  };
}
