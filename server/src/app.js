import express from 'express';
import { createEndpointsRouter } from './routes/endpoints.js';
import { createHealthRouter } from './routes/health.js';
import { createAuthRouter } from './routes/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createAuthentication } from './middleware/authentication.js';
import { performHealthCheck } from './services/health-check.js';

const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' };

function requestProtocol(request) {
  const forwarded = request.headers['x-forwarded-proto'];
  const candidate = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim().toLowerCase();
  if (candidate && DEFAULT_PORTS[`${candidate}:`]) return `${candidate}:`;
  return request.protocol === 'https' ? 'https:' : 'http:';
}

function parseOrigin(origin) {
  if (typeof origin !== 'string' || origin.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (!DEFAULT_PORTS[parsed.protocol]) return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
  const defaultPort = DEFAULT_PORTS[parsed.protocol];
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname.toLowerCase().replace(/\.$/, ''),
    port: parsed.port || defaultPort,
    defaultPort
  };
}

function parseRequestHost(hostHeader, defaultPort) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(`http://${hostHeader}`);
  } catch {
    return null;
  }
  return {
    hostname: parsed.hostname.toLowerCase().replace(/\.$/, ''),
    port: parsed.port || defaultPort
  };
}

function isSameDeploymentOrigin(origin, hostHeader, protocol) {
  const parsedOrigin = parseOrigin(origin);
  if (!parsedOrigin || parsedOrigin.protocol !== protocol) return false;
  const parsedHost = parseRequestHost(hostHeader, parsedOrigin.defaultPort);
  if (!parsedHost) return false;
  return parsedOrigin.hostname === parsedHost.hostname && parsedOrigin.port === parsedHost.port;
}

export function createApp({
  model,
  authModel,
  resolver,
  defaultTimeoutMs = 5000,
  checkEndpoint = performHealthCheck,
  frontendOrigin = 'http://localhost:5173',
  cookieSecure = false,
  cookieSameSite = 'lax',
  sessionTtlHours = 168,
  loginRateLimit,
  loginRateLimitStore,
  signupRateLimit,
  signupRateLimitStore
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  const authentication = createAuthentication({ authModel });
  app.use((request, response, next) => {
    const origin = request.headers.origin;
    const isAllowedOrigin = origin === frontendOrigin
      || isSameDeploymentOrigin(origin, request.get('host'), requestProtocol(request));
    if (isAllowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
      response.sendStatus(isAllowedOrigin ? 204 : 403);
      return;
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !isAllowedOrigin) {
      response.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This request origin is not allowed.' } });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/health', createHealthRouter(model));
  app.use('/api/auth', createAuthRouter({ authModel, authentication, cookieSecure, cookieSameSite, sessionTtlHours, loginRateLimit, loginRateLimitStore, signupRateLimit, signupRateLimitStore }));
  app.use('/api/endpoints', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/endpoints', authentication.requireAuthentication, createEndpointsRouter({
    model,
    checkEndpoint,
    resolver,
    defaultTimeoutMs,
    authentication
  }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
