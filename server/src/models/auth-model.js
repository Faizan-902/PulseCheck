export function createAuthModel(prisma) {
  return {
    async createUserAndSession({ name, email, passwordHash, tokenHash, csrfToken, expiresAt }) {
      return prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name,
            email,
            passwordHash,
            sessions: { create: { tokenHash, csrfToken, expiresAt } }
          },
          select: { id: true, name: true, email: true, createdAt: true }
        });
        return user;
      });
    },

    async findUserByEmail(email) {
      return prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, name: true, email: true, passwordHash: true, createdAt: true }
      });
    },

    async createSession({ userId, tokenHash, csrfToken, expiresAt }) {
      await prisma.userSession.create({
        data: { userId, tokenHash, csrfToken, expiresAt }
      });
    },

    async findSessionByTokenHash(tokenHash) {
      const session = await prisma.userSession.findFirst({
        where: { tokenHash, expiresAt: { gt: new Date() } },
        select: { csrfToken: true, user: { select: { id: true, name: true, email: true } } }
      });
      if (!session) return null;
      return {
        userId: session.user.id,
        csrfToken: session.csrfToken,
        name: session.user.name,
        email: session.user.email
      };
    },

    async deleteSession(tokenHash) {
      await prisma.userSession.deleteMany({ where: { tokenHash } });
    },

    async deleteExpiredSessionsBatch(limit = 500) {
      const expired = await prisma.$queryRaw`
        WITH expired AS (
          SELECT id FROM user_sessions
          WHERE expires_at <= clock_timestamp()
          ORDER BY expires_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM user_sessions AS sessions
        USING expired
        WHERE sessions.id = expired.id
        RETURNING sessions.id
      `;
      return expired.length;
    }
  };
}
