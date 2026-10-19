import { describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import request from 'supertest';
import { createApp } from '../src/app.js';

const origin = 'http://localhost:5173';
const userId = '620d7c75-7fca-49ec-a2aa-ea1a66f32e1d';

function makeAuthModel() {
  const users = new Map();
  const sessions = new Map();
  return {
    users,
    sessions,
    createUserAndSession: vi.fn(async ({ name, email, passwordHash, tokenHash, csrfToken }) => {
      if (users.has(email)) throw Object.assign(new Error('duplicate'), { code: '23505' });
      const user = { id: userId, name, email, passwordHash, createdAt: '2026-01-01T00:00:00.000Z' };
      users.set(email, user);
      sessions.set(tokenHash, { userId, name, email, csrfToken });
      return user;
    }),
    findUserByEmail: vi.fn(async (email) => users.get(email) ?? null),
    createSession: vi.fn(async ({ userId: id, tokenHash, csrfToken }) => {
      const user = [...users.values()].find((candidate) => candidate.id === id);
      sessions.set(tokenHash, { userId: id, name: user.name, email: user.email, csrfToken });
    }),
    findSessionByTokenHash: vi.fn(async (tokenHash) => sessions.get(tokenHash) ?? null),
    deleteSession: vi.fn(async (tokenHash) => sessions.delete(tokenHash))
  };
}

function makeApp(authModel, overrides = {}) {
  return createApp({
    model: { ping: vi.fn(async () => {}) },
    authModel,
    frontendOrigin: origin,
    cookieSecure: true,
    cookieSameSite: 'lax',
    sessionTtlHours: 168,
    ...overrides
  });
}

function makeLimitStore() {
  let totalHits = 0;
  return {
    localKeys: false,
    init: vi.fn(),
    increment: vi.fn(async () => ({ totalHits: ++totalHits, resetTime: new Date(Date.now() + 60_000) })),
    decrement: vi.fn(async () => { totalHits = Math.max(0, totalHits - 1); }),
    resetKey: vi.fn(async () => { totalHits = 0; })
  };
}

describe('authentication API', () => {
  it('signs up with Argon2id, sets a secure HttpOnly cookie, supports current-user lookup, and logs out', async () => {
    const authModel = makeAuthModel();
    const app = makeApp(authModel);
    const signup = await request(app).post('/api/auth/signup')
      .set('Origin', origin)
      .send({ name: 'Test User', email: 'TEST@example.com', password: 'a-long-secure-passphrase' });

    expect(signup.status).toBe(201);
    expect(signup.body.data.user).toMatchObject({ id: userId, name: 'Test User', email: 'test@example.com' });
    expect(signup.body.data.csrfToken).toBeTruthy();
    expect(signup.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(signup.headers['set-cookie'][0]).toContain('Secure');
    expect(signup.headers['set-cookie'][0]).toContain('SameSite=Lax');
    const storedUser = authModel.users.get('test@example.com');
    expect(storedUser.passwordHash).not.toBe('a-long-secure-passphrase');
    expect(await argon2.verify(storedUser.passwordHash, 'a-long-secure-passphrase')).toBe(true);
    expect(authModel.createUserAndSession.mock.calls[0][0].tokenHash).not.toMatch(/^[A-Za-z0-9_-]{43}$/);

    const cookie = signup.headers['set-cookie'][0].split(';')[0];
    const current = await request(app).get('/api/auth/me').set('Origin', origin).set('Cookie', cookie);
    expect(current.status).toBe(200);
    expect(current.body.data.user).toMatchObject({ id: userId, email: 'test@example.com' });
    expect(current.body.data.csrfToken).toBe(signup.body.data.csrfToken);

    const logout = await request(app).post('/api/auth/logout')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', current.body.data.csrfToken);
    expect(logout.status).toBe(200);
    expect(authModel.sessions.size).toBe(0);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('logs in with the stored password hash and returns a persistent session cookie', async () => {
    const authModel = makeAuthModel();
    const app = makeApp(authModel);
    const signup = await request(app).post('/api/auth/signup').set('Origin', origin).send({
      name: 'Test User', email: 'person@example.com', password: 'correct horse battery'
    });
    const login = await request(app).post('/api/auth/login').set('Origin', origin).send({
      email: 'PERSON@example.com', password: 'correct horse battery'
    });

    expect(signup.status).toBe(201);
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie'][0]).toContain('pulsecheck_session=');
    expect(authModel.createSession).toHaveBeenCalledTimes(1);
    expect(authModel.createSession.mock.calls[0][0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('validates signup input and rejects cross-origin requests', async () => {
    const authModel = makeAuthModel();
    const app = makeApp(authModel);
    const invalid = await request(app).post('/api/auth/signup').set('Origin', origin).send({
      name: '', email: 'bad-email', password: 'short'
    });
    const originRejected = await request(app).post('/api/auth/signup').set('Origin', 'https://attacker.example').send({
      name: 'Test User', email: 'person@example.com', password: 'a-long-secure-passphrase'
    });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(originRejected.status).toBe(403);
    expect(originRejected.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(authModel.createUserAndSession).not.toHaveBeenCalled();
  });

  it('allows credentialed CORS only for the configured frontend origin', async () => {
    const app = makeApp(makeAuthModel());
    const allowed = await request(app).options('/api/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    const rejected = await request(app).options('/api/auth/login')
      .set('Origin', 'https://attacker.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(origin);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers['access-control-allow-methods']).toContain('DELETE');
    expect(allowed.headers['access-control-allow-headers']).toContain('X-CSRF-Token');
    expect(rejected.status).toBe(403);
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows credentialed CORS for the deployment origin that served the request', async () => {
    const authModel = makeAuthModel();
    const app = makeApp(authModel);
    const deploymentOrigin = 'https://pulsecheck-abc123.vercel.app';
    const allowed = await request(app).options('/api/auth/login')
      .set('Host', 'pulsecheck-abc123.vercel.app')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', deploymentOrigin)
      .set('Access-Control-Request-Method', 'POST');
    const signup = await request(app).post('/api/auth/signup')
      .set('Host', 'pulsecheck-abc123.vercel.app')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', deploymentOrigin)
      .send({ name: 'Test User', email: 'person@example.com', password: 'a-long-secure-passphrase' });
    const crossOrigin = await request(app).post('/api/auth/signup')
      .set('Host', 'pulsecheck-abc123.vercel.app')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://other-deployment.vercel.app')
      .send({ name: 'Test User', email: 'other@example.com', password: 'a-long-secure-passphrase' });

    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(deploymentOrigin);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(signup.status).toBe(201);
    expect(signup.headers['access-control-allow-origin']).toBe(deploymentOrigin);
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('rejects same-host origins with a different scheme or port', async () => {
    const app = makeApp(makeAuthModel());
    const wrongScheme = await request(app).post('/api/auth/signup')
      .set('Host', 'pulsecheck-abc123.vercel.app')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'http://pulsecheck-abc123.vercel.app')
      .send({ name: 'Test User', email: 'person@example.com', password: 'a-long-secure-passphrase' });
    const wrongPort = await request(app).post('/api/auth/signup')
      .set('Host', '127.0.0.1:3001')
      .set('Origin', 'http://127.0.0.1:5173')
      .send({ name: 'Test User', email: 'person@example.com', password: 'a-long-secure-passphrase' });

    expect(wrongScheme.status).toBe(403);
    expect(wrongScheme.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(wrongPort.status).toBe(403);
    expect(wrongPort.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('requires a valid CSRF token for logout and limits login attempts', async () => {
    const authModel = makeAuthModel();
    const app = makeApp(authModel, { loginRateLimit: { windowMs: 60000, limit: 2 } });
    const signup = await request(app).post('/api/auth/signup').set('Origin', origin).send({
      name: 'Test User', email: 'person@example.com', password: 'correct horse battery'
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];
    const rejectedLogout = await request(app).post('/api/auth/logout')
      .set('Origin', origin).set('Cookie', cookie).set('X-CSRF-Token', 'wrong');
    expect(rejectedLogout.status).toBe(403);
    expect(rejectedLogout.body.error.code).toBe('CSRF_INVALID');

    const failedLogin = () => request(app).post('/api/auth/login').set('Origin', origin).send({ email: 'none@example.com', password: 'incorrect' });
    expect((await failedLogin()).status).toBe(401);
    expect((await failedLogin()).status).toBe(401);
    const limited = await failedLogin();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('LOGIN_RATE_LIMITED');
    expect(signup.status).toBe(201);
  });

  it('rate limits signup before invoking Argon2 or creating the account', async () => {
    const authModel = makeAuthModel();
    const signupRateLimitStore = makeLimitStore();
    const app = makeApp(authModel, {
      signupRateLimit: { windowMs: 60_000, limit: 1 },
      signupRateLimitStore
    });
    const signup = () => request(app).post('/api/auth/signup').set('Origin', origin).send({
      name: 'Test User', email: 'person@example.com', password: 'a-long-secure-passphrase'
    });

    expect((await signup()).status).toBe(201);
    const limited = await signup();

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('SIGNUP_RATE_LIMITED');
    expect(authModel.createUserAndSession).toHaveBeenCalledTimes(1);
    expect(signupRateLimitStore.increment).toHaveBeenCalledTimes(2);
  });

  it('sets baseline response security headers', async () => {
    const response = await request(makeApp(makeAuthModel())).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('camera=()');
  });
});
