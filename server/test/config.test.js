import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadProductionConfig(sslMode) {
  return spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import('./src/config/env.js').then(({ env }) => process.stdout.write(env.PGSSLMODE))"
  ], {
    cwd: serverDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PGHOST: '127.0.0.1',
      PGPORT: '5432',
      PGDATABASE: 'pulsecheck_config_test',
      PGUSER: 'pulsecheck_test',
      PGPASSWORD: '',
      PGSSLMODE: sslMode,
      HOST: '127.0.0.1',
      PORT: '3001',
      FRONTEND_ORIGIN: 'https://dashboard.example',
      SESSION_COOKIE_SECURE: 'true',
      SESSION_COOKIE_SAME_SITE: 'lax'
    }
  });
}

describe('production environment validation', () => {
  it('rejects disabled PostgreSQL TLS and accepts verified TLS mode', () => {
    const insecure = loadProductionConfig('disable');
    expect(insecure.status).not.toBe(0);
    expect(insecure.stderr).toContain('PGSSLMODE=require is required in production.');

    const secure = loadProductionConfig('require');
    expect(secure.status).toBe(0);
    expect(secure.stdout).toBe('require');
  });
});
