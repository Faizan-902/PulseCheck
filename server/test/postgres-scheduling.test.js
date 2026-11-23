import { randomUUID } from 'node:crypto';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createEndpointModel } from '../src/models/endpoint-model.js';
import { createAuthModel } from '../src/models/auth-model.js';
import { createEndpointRateLimitStores, createPostgresRateLimitStore } from '../src/models/postgres-rate-limit-store.js';
import { listMigrationFiles } from '../src/db/migration-files.js';
import { applyMigrations } from '../src/db/migrate.js';
import { cleanupExpiredData } from '../src/services/data-retention.js';
import { runWorkerOnce } from '../src/services/worker-once.js';
import { runWorkerCycle } from '../src/services/monitor-worker.js';

const { Pool } = pg;
const database = process.env.PULSETEST_PGDATABASE || `${env.PGDATABASE}_test`;
if (!/^[a-zA-Z0-9_]+_test$/.test(database)) {
  throw new Error('PULSETEST_PGDATABASE must name a dedicated database ending in _test.');
}

const schema = `pulsecheck_it_${randomUUID().replaceAll('-', '')}`;
const connectionOptions = {
  host: env.PGHOST,
  port: env.PGPORT,
  database,
  user: env.PGUSER,
  password: env.PGPASSWORD,
  ssl: env.PGSSLMODE === 'require' ? { rejectUnauthorized: true } : false,
  max: 4,
  connectionTimeoutMillis: 5000
};
const adminPool = new Pool(connectionOptions);
const poolOne = new Pool({ ...connectionOptions, options: `-c search_path=${schema},public` });
const poolTwo = new Pool({ ...connectionOptions, options: `-c search_path=${schema},public` });
const modelOne = createEndpointModel(poolOne);
const modelTwo = createEndpointModel(poolTwo);
const authModel = createAuthModel(poolOne);
const authModelTwo = createAuthModel(poolTwo);
const rateLimitStoreOne = createPostgresRateLimitStore(poolOne);
const rateLimitStoreTwo = createPostgresRateLimitStore(poolTwo);
const signupRateLimitStoreOne = createPostgresRateLimitStore(poolOne, 'signup');
const signupRateLimitStoreTwo = createPostgresRateLimitStore(poolTwo, 'signup');
const authApp = createApp({
  model: modelOne,
  authModel,
  frontendOrigin: 'http://localhost:5173',
  cookieSecure: false,
  cookieSameSite: 'lax',
  sessionTtlHours: 1,
  loginRateLimitStore: rateLimitStoreOne
});
const migrationDirectory = new URL('../migrations/', import.meta.url);
let schemaCreated = false;
let endpointId;
let legacyEndpointId;
const ownerId = randomUUID();
const otherOwnerId = randomUUID();

async function createEndpoint(name) {
  const endpoint = await modelOne.createEndpoint({
    ownerId,
    name,
    url: 'https://status.example.org/health',
    timeoutMs: 1000,
    checkIntervalSeconds: 30
  });
  endpointId = endpoint.id;
  return endpoint;
}

async function claimEndpoint(model = modelOne) {
  await poolOne.query(
    `UPDATE monitored_endpoints
     SET next_check_at = clock_timestamp(), check_lease_until = NULL, check_lease_token = NULL
     WHERE id = $1`,
    [endpointId]
  );
  const [endpoint] = await model.claimDueEndpoints(1);
  expect(endpoint?.id).toBe(endpointId);
  return endpoint;
}

async function record(endpoint, status) {
  return modelOne.recordScheduledCheck({
    endpointId,
    leaseToken: endpoint.leaseToken,
    status,
    httpStatus: status === 'UP' ? 200 : null,
    latencyMs: status === 'UP' ? 20 : 1000,
    errorType: status === 'UP' ? null : 'TIMEOUT'
  });
}

beforeAll(async () => {
  const current = await adminPool.query('SELECT current_database() AS name');
  if (current.rows[0].name !== database || !current.rows[0].name.endsWith('_test')) {
    throw new Error('Integration tests must use the dedicated *_test database.');
  }
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;

  const client = await poolOne.connect();
  try {
    const migrationFiles = await listMigrationFiles(fileURLToPath(migrationDirectory));
    expect(migrationFiles).toContain('007_allow_unavailable_latency.sql');
    await applyMigrations(client, {
      directory: fileURLToPath(migrationDirectory),
      logger: { log() {} },
      beforeMigration: async (filename, migrationClient) => {
        if (filename === '005_add_users_sessions_ownership.sql') {
          const legacy = await migrationClient.query(
            `INSERT INTO monitored_endpoints (name, url, timeout_ms, next_check_at)
             VALUES ('Legacy endpoint', 'https://legacy.example.org/health', 1000, NOW() + INTERVAL '1 day')
             RETURNING id`
          );
          legacyEndpointId = legacy.rows[0].id;
        }
      }
    });
    await client.query(
      `INSERT INTO users (id, name, email, password_hash)
       VALUES ($1, 'Owner', 'owner@example.com', 'test-hash'),
              ($2, 'Other', 'other@example.com', 'test-hash')`,
      [ownerId, otherOwnerId]
    );
  } finally {
    client.release();
  }
}, 20000);

afterEach(async () => {
  if (endpointId) {
    await poolOne.query('DELETE FROM monitored_endpoints WHERE id = $1', [endpointId]);
    endpointId = undefined;
  }
});

afterAll(async () => {
  await Promise.all([poolOne.end(), poolTwo.end()]);
  if (schemaCreated) await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
  await adminPool.end();
});

async function authenticateFixture(userId) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  await authModel.createSession({
    userId,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    csrfToken,
    expiresAt: new Date(Date.now() + 60_000)
  });
  return { Cookie: `pulsecheck_session=${token}`, Origin: 'http://localhost:5173', 'X-CSRF-Token': csrfToken };
}

function monitorApi(pool, model, maxEndpointsPerUser) {
  const stores = createEndpointRateLimitStores(pool);
  const app = createApp({
    model, authModel, maxEndpointsPerUser, endpointRateLimitStores: stores,
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    checkEndpoint: async () => ({ status: 'UP', httpStatus: 200, latencyMs: 10, errorType: null })
  });
  return { agent: request(app), stores };
}

describe('PostgreSQL monitor limits', () => {
  afterEach(async () => {
    await poolOne.query('DELETE FROM monitored_endpoints WHERE owner_id = ANY($1::uuid[])', [[ownerId, otherOwnerId]]);
    await poolOne.query('DELETE FROM rate_limits');
  });

  it('serializes concurrent creates across API instances and isolates cap and hourly limits by user', async () => {
    const [owner, other] = await Promise.all([authenticateFixture(ownerId), authenticateFixture(otherOwnerId)]);
    const { agent: first } = monitorApi(poolOne, modelOne, 1);
    const { agent: second } = monitorApi(poolTwo, modelTwo, 1);
    const create = (agent, auth, name) => agent.post('/api/endpoints').set(auth)
      .send({ name, url: 'https://api.example.com' });

    const race = await Promise.all([create(first, owner, 'First'), create(second, owner, 'Concurrent')]);
    expect(race.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(race.find(({ status }) => status === 409).body.error.code).toBe('endpoint_limit_reached');
    const list = await first.get('/api/endpoints').set(owner);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.maxEndpointsPerUser).toBe(1);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await create(second, owner, 'At cap')).status).toBe(409);
    }
    const limited = await create(first, owner, 'Over rate');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await create(second, other, 'Other user')).status).toBe(201);
  });

  it('shares the per-monitor cooldown and per-user check allowance across API instances', async () => {
    const [owner, other] = await Promise.all([authenticateFixture(ownerId), authenticateFixture(otherOwnerId)]);
    const first = monitorApi(poolOne, modelOne, 10);
    const second = monitorApi(poolTwo, modelTwo, 10);
    const create = async (auth) => {
      const response = await first.agent.post('/api/endpoints').set(auth)
        .send({ name: 'Monitor', url: 'https://api.example.com' });
      expect(response.status).toBe(201);
      return response.body.data.id;
    };
    const [id, otherId] = await Promise.all([create(owner), create(other)]);
    const check = (agent, auth, endpoint) => agent.post(`/api/endpoints/${endpoint}/check`).set(auth);

    const race = await Promise.all([
      check(first.agent, owner, id),
      check(second.agent, owner, id.toUpperCase())
    ]);
    expect(race.map(({ status }) => status).sort()).toEqual([201, 429]);
    const cooldown = race.find(({ status }) => status === 429);
    expect(Number(cooldown.headers['retry-after'])).toBeGreaterThan(0);
    expect(cooldown.body.error.message).toContain('30 seconds');
    expect(await modelOne.listChecks(id, 50, ownerId)).toHaveLength(1);

    // Expire the per-monitor window between requests while keeping the hourly window.
    for (let attempt = 0; attempt < 18; attempt += 1) {
      await second.stores.checkEndpoint.resetKey(`${ownerId}:${id}`);
      expect((await check(second.agent, owner, id)).status).toBe(201);
    }
    const hourly = await check(first.agent, owner, id);
    expect(hourly.status).toBe(429);
    expect(Number(hourly.headers['retry-after'])).toBeGreaterThan(30);
    expect(hourly.body.error.message).toContain('20 manual checks');
    expect((await check(second.agent, other, otherId)).status).toBe(201);
  });
});

describe('PostgreSQL scheduled monitoring integration', () => {
  it('discovers migration 007 in runner order and applies its nullable-latency change in the disposable schema', async () => {
    const migrations = await listMigrationFiles(fileURLToPath(migrationDirectory));
    expect(migrations.indexOf('007_allow_unavailable_latency.sql')).toBe(6);
    const nullable = await poolOne.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'check_results' AND column_name = 'latency_ms'`,
      [schema]
    );
    expect(nullable.rows[0]?.is_nullable).toBe('YES');
    const tracked = await poolOne.query(
      'SELECT name FROM schema_migrations WHERE name = $1',
      ['007_allow_unavailable_latency.sql']
    );
    expect(tracked.rowCount).toBe(1);
  });

  it('cleans expired sessions and rate-limit rows in bounded concurrent batches', async () => {
    const [cleanupClientOne, cleanupClientTwo] = await Promise.all([
      poolOne.connect(),
      poolTwo.connect()
    ]);
    try {
      const [backendOne, backendTwo] = await Promise.all([
        cleanupClientOne.query('SELECT pg_backend_pid() AS pid'),
        cleanupClientTwo.query('SELECT pg_backend_pid() AS pid')
      ]);
      expect(backendOne.rows[0].pid).not.toBe(backendTwo.rows[0].pid);
    } finally {
      cleanupClientOne.release();
      cleanupClientTwo.release();
    }

    const expiredTokens = Array.from({ length: 3 }, () => createHash('sha256').update(randomBytes(32)).digest('hex'));
    for (const tokenHash of expiredTokens) {
      await authModel.createSession({
        userId: ownerId,
        tokenHash,
        csrfToken: randomBytes(32).toString('base64url'),
        expiresAt: new Date(Date.now() + 60_000)
      });
      await poolOne.query(
        `UPDATE user_sessions
         SET created_at = clock_timestamp() - INTERVAL '2 minutes',
             expires_at = clock_timestamp() - INTERVAL '1 minute'
         WHERE token_hash = $1`,
        [tokenHash]
      );
    }
    const liveToken = createHash('sha256').update(randomBytes(32)).digest('hex');
    await authModel.createSession({
      userId: ownerId,
      tokenHash: liveToken,
      csrfToken: randomBytes(32).toString('base64url'),
      expiresAt: new Date(Date.now() + 60_000)
    });

    const expiredRateKeys = Array.from({ length: 3 }, () => createHash('sha256').update(randomBytes(32)).digest('hex'));
    const liveRateKey = createHash('sha256').update(randomBytes(32)).digest('hex');
    for (const keyHash of [...expiredRateKeys, liveRateKey]) {
      await poolOne.query(
        `INSERT INTO login_rate_limits (key_hash, hits, reset_at)
         VALUES ($1, 1, $2)`,
        [keyHash, expiredRateKeys.includes(keyHash) ? new Date(Date.now() - 60_000) : new Date(Date.now() + 60_000)]
      );
    }

    const [sessionBatchOne, sessionBatchTwo] = await Promise.all([
      authModel.deleteExpiredSessionsBatch(2),
      authModelTwo.deleteExpiredSessionsBatch(2)
    ]);
    expect(sessionBatchOne).toBeLessThanOrEqual(2);
    expect(sessionBatchTwo).toBeLessThanOrEqual(2);
    expect(sessionBatchOne + sessionBatchTwo).toBe(3);
    expect((await poolOne.query('SELECT token_hash FROM user_sessions WHERE token_hash = $1', [liveToken])).rowCount).toBe(1);

    const [rateBatchOne, rateBatchTwo] = await Promise.all([
      rateLimitStoreOne.deleteExpiredBatch(2),
      rateLimitStoreTwo.deleteExpiredBatch(2)
    ]);
    expect(rateBatchOne).toBeLessThanOrEqual(2);
    expect(rateBatchTwo).toBeLessThanOrEqual(2);
    expect(rateBatchOne + rateBatchTwo).toBe(3);
    expect((await poolOne.query('SELECT key_hash FROM login_rate_limits WHERE key_hash = $1', [liveRateKey])).rowCount).toBe(1);

    const bounded = await cleanupExpiredData({
      authModel,
      rateLimitStore: rateLimitStoreOne,
      batchSize: 2,
      maxBatches: 1
    });
    expect(bounded).toMatchObject({
      sessions: { deleted: 0, hasMore: false },
      rateLimits: { deleted: 0, hasMore: false },
      hasMore: false
    });
    await poolOne.query('DELETE FROM user_sessions WHERE token_hash = $1', [liveToken]);
    await poolOne.query('DELETE FROM login_rate_limits WHERE key_hash = $1', [liveRateKey]);
  });

  it('supports signup and login after the ownership and shared-rate-limit migrations', async () => {
    const email = `auth-flow-${randomUUID()}@example.com`;
    try {
      const signup = await request(authApp).post('/api/auth/signup')
        .set('Origin', 'http://localhost:5173')
        .send({ name: 'Integration User', email, password: 'a-long-integration-passphrase' });
      expect(signup.status).toBe(201);
      expect(signup.body.data.user.email).toBe(email);

      const login = await request(authApp).post('/api/auth/login')
        .set('Origin', 'http://localhost:5173')
        .send({ email, password: 'a-long-integration-passphrase' });
      expect(login.status).toBe(200);
      expect(login.body.data.user.email).toBe(email);
      expect(login.headers['set-cookie'][0]).toContain('pulsecheck_session=');
    } finally {
      await poolOne.query('DELETE FROM users WHERE email = $1', [email]);
    }
  });

  it('shares login rate-limit counters across separate PostgreSQL connections', async () => {
    const key = `test-${randomUUID()}`;
    rateLimitStoreOne.init({ windowMs: 60_000 });
    rateLimitStoreTwo.init({ windowMs: 60_000 });

    const hits = await Promise.all([
      rateLimitStoreOne.increment(key),
      rateLimitStoreTwo.increment(key)
    ]);
    expect(hits.map(({ totalHits }) => totalHits).sort()).toEqual([1, 2]);
    expect(await rateLimitStoreOne.increment(key)).toMatchObject({ totalHits: 3 });
    await rateLimitStoreTwo.resetKey(key);
  });

  it('shares signup limits across connections without colliding with login limits', async () => {
    const key = `test-${randomUUID()}`;
    rateLimitStoreOne.init({ windowMs: 60_000 });
    rateLimitStoreTwo.init({ windowMs: 60_000 });
    signupRateLimitStoreOne.init({ windowMs: 60_000 });
    signupRateLimitStoreTwo.init({ windowMs: 60_000 });

    expect(await signupRateLimitStoreOne.increment(key)).toMatchObject({ totalHits: 1 });
    expect(await signupRateLimitStoreTwo.increment(key)).toMatchObject({ totalHits: 2 });
    expect(await rateLimitStoreOne.increment(key)).toMatchObject({ totalHits: 1 });
    await signupRateLimitStoreTwo.resetKey(key);
    await rateLimitStoreOne.resetKey(key);
  });

  it('persists an unavailable latency as SQL NULL after migration 007', async () => {
    const endpoint = await createEndpoint('Unavailable latency');
    const claimed = await claimEndpoint();
    const saved = await modelOne.recordScheduledCheck({
      endpointId: endpoint.id,
      leaseToken: claimed.leaseToken,
      status: 'DOWN',
      httpStatus: null,
      latencyMs: null,
      errorType: 'NETWORK_ERROR'
    });

    const result = await poolOne.query(
      `SELECT status, latency_ms FROM check_results WHERE endpoint_id = $1`, [endpoint.id]
    );
    expect(saved.status).toBe('DOWN');
    expect(result.rows).toEqual([{ status: 'DOWN', latency_ms: null }]);
  });

  it('keeps pre-existing endpoints unassigned, hidden from user queries, and claimable by the worker', async () => {
    const legacy = await poolOne.query(
      'SELECT owner_id FROM monitored_endpoints WHERE id = $1', [legacyEndpointId]
    );
    expect(legacy.rows[0].owner_id).toBeNull();
    expect(await modelOne.findEndpointById(legacyEndpointId, ownerId)).toBeNull();
    expect(await modelOne.findEndpointById(legacyEndpointId, otherOwnerId)).toBeNull();

    await poolOne.query(
      'UPDATE monitored_endpoints SET next_check_at = clock_timestamp() WHERE id = $1',
      [legacyEndpointId]
    );
    const [claim] = await modelOne.claimDueEndpoints(1);
    expect(claim.id).toBe(legacyEndpointId);
    expect(await modelOne.recordScheduledCheck({
      endpointId: legacyEndpointId,
      leaseToken: claim.leaseToken,
      status: 'UP',
      httpStatus: 200,
      latencyMs: 5,
      errorType: null
    })).toMatchObject({ status: 'UP', checkSource: 'SCHEDULED' });
  });

  it('deletes only the owner monitor, cascades history and incidents, and rejects a stale worker result', async () => {
    const endpoint = await createEndpoint('Delete with active lease');
    await record(await claimEndpoint(), 'DOWN');
    await record(await claimEndpoint(), 'DOWN');
    expect(await modelOne.listIncidents(endpoint.id, ownerId)).toHaveLength(1);

    const inFlightClaim = await claimEndpoint();
    expect(await modelOne.deleteEndpoint(endpoint.id, otherOwnerId)).toBe(false);
    expect(await modelOne.findEndpointById(endpoint.id, ownerId)).not.toBeNull();

    expect(await modelOne.deleteEndpoint(endpoint.id, ownerId)).toBe(true);
    const staleResult = await modelOne.recordScheduledCheck({
      endpointId: endpoint.id,
      leaseToken: inFlightClaim.leaseToken,
      status: 'UP',
      httpStatus: 200,
      latencyMs: 12,
      errorType: null
    });
    expect(staleResult).toBeNull();

    const checks = await poolOne.query('SELECT count(*)::int AS count FROM check_results WHERE endpoint_id = $1', [endpoint.id]);
    const incidents = await poolOne.query('SELECT count(*)::int AS count FROM incidents WHERE endpoint_id = $1', [endpoint.id]);
    expect(checks.rows[0].count).toBe(0);
    expect(incidents.rows[0].count).toBe(0);
    expect(await modelOne.findEndpointById(endpoint.id, ownerId)).toBeNull();
  });

  it('checks only due active rows, honours the hosted floor and skips an overlapping one-shot', async () => {
    const due = await createEndpoint('Due at launch');
    const fixture = await poolOne.query(
      `INSERT INTO monitored_endpoints (name, url, next_check_at, is_active)
       VALUES ('Later', 'https://example.org', NOW() + INTERVAL '1 hour', TRUE),
              ('Inactive', 'https://example.org', NOW(), FALSE)
       RETURNING id`
    );
    const ids = fixture.rows.map(({ id }) => id);
    const entered = Promise.withResolvers();
    const resume = Promise.withResolvers();
    const args = {
      authModel, rateLimitStore: rateLimitStoreOne, batchSize: 1, minIntervalSeconds: 900,
      logger: { log() {}, error() {} },
      async checkEndpoint(endpoint) {
        entered.resolve(endpoint.id);
        await resume.promise;
        return { status: 'UP', httpStatus: 200, latencyMs: 12, errorType: null };
      }
    };

    const first = runWorkerOnce({ ...args, model: modelOne });
    try {
      expect(await Promise.race([entered.promise, first])).toBe(due.id);
      expect(await runWorkerOnce({ ...args, model: modelTwo })).toMatchObject({ skipped: true, checks: 0 });
    } finally {
      resume.resolve();
      await first;
      await poolOne.query('DELETE FROM monitored_endpoints WHERE id = ANY($1::uuid[])', [ids]);
    }

    expect((await first).checks).toBe(1);
    const after = await modelOne.findEndpointById(due.id, ownerId);
    expect(after.nextCheckAt.getTime() - Date.now()).toBeGreaterThan(890_000);
    expect(await runWorkerOnce({ ...args, model: modelTwo })).toMatchObject({ checks: 0 });
    expect(await modelOne.listChecks(due.id, 50, ownerId)).toHaveLength(1);
  });

  it('claims a due endpoint once across separate PostgreSQL connections', async () => {
    const endpoint = await createEndpoint('Concurrent claim');
    const [clientOne, clientTwo] = await Promise.all([poolOne.connect(), poolTwo.connect()]);
    try {
      const [pidOne, pidTwo] = await Promise.all([
        clientOne.query('SELECT pg_backend_pid() AS pid'),
        clientTwo.query('SELECT pg_backend_pid() AS pid')
      ]);
      expect(pidOne.rows[0].pid).not.toBe(pidTwo.rows[0].pid);
    } finally {
      clientOne.release();
      clientTwo.release();
    }

    const claimResults = await Promise.all([
      modelOne.claimDueEndpoints(1),
      modelTwo.claimDueEndpoints(1)
    ]);
    expect(claimResults.flat().filter((row) => row.id === endpoint.id)).toHaveLength(1);
  });

  it('persists the scheduled result, advances next_check_at, and clears its lease atomically', async () => {
    const endpoint = await createEndpoint('Schedule advancement');
    const before = await poolOne.query(
      'SELECT next_check_at FROM monitored_endpoints WHERE id = $1', [endpoint.id]
    );
    const claim = await claimEndpoint();
    const saved = await record(claim, 'UP');
    const after = await poolOne.query(
      `SELECT next_check_at, check_lease_until, check_lease_token
       FROM monitored_endpoints WHERE id = $1`, [endpoint.id]
    );
    const history = await modelOne.listChecks(endpoint.id, 10, ownerId);

    expect(saved).toMatchObject({ status: 'UP', checkSource: 'SCHEDULED' });
    expect(history).toHaveLength(1);
    expect(new Date(after.rows[0].next_check_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].next_check_at).getTime()
    );
    expect(after.rows[0].check_lease_until).toBeNull();
    expect(after.rows[0].check_lease_token).toBeNull();
  });

  it('opens after two scheduled failures and resolves after two scheduled successes; manual checks do not affect incidents', async () => {
    const endpoint = await createEndpoint('Incident transitions');
    await record(await claimEndpoint(), 'DOWN');
    expect(await modelOne.listIncidents(endpoint.id, ownerId)).toHaveLength(0);

    await modelOne.createCheck({ endpointId, ownerId, status: 'DOWN', httpStatus: null, latencyMs: 50, errorType: 'TIMEOUT' });
    expect(await modelOne.listIncidents(endpoint.id, ownerId)).toHaveLength(0);

    await record(await claimEndpoint(), 'DOWN');
    let incidents = await modelOne.listIncidents(endpoint.id, ownerId);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].resolvedAt).toBeNull();

    await record(await claimEndpoint(), 'UP');
    await modelOne.createCheck({ endpointId, ownerId, status: 'UP', httpStatus: 200, latencyMs: 20, errorType: null });
    incidents = await modelOne.listIncidents(endpoint.id, ownerId);
    expect(incidents[0].resolvedAt).toBeNull();

    await record(await claimEndpoint(), 'UP');
    incidents = await modelOne.listIncidents(endpoint.id, ownerId);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].resolvedAt).not.toBeNull();
  });

  it('rolls back a result and leaves scheduling state retryable when schedule advancement fails', async () => {
    const endpoint = await createEndpoint('Rollback target');
    const before = await poolOne.query(
      'SELECT next_check_at FROM monitored_endpoints WHERE id = $1', [endpoint.id]
    );
    await poolOne.query(`
      CREATE FUNCTION fail_schedule_advance() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.name = 'Rollback target' AND NEW.next_check_at IS DISTINCT FROM OLD.next_check_at THEN
          RAISE EXCEPTION 'forced scheduling update failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await poolOne.query(`
      CREATE TRIGGER fail_test_schedule_update
      BEFORE UPDATE ON monitored_endpoints
      FOR EACH ROW EXECUTE FUNCTION fail_schedule_advance()
    `);
    await expect(runWorkerCycle({
      model: modelOne,
      checkEndpoint: async () => ({
        status: 'DOWN', httpStatus: null, latencyMs: 1000, errorType: 'TIMEOUT'
      }),
      batchSize: 1,
      logger: { error() {} }
    })).rejects.toThrow('One or more scheduled checks failed to persist.');

    const checkCount = await poolOne.query('SELECT count(*)::int AS count FROM check_results WHERE endpoint_id = $1', [endpoint.id]);
    const state = await poolOne.query(
      `SELECT next_check_at, check_lease_until, check_lease_token
       FROM monitored_endpoints WHERE id = $1`, [endpoint.id]
    );
    expect(checkCount.rows[0].count).toBe(0);
    expect(new Date(state.rows[0].next_check_at).getTime()).toBe(
      new Date(before.rows[0].next_check_at).getTime()
    );
    expect(state.rows[0].check_lease_token).not.toBeNull();
    expect(state.rows[0].check_lease_until).not.toBeNull();
    expect(await modelOne.listIncidents(endpoint.id, ownerId)).toHaveLength(0);
  });

  it('recovers an expired lease with a fencing token and rejects the stale worker result', async () => {
    const endpoint = await createEndpoint('Stale lease recovery');
    const staleToken = randomUUID();
    await poolOne.query(
      `UPDATE monitored_endpoints
       SET next_check_at = clock_timestamp() - INTERVAL '1 second',
           check_lease_until = clock_timestamp() - INTERVAL '1 second',
           check_lease_token = $2 WHERE id = $1`,
      [endpoint.id, staleToken]
    );

    const [recoveredClaim] = await modelOne.claimDueEndpoints(1);
    expect(recoveredClaim.id).toBe(endpoint.id);
    expect(recoveredClaim.leaseToken).not.toBe(staleToken);
    const staleResult = await modelOne.recordScheduledCheck({
      endpointId,
      leaseToken: staleToken,
      status: 'DOWN',
      httpStatus: null,
      latencyMs: 1000,
      errorType: 'TIMEOUT'
    });
    expect(staleResult).toBeNull();
    expect(await modelOne.listChecks(endpoint.id, 10, ownerId)).toHaveLength(0);

    const saved = await record(recoveredClaim, 'UP');
    expect(saved.status).toBe('UP');
    const state = await poolOne.query(
      `SELECT next_check_at, check_lease_until, check_lease_token
       FROM monitored_endpoints WHERE id = $1`, [endpoint.id]
    );
    expect(new Date(state.rows[0].next_check_at).getTime()).toBeGreaterThan(Date.now());
    expect(state.rows[0].check_lease_until).toBeNull();
    expect(state.rows[0].check_lease_token).toBeNull();
  });

  it('persists sessions and restricts endpoint, history, and incident queries to the owner', async () => {
    const endpoint = await createEndpoint('Ownership boundary');
    const rawSession = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawSession).digest('hex');
    const csrfToken = randomBytes(32).toString('base64url');
    await authModel.createSession({
      userId: ownerId,
      tokenHash,
      csrfToken,
      expiresAt: new Date(Date.now() + 60_000)
    });

    const session = await authModel.findSessionByTokenHash(tokenHash);
    expect(session).toMatchObject({ userId: ownerId, email: 'owner@example.com', csrfToken });
    expect(await modelOne.listEndpoints(ownerId)).toEqual(expect.arrayContaining([expect.objectContaining({ id: endpoint.id })]));
    expect(await modelOne.listEndpoints(otherOwnerId)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: endpoint.id })]));
    expect(await modelOne.findEndpointById(endpoint.id, otherOwnerId)).toBeNull();
    expect(await modelOne.listChecks(endpoint.id, 10, otherOwnerId)).toHaveLength(0);
    expect(await modelOne.listIncidents(endpoint.id, otherOwnerId)).toHaveLength(0);
    const unauthorizedCheck = await modelOne.createCheck({
      endpointId: endpoint.id,
      ownerId: otherOwnerId,
      status: 'UP',
      httpStatus: 200,
      latencyMs: 2,
      errorType: null
    });
    expect(unauthorizedCheck).toBeNull();
    expect(await modelOne.listChecks(endpoint.id, 10, ownerId)).toHaveLength(0);

    await authModel.deleteSession(tokenHash);
    expect(await authModel.findSessionByTokenHash(tokenHash)).toBeNull();

    const expiredTokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    await authModel.createSession({
      userId: ownerId,
      tokenHash: expiredTokenHash,
      csrfToken: randomBytes(32).toString('base64url'),
      expiresAt: new Date(Date.now() + 60_000)
    });
    await poolOne.query(
      `UPDATE user_sessions
       SET created_at = NOW() - INTERVAL '2 minutes',
           expires_at = NOW() - INTERVAL '1 minute'
       WHERE token_hash = $1`,
      [expiredTokenHash]
    );
    expect(await authModel.findSessionByTokenHash(expiredTokenHash)).toBeNull();

    const email = `signup-${randomUUID()}@example.com`;
    const signupTokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const signupCsrf = randomBytes(32).toString('base64url');
    const createdUser = await authModel.createUserAndSession({
      name: 'New User',
      email,
      passwordHash: 'argon2id-test-hash',
      tokenHash: signupTokenHash,
      csrfToken: signupCsrf,
      expiresAt: new Date(Date.now() + 60_000)
    });
    expect(createdUser).toMatchObject({ name: 'New User', email });
    expect(await authModel.findSessionByTokenHash(signupTokenHash)).toMatchObject({
      userId: createdUser.id,
      email,
      csrfToken: signupCsrf
    });
    await poolOne.query('DELETE FROM users WHERE id = $1', [createdUser.id]);
    expect(await authModel.findSessionByTokenHash(signupTokenHash)).toBeNull();
  });
});
