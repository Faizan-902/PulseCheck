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
    },

    async createOAuthState({ stateHash, bindingHash, codeVerifier, nonce, redirectUri, expiresAt }) {
      await pool.query(
        `INSERT INTO oauth_states (state_hash, binding_hash, code_verifier, nonce, redirect_uri, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [stateHash, bindingHash, codeVerifier, nonce, redirectUri, expiresAt]
      );
    },

    async consumeOAuthState({ stateHash, bindingHash }) {
      const result = await pool.query(
        `DELETE FROM oauth_states
         WHERE state_hash = $1 AND binding_hash = $2 AND expires_at > clock_timestamp()
         RETURNING code_verifier AS "codeVerifier", nonce, redirect_uri AS "redirectUri"`,
        [stateHash, bindingHash]
      );
      return result.rows[0] ?? null;
    },

    async deleteExpiredOAuthStatesBatch(limit = 500) {
      const result = await pool.query(
        `WITH expired AS (
           SELECT state_hash FROM oauth_states
           WHERE expires_at <= clock_timestamp()
           ORDER BY expires_at, state_hash
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         DELETE FROM oauth_states AS states
         USING expired
         WHERE states.state_hash = expired.state_hash
         RETURNING states.state_hash`,
        [limit]
      );
      return result.rowCount;
    },

    async findOrCreateGoogleUserAndSession({ googleSub, email, name, tokenHash, csrfToken, expiresAt }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let userResult = await client.query(
          `SELECT id, name, email, google_sub AS "googleSub", created_at AS "createdAt"
           FROM users WHERE google_sub = $1`,
          [googleSub]
        );
        let user = userResult.rows[0] ?? null;

        if (!user) {
          const byEmail = await client.query(
            `SELECT id, name, email, google_sub AS "googleSub", created_at AS "createdAt"
             FROM users WHERE lower(email) = lower($1) FOR UPDATE`,
            [email]
          );
          if (byEmail.rows[0]) {
            user = byEmail.rows[0];
            if (user.googleSub && user.googleSub !== googleSub) {
              throw new Error('This email is already linked to a different Google account.');
            }
            if (!user.googleSub) {
              await client.query('UPDATE users SET google_sub = $1 WHERE id = $2', [googleSub, user.id]);
            }
          } else {
            const inserted = await client.query(
              `INSERT INTO users (name, email, google_sub)
               VALUES ($1, $2, $3)
               RETURNING id, name, email, created_at AS "createdAt"`,
              [name, email, googleSub]
            );
            user = inserted.rows[0];
          }
        }

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
    }
  };
}
