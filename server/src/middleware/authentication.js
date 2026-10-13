import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

export const SESSION_COOKIE_NAME = 'pulsecheck_session';

export function hashSecret(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export function sessionCookieOptions({ secure, sameSite }) {
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api'
  };
}

export function createAuthentication({ authModel }) {
  async function requireAuthentication(request, _response, next) {
    try {
      const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
      if (!token || token.length > 128) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
      const tokenHash = hashSecret(token);
      const session = await authModel.findSessionByTokenHash(tokenHash);
      if (!session) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
      request.user = { id: session.userId, name: session.name, email: session.email };
      request.authSession = { tokenHash, csrfToken: session.csrfToken };
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireCsrf(request, _response, next) {
    const supplied = request.get('X-CSRF-Token');
    if (!supplied || supplied.length > 128) {
      next(new AppError(403, 'CSRF_INVALID', 'A valid CSRF token is required.'));
      return;
    }
    const expectedHash = Buffer.from(hashSecret(request.authSession.csrfToken), 'hex');
    const suppliedHash = Buffer.from(hashSecret(supplied), 'hex');
    if (!timingSafeEqual(expectedHash, suppliedHash)) {
      next(new AppError(403, 'CSRF_INVALID', 'A valid CSRF token is required.'));
      return;
    }
    next();
  }

  return { requireAuthentication, requireCsrf };
}
