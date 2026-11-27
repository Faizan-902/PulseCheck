import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import {
  hashSecret,
  readCookie,
  SESSION_COOKIE_NAME,
  sessionCookieOptions
} from '../middleware/authentication.js';
import { createPkceChallenge } from '../services/google-oauth.js';

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

const OAUTH_COOKIE_NAME = 'pulsecheck_oauth';
const OAUTH_TTL_MS = 10 * 60 * 1000;

export function createAuthController({
  authModel,
  cookieSecure,
  cookieSameSite,
  sessionTtlHours,
  frontendOrigin = 'http://localhost:5173',
  googleOAuth = null,
  googleRedirectUri = null
}) {
  const cookieOptions = sessionCookieOptions({ secure: cookieSecure, sameSite: cookieSameSite });
  const oauthCookieOptions = {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    path: '/api/auth/google'
  };

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
      if (user?.passwordHash) {
        passwordIsValid = await argon2.verify(user.passwordHash, request.body.password).catch(() => false);
      } else {
        // Keep the missing-account and Google-only path close to normal Argon2 cost.
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

    async googleStart(_request, response) {
      if (!googleOAuth) {
        response.redirect(302, `${frontendOrigin}/#signin?authError=google_not_configured`);
        return;
      }

      const state = randomBytes(32).toString('base64url');
      const bindingToken = randomBytes(32).toString('base64url');
      const codeVerifier = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const redirectUri = googleRedirectUri || `${frontendOrigin}/api/auth/google/callback`;

      await authModel.createOAuthState({
        stateHash: hashSecret(state),
        bindingHash: hashSecret(bindingToken),
        codeVerifier,
        nonce,
        redirectUri,
        expiresAt: new Date(Date.now() + OAUTH_TTL_MS)
      });

      response.cookie(OAUTH_COOKIE_NAME, bindingToken, {
        ...oauthCookieOptions,
        maxAge: OAUTH_TTL_MS
      });
      response.redirect(
        302,
        googleOAuth.authorizationUrl({
          redirectUri,
          state,
          nonce,
          codeChallenge: createPkceChallenge(codeVerifier)
        })
      );
    },

    async googleCallback(request, response) {
      const fail = (errorCode = 'google_auth_failed') => {
        response.clearCookie(OAUTH_COOKIE_NAME, oauthCookieOptions);
        response.redirect(302, `${frontendOrigin}/#signin?authError=${errorCode}`);
      };

      if (!googleOAuth) {
        fail('google_not_configured');
        return;
      }

      if (request.query?.error) {
        fail(request.query.error === 'access_denied' ? 'google_cancelled' : 'google_auth_failed');
        return;
      }

      const code = typeof request.query?.code === 'string' ? request.query.code : '';
      const state = typeof request.query?.state === 'string' ? request.query.state : '';
      const bindingToken = readCookie(request.headers.cookie, OAUTH_COOKIE_NAME);
      if (!code || !state || !bindingToken || state.length > 128 || bindingToken.length > 128) {
        fail();
        return;
      }

      const consumed = await authModel.consumeOAuthState({
        stateHash: hashSecret(state),
        bindingHash: hashSecret(bindingToken)
      });
      response.clearCookie(OAUTH_COOKIE_NAME, oauthCookieOptions);
      if (!consumed) {
        fail();
        return;
      }

      try {
        const googleUser = await googleOAuth.exchangeCodeForUser({
          code,
          codeVerifier: consumed.codeVerifier,
          redirectUri: consumed.redirectUri,
          expectedNonce: consumed.nonce
        });
        const session = newSessionValues();
        await authModel.findOrCreateGoogleUserAndSession({
          googleSub: googleUser.sub,
          email: googleUser.email,
          name: googleUser.name,
          tokenHash: session.tokenHash,
          csrfToken: session.csrfToken,
          expiresAt: session.expiresAt
        });
        response.cookie(SESSION_COOKIE_NAME, session.token, {
          ...cookieOptions,
          maxAge: sessionTtlHours * 60 * 60 * 1000
        });
        response.redirect(302, `${frontendOrigin}/#overview`);
      } catch (error) {
        console.error('Google OAuth callback failed:', error?.message ?? error);
        fail();
      }
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
