import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LatencyChart } from '../../client/src/components/LatencyChart.jsx';
import { buildLatencyChart, prepareLatencySeries } from '../../client/src/latency-series.js';

const history = [
  { id: 'check-3', checkedAt: '2026-10-14T12:02:00.000Z', status: 'DOWN', latencyMs: null },
  { id: 'check-1', checkedAt: '2026-10-14T12:00:00.000Z', status: 'UP', latencyMs: 86 },
  { id: 'check-2', checkedAt: '2026-10-14T12:01:00.000Z', status: 'DOWN', latencyMs: 140 }
];

describe('persisted latency history visualization', () => {
  it('orders persisted timestamps and keeps unavailable latency distinct from zero', () => {
    const series = prepareLatencySeries([
      ...history,
      { id: 'invalid-time', checkedAt: 'not-a-time', status: 'UP', latencyMs: 2 }
    ]);

    expect(series.map(({ id }) => id)).toEqual(['check-1', 'check-2', 'check-3']);
    expect(series.map(({ latencyMs }) => latencyMs)).toEqual([86, 140, null]);
    expect(series[2].status).toBe('DOWN');
  });

  it('breaks the latency line where a persisted check has no measurement', () => {
    const chart = buildLatencyChart(history);

    expect(chart.points).toHaveLength(3);
    expect(chart.segments.map((segment) => segment.map(({ id }) => id))).toEqual([
      ['check-1', 'check-2']
    ]);
    expect(chart.points[2]).toMatchObject({ id: 'check-3', status: 'DOWN', latencyMs: null, unavailable: true });
  });

  it('keeps axes and persisted points inside a narrow parent-sized chart', () => {
    const chart = buildLatencyChart(history, 260, 220);

    expect(chart.padding.left).toBeLessThan(68);
    expect(chart.width - chart.padding.left - chart.padding.right).toBeGreaterThan(0);
    expect(chart.points.every(({ x }) => x >= chart.padding.left && x <= chart.width - chart.padding.right)).toBe(true);
  });

  it('renders labeled axes, persisted timestamps, and a distinct failed check without latency', () => {
    const markup = renderToStaticMarkup(React.createElement(LatencyChart, {
      checks: prepareLatencySeries(history),
      loading: false,
      error: ''
    }));

    expect(markup).toContain('Latency (ms)');
    expect(markup).toContain('Time');
    expect(markup).toContain('Persisted response latency history with 3 checks');
    expect(markup).toContain('DOWN · latency unavailable');
    expect(markup).toContain('86 ms');
  });
});
