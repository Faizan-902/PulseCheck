export function createAuthModel(pool) {
  return {
    async createUserAndSession({ name, email, passwordHash, tokenHash, csrfToken, expiresAt }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const userResult = await client.query(
          `INSERT INTO users (name, email, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id, name, email, created_at AS "createdAt"`,
          [name, email, passwordHash]
        );
        const user = userResult.rows[0];
        await client.query(
          `INSERT INTO user_sessions (user_id, token_hash, csrf_token, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [user.id, tokenHash, csrfToken, expiresAt]
        );
        await client.query('COMMIT');
        return user;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async findUserByEmail(email) {
      const result = await pool.query(
        `SELECT id, name, email, password_hash AS "passwordHash",
                created_at AS "createdAt"
         FROM users WHERE lower(email) = lower($1)`,
        [email]
      );
      return result.rows[0] ?? null;
    },

    async createSession({ userId, tokenHash, csrfToken, expiresAt }) {
      await pool.query(
        `INSERT INTO user_sessions (user_id, token_hash, csrf_token, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, tokenHash, csrfToken, expiresAt]
      );
    },

    async findSessionByTokenHash(tokenHash) {
      const result = await pool.query(
        `SELECT session.user_id AS "userId", session.csrf_token AS "csrfToken",
                users.name, users.email
         FROM user_sessions AS session
         JOIN users ON users.id = session.user_id
         WHERE session.token_hash = $1 AND session.expires_at > NOW()`,
        [tokenHash]
      );
      return result.rows[0] ?? null;
    },

    async deleteSession(tokenHash) {
      await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
    },

    async deleteExpiredSessionsBatch(limit = 500) {
      const result = await pool.query(
        `WITH expired AS (
           SELECT id FROM user_sessions
           WHERE expires_at <= clock_timestamp()
           ORDER BY expires_at, id
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         DELETE FROM user_sessions AS sessions
         USING expired
         WHERE sessions.id = expired.id
         RETURNING sessions.id`,
        [limit]
      );
      return result.rowCount;
    }
  };
}
