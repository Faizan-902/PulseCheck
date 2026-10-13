import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createAuthController } from '../controllers/auth-controller.js';
import { loginSchema, signupSchema } from '../validation/schemas.js';

function validate(schema) {
  return (request, _response, next) => {
    try {
      request.body = schema.parse(request.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createAuthRouter({
  authModel,
  authentication,
  cookieSecure,
  cookieSameSite,
  sessionTtlHours,
  loginRateLimitStore,
  signupRateLimitStore,
  loginRateLimit = { windowMs: 15 * 60 * 1000, limit: 10 },
  signupRateLimit = { windowMs: 60 * 60 * 1000, limit: 5 }
}) {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  const controller = createAuthController({ authModel, cookieSecure, cookieSameSite, sessionTtlHours });
  const createAuthLimiter = (config, store, code, message) => rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    ...(store ? { store } : {}),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ error: { code, message } })
  });
  const loginLimiter = createAuthLimiter(loginRateLimit, loginRateLimitStore,
    'LOGIN_RATE_LIMITED', 'Too many login attempts. Try again later.');
  const signupLimiter = createAuthLimiter(signupRateLimit, signupRateLimitStore,
    'SIGNUP_RATE_LIMITED', 'Too many account creation attempts. Try again later.');

  router.post('/signup', signupLimiter, validate(signupSchema), controller.signup);
  router.post('/login', loginLimiter, validate(loginSchema), controller.login);
  router.get('/me', authentication.requireAuthentication, controller.currentUser);
  router.post('/logout', authentication.requireAuthentication, authentication.requireCsrf, controller.logout);
  return router;
}
