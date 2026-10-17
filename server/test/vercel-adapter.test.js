import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../src/runtime.js';
import apiApp from '../../api/[...path].js';

afterAll(async () => {
  await pool.end();
});

describe('Vercel Express adapter', () => {
  it('exports the shared Express application and returns JSON for unknown API paths', async () => {
    const response = await request(apiApp).get('/api/__vercel_adapter_test__');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
