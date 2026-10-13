import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { pool } from './pool.js';
import { listMigrationFiles } from './migration-files.js';

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const migrationLockId = 739002;

export async function applyMigrations(client, {
  directory = migrationsDirectory,
  beforeMigration = async () => {},
  logger = console
} = {}) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const names = await listMigrationFiles(directory);
  for (const name of names) {
    const alreadyApplied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      [name]
    );
    if (alreadyApplied.rowCount > 0) {
      logger.log(`Already applied: ${name}`);
      continue;
    }

    await beforeMigration(name, client);
    const sql = await readFile(join(directory, name), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      logger.log(`Applied: ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [migrationLockId]);
    await applyMigrations(client);
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [migrationLockId]);
    } catch (error) {
      console.error('Could not release migration lock:', error.message);
    }
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runMigrations().catch((error) => {
    console.error('Database migration failed:', error.message);
    process.exitCode = 1;
  });
}
