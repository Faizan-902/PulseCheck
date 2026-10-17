import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../src/runtime.js';
import apiHandler from '../../api/index.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

afterAll(async () => {
  await pool.end();
});

describe('Vercel Express adapter', () => {
  it('restores the original API route and returns JSON instead of the SPA document', async () => {
    const response = await request(apiHandler)
      .get('/api/index?__pulsecheck_path=__vercel_adapter_test__&probe=1');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects ambiguous internal path parameters', async () => {
    const response = await request(apiHandler)
      .get('/api/index?__pulsecheck_path=health&__pulsecheck_path=auth%2Fme');

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.error.code).toBe('INVALID_API_PATH');
  });

  it('routes API requests before the SPA fallback', async () => {
    const config = JSON.parse(await readFile(resolve(repositoryRoot, 'vercel.json'), 'utf8'));

    expect(config.rewrites[0]).toEqual({
      source: '/api/:path*',
      destination: '/api/index?__pulsecheck_path=:path*'
    });
    expect(config.rewrites[1]).toEqual({
      source: '/(.*)',
      destination: '/index.html'
    });
  });
});
