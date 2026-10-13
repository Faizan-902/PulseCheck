import { readdir } from 'node:fs/promises';

const migrationNamePattern = /^\d+_[a-z0-9_]+\.sql$/;

export async function listMigrationFiles(directory) {
  return (await readdir(directory))
    .filter((name) => migrationNamePattern.test(name))
    .sort();
}
