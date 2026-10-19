import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadProductionConfig(sslMode, poolMax = null, password = 'test-only-password') {
  const childEnv = {
    ...process.env,
    PULSECHECK_DISABLE_DOTENV: 'true',
    NODE_ENV: 'production',
    PGHOST: '127.0.0.1',
    PGPORT: '5432',
    PGDATABASE: 'pulsecheck_config_test',
    PGUSER: 'pulsecheck_test',
    PGPASSWORD: password ?? '',
    PGSSLMODE: sslMode,
    HOST: '127.0.0.1',
    PORT: '3001',
    FRONTEND_ORIGIN: 'https://dashboard.example',
    SESSION_COOKIE_SECURE: 'true',
    SESSION_COOKIE_SAME_SITE: 'lax',
    VERCEL: '1'
  };
  delete childEnv.PGPOOL_MAX;
  if (password == null) delete childEnv.PGPASSWORD;
  if (poolMax != null) childEnv.PGPOOL_MAX = String(poolMax);

  return spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import('./src/config/env.js').then(({ env }) => process.stdout.write(JSON.stringify({ sslMode: env.PGSSLMODE, poolMax: env.PGPOOL_MAX })))"
  ], {
    cwd: serverDirectory,
    encoding: 'utf8',
    env: childEnv
  });
}

function loadMissingConfiguration() {
  const childEnv = {
    ...process.env,
    PULSECHECK_DISABLE_DOTENV: 'true',
    NODE_ENV: 'production',
    VERCEL: '1'
  };
  for (const name of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGPOOL_MAX']) {
    delete childEnv[name];
  }

  return spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import('./src/config/env.js').then(() => process.exit(2)).catch((error) => process.stdout.write(JSON.stringify({ name: error.name, code: error.code, variables: error.invalidVariables })))"
  ], {
    cwd: serverDirectory,
    encoding: 'utf8',
    env: childEnv
  });
}

function loadVercelEnvironment(environment) {
  const childEnv = {
    ...process.env,
    PULSECHECK_DISABLE_DOTENV: 'true',
    NODE_ENV: 'production',
    VERCEL: '1',
    VERCEL_ENV: environment,
    VERCEL_URL: 'pulsecheck-preview-123.vercel.app',
    PGHOST: 'database.example',
    PGPORT: '5432',
    PGDATABASE: 'pulsecheck_config_test',
    PGUSER: 'pulsecheck_test',
    PGPASSWORD: 'test-only-password'
  };
  for (const name of ['FRONTEND_ORIGIN', 'SESSION_COOKIE_SECURE', 'PGSSLMODE', 'PGPOOL_MAX']) {
    delete childEnv[name];
  }

  return spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import('./src/config/env.js').then(({ env }) => process.stdout.write(JSON.stringify({ frontendOrigin: env.FRONTEND_ORIGIN, cookieSecure: env.SESSION_COOKIE_SECURE, sslMode: env.PGSSLMODE, poolMax: env.PGPOOL_MAX }))).catch((error) => process.stdout.write(JSON.stringify({ name: error.name, code: error.code, variables: error.invalidVariables })))"
  ], {
    cwd: serverDirectory,
    encoding: 'utf8',
    env: childEnv
  });
}

describe('production environment validation', () => {
  it('isolates a configuration subprocess from the project .env when explicitly requested', () => {
    const missing = loadMissingConfiguration();

    expect(missing.status).toBe(0);
    expect(JSON.parse(missing.stdout)).toEqual({
      name: 'EnvironmentConfigurationError',
      code: 'INVALID_ENVIRONMENT_CONFIGURATION',
      variables: ['PGHOST', 'PGDATABASE', 'PGUSER']
    });
  });

  it('derives an exact secure frontend origin from the Vercel Preview deployment URL', () => {
    const preview = loadVercelEnvironment('preview');

    expect(preview.status).toBe(0);
    expect(JSON.parse(preview.stdout)).toEqual({
      frontendOrigin: 'https://pulsecheck-preview-123.vercel.app',
      cookieSecure: true,
      sslMode: 'require',
      poolMax: 2
    });
  });

  it('requires an explicitly configured stable frontend origin for Vercel Production', () => {
    const production = loadVercelEnvironment('production');

    expect(production.status).toBe(0);
    expect(JSON.parse(production.stdout)).toEqual({
      name: 'EnvironmentConfigurationError',
      code: 'INVALID_ENVIRONMENT_CONFIGURATION',
      variables: ['FRONTEND_ORIGIN']
    });
  });

  it('rejects disabled PostgreSQL TLS and accepts verified TLS mode', () => {
    const insecure = loadProductionConfig('disable');
    expect(insecure.status).not.toBe(0);
    expect(insecure.stderr).toContain('PGSSLMODE=require is required in production.');

    const secure = loadProductionConfig('require');
    expect(secure.status).toBe(0);
    expect(secure.stdout).toBe('{"sslMode":"require","poolMax":2}');
  });

  it('requires a database password in production', () => {
    const missingPassword = loadProductionConfig('require', null, null);

    expect(missingPassword.status).not.toBe(0);
    expect(missingPassword.stderr).toContain('PGPASSWORD is required in production.');
  });

  it('uses a small Vercel pool and rejects values outside the supported range', () => {
    const configured = loadProductionConfig('require', '3');
    expect(configured.status).toBe(0);
    expect(configured.stdout).toBe('{"sslMode":"require","poolMax":3}');

    const oversized = loadProductionConfig('require', '11');
    expect(oversized.status).not.toBe(0);
    expect(oversized.stderr).toContain('PGPOOL_MAX');
  });
});
