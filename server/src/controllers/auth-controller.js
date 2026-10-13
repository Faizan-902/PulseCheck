import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import { hashSecret, SESSION_COOKIE_NAME, sessionCookieOptions } from '../middleware/authentication.js';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
};
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,p=1,t=2$bFFaM509Gg3cQAugMLt77A$iXUhH/ueBPh/2o4udgXX7OTYm0lF2Cwte358MI5wHHk';

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

export function createAuthController({ authModel, cookieSecure, cookieSameSite, sessionTtlHours }) {
  const cookieOptions = sessionCookieOptions({ secure: cookieSecure, sameSite: cookieSameSite });

  function issueSession(response, user, csrfToken, sessionToken) {
    response.cookie(SESSION_COOKIE_NAME, sessionToken, {
      ...cookieOptions,
      maxAge: sessionTtlHours * 60 * 60 * 1000
    });
    response.json({ data: { user: publicUser(user), csrfToken } });
  }

  function newSessionValues() {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    return {
      token,
      csrfToken,
      tokenHash: hashSecret(token),
      expiresAt: new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000)
    };
  }

  return {
    async signup(request, response) {
      const passwordHash = await argon2.hash(request.body.password, ARGON2_OPTIONS);
      const session = newSessionValues();
      try {
        const user = await authModel.createUserAndSession({
          name: request.body.name,
          email: request.body.email,
          passwordHash,
          tokenHash: session.tokenHash,
          csrfToken: session.csrfToken,
          expiresAt: session.expiresAt
        });
        response.status(201);
        issueSession(response, user, session.csrfToken, session.token);
      } catch (error) {
        if (error.code === '23505') throw new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists.');
        throw error;
      }
    },

    async login(request, response) {
      const user = await authModel.findUserByEmail(request.body.email);
      let passwordIsValid = false;
      if (user) {
        passwordIsValid = await argon2.verify(user.passwordHash, request.body.password).catch(() => false);
      } else {
        // Keep the missing-account path close to the normal Argon2 verification cost.
        await argon2.verify(DUMMY_PASSWORD_HASH, request.body.password).catch(() => false);
      }
      if (!user || !passwordIsValid) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }

      const session = newSessionValues();
      await authModel.createSession({
        userId: user.id,
        tokenHash: session.tokenHash,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt
      });
      issueSession(response, user, session.csrfToken, session.token);
    },

    async currentUser(request, response) {
      response.json({ data: { user: request.user, csrfToken: request.authSession.csrfToken } });
    },

    async logout(request, response) {
      await authModel.deleteSession(request.authSession.tokenHash);
      response.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
      response.json({ data: { loggedOut: true } });
    }
  };
}
