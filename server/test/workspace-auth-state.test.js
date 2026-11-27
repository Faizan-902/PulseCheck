import { describe, expect, it } from 'vitest';
import {
  shouldClearLatencyOnMonitorDelete,
  shouldFetchIncidentFeed,
  shouldFetchLatencyHistory
} from '../../client/src/hooks/fetch-guards.js';
import {
  nextCooldownUntil,
  remainingCooldownSeconds
} from '../../client/src/hooks/check-cooldown.js';

describe('authenticated workspace fetch guards', () => {
  it('blocks incident feed requests when signed out even if the incidents tab was active', () => {
    expect(shouldFetchIncidentFeed({ enabled: false, page: 'incidents' })).toBe(false);
    expect(shouldFetchIncidentFeed({ enabled: true, page: 'overview' })).toBe(false);
    expect(shouldFetchIncidentFeed({ enabled: true, page: 'incidents' })).toBe(true);
  });

  it('blocks latency history requests when signed out even before selected endpoint clears', () => {
    expect(
      shouldFetchLatencyHistory({
        enabled: false,
        page: 'overview',
        selectedEndpointId: 'endpoint-1'
      })
    ).toBe(false);
    expect(
      shouldFetchLatencyHistory({
        enabled: true,
        page: 'incidents',
        selectedEndpointId: 'endpoint-1'
      })
    ).toBe(false);
    expect(
      shouldFetchLatencyHistory({
        enabled: true,
        page: 'overview',
        selectedEndpointId: ''
      })
    ).toBe(false);
    expect(
      shouldFetchLatencyHistory({
        enabled: true,
        page: 'overview',
        selectedEndpointId: 'endpoint-1'
      })
    ).toBe(true);
  });

  it('clears latency checks only when the deleted monitor is the selected one', () => {
    expect(
      shouldClearLatencyOnMonitorDelete({
        selectedEndpointId: 'endpoint-a',
        deletedEndpointId: 'endpoint-b'
      })
    ).toBe(false);
    expect(
      shouldClearLatencyOnMonitorDelete({
        selectedEndpointId: 'endpoint-a',
        deletedEndpointId: 'endpoint-a'
      })
    ).toBe(true);
    expect(
      shouldClearLatencyOnMonitorDelete({
        selectedEndpointId: '',
        deletedEndpointId: 'endpoint-a'
      })
    ).toBe(false);
  });
});

describe('manual check 30s cooldown timer', () => {
  it('never resets or extends an active cooldown on repeated responses and resets only after expiry', () => {
    const t0 = 1_000_000;
    const until = nextCooldownUntil({ currentUntil: 0, retryAfterSeconds: 30, now: t0 });
    expect(until).toBe(t0 + 30_000);
    expect(remainingCooldownSeconds(until, t0 + 12_000)).toBe(18);

    // Even if a repeated 429 reports 30s due to clock rounding, an active timer is never pushed forward.
    const afterRepeatedClick = nextCooldownUntil({
      currentUntil: until,
      retryAfterSeconds: 30,
      now: t0 + 12_000
    });
    expect(afterRepeatedClick).toBe(until);
    expect(remainingCooldownSeconds(afterRepeatedClick, t0 + 30_000)).toBe(0);

    // Once expired, a new check starts a fresh 30s cooldown.
    const nextWindow = nextCooldownUntil({
      currentUntil: afterRepeatedClick,
      retryAfterSeconds: 30,
      now: t0 + 31_000
    });
    expect(nextWindow).toBe(t0 + 61_000);
  });
});
