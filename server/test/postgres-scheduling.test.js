import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { env } from '../src/config/env.js';
import { createEndpointModel } from '../src/models/endpoint-model.js';
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
const migrationDirectory = new URL('../migrations/', import.meta.url);
let schemaCreated = false;
let endpointId;

async function createEndpoint(name) {
  const endpoint = await modelOne.createEndpoint({
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
    for (const filename of [
      '001_create_monitored_endpoints.sql',
      '002_create_check_results.sql',
      '003_add_scheduling_and_incidents.sql',
      '004_fence_scheduled_checks.sql'
    ]) {
      const sql = await readFile(new URL(filename, migrationDirectory), 'utf8');
      await client.query(sql);
    }
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

describe('PostgreSQL scheduled monitoring integration', () => {
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
    const history = await modelOne.listChecks(endpoint.id, 10);

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
    expect(await modelOne.listIncidents(endpoint.id)).toHaveLength(0);

    await modelOne.createCheck({ endpointId, status: 'DOWN', httpStatus: null, latencyMs: 50, errorType: 'TIMEOUT' });
    expect(await modelOne.listIncidents(endpoint.id)).toHaveLength(0);

    await record(await claimEndpoint(), 'DOWN');
    let incidents = await modelOne.listIncidents(endpoint.id);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].resolvedAt).toBeNull();

    await record(await claimEndpoint(), 'UP');
    await modelOne.createCheck({ endpointId, status: 'UP', httpStatus: 200, latencyMs: 20, errorType: null });
    incidents = await modelOne.listIncidents(endpoint.id);
    expect(incidents[0].resolvedAt).toBeNull();

    await record(await claimEndpoint(), 'UP');
    incidents = await modelOne.listIncidents(endpoint.id);
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
    expect(await modelOne.listIncidents(endpoint.id)).toHaveLength(0);
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
    expect(await modelOne.listChecks(endpoint.id, 10)).toHaveLength(0);

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
});
