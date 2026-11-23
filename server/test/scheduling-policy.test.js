import { describe, expect, it } from 'vitest';
import { schedulingPolicy } from '../src/config/scheduling.js';
import { registerEndpointSchema } from '../src/validation/schemas.js';

const monitor = { name: 'API', url: 'https://example.org/health' };

describe('monitor interval policy', () => {
  it.each([
    ['cron', undefined, 900, 900],
    ['cron', 1800, 1800, 1800],
    ['worker', undefined, 30, 300]
  ])('applies %s bounds and defaults with hosted override %s', (mode, configured, min, defaultInterval) => {
    const policy = schedulingPolicy(mode, configured);
    const schema = registerEndpointSchema(policy);
    expect(policy.defaultIntervalSeconds).toBe(defaultInterval);
    expect(schema.safeParse({ ...monitor, checkIntervalSeconds: min - 1 }).success).toBe(false);
    expect(schema.safeParse({ ...monitor, checkIntervalSeconds: min }).success).toBe(true);
    expect(schema.safeParse({ ...monitor, checkIntervalSeconds: 86400 }).success).toBe(true);
    expect(schema.safeParse({ ...monitor, checkIntervalSeconds: 86401 }).success).toBe(false);
  });
});
