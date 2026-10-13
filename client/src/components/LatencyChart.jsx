import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildLatencyChart } from '../latency-series.js';

function fullTimestamp(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(value));
}

function axisTimestamp(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

export function LatencyChart({ checks, loading, error, onRetry }) {
  const [activePoint, setActivePoint] = useState(null);
  const chartContainerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 1, height: 280 });
  const chart = useMemo(() => buildLatencyChart(checks, dimensions.width, dimensions.height), [checks, dimensions]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return undefined;
    const updateDimensions = () => {
      const width = Math.max(1, Math.round(container.clientWidth));
      const height = Math.max(1, Math.round(container.clientHeight));
      setDimensions((current) => current.width === width && current.height === height ? current : { width, height });
    };
    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  if (loading && !checks.length) {
    return <div className="latency-skeleton" role="status" aria-label="Loading persisted check history">
      <span className="skeleton-axis" /><span className="skeleton-line skeleton-line-one" /><span className="skeleton-line skeleton-line-two" /><span className="skeleton-line skeleton-line-three" /><span className="skeleton-axis-bottom" />
    </div>;
  }
  if (error && !checks.length) {
    return <div className="latency-state latency-error" role="alert"><span>{error}</span><button className="text-button" type="button" onClick={onRetry}>Try again</button></div>;
  }
  if (!chart.points.length) {
    return <div className="latency-state latency-empty"><span className="chart-empty-mark" aria-hidden="true">↗</span><strong>No check history yet</strong><span>Latency appears here after a manual or scheduled check is saved.</span></div>;
  }

  const first = chart.points[0];
  const last = chart.points.at(-1);
  const active = activePoint === null ? null : chart.points[activePoint];
  const tooltip = active ? {
    left: `${Math.max(80, Math.min(chart.width - 80, active.x))}px`,
    top: `${Math.max(84, active.y - 12)}px`
  } : undefined;

  return <div className="latency-chart-wrap">
    {error && <p className="latency-refresh-warning" role="status">Refresh failed: {error} Showing the last saved response.</p>}
    <div className="latency-chart" ref={chartContainerRef} onMouseLeave={() => setActivePoint(null)}>
      <svg className="latency-svg" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`Persisted response latency history with ${chart.points.length} checks`}>
        {chart.ticks.map((tick) => {
          const y = chart.padding.top + chart.plotHeight * (1 - tick / chart.axisMaximum);
          return <g key={tick} className="latency-grid-row">
            <line x1={chart.padding.left} x2={chart.width - chart.padding.right} y1={y} y2={y} />
            <text x={chart.padding.left - 12} y={y + 4} textAnchor="end">{tick} ms</text>
          </g>;
        })}
        <line className="latency-axis-line" x1={chart.padding.left} x2={chart.padding.left} y1={chart.padding.top} y2={chart.height - chart.padding.bottom} />
        <line className="latency-axis-line" x1={chart.padding.left} x2={chart.width - chart.padding.right} y1={chart.height - chart.padding.bottom} y2={chart.height - chart.padding.bottom} />
        <text className="latency-axis-title" transform={`translate(17 ${chart.height / 2}) rotate(-90)`} textAnchor="middle">Latency (ms)</text>
        <text className="latency-axis-title" x={chart.width - chart.padding.right} y={chart.height - 8} textAnchor="end">Time</text>
        {chart.segments.map((segment, index) => segment.length > 1 && <path
          key={`segment-${index}`}
          className="latency-line"
          d={segment.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')}
        />)}
        {chart.points.map((point, index) => {
          const isDown = point.status === 'DOWN';
          const label = `${point.status} · ${point.latencyMs === null ? 'latency unavailable' : `${point.latencyMs} ms`} · ${fullTimestamp(point.checkedAt)}`;
          return <g
            key={point.id || `${point.timestamp}-${index}`}
            className={`latency-point ${isDown ? 'point-down' : point.unavailable ? 'point-unknown' : ''}`}
            tabIndex="0"
            role="img"
            aria-label={label}
            onPointerEnter={() => setActivePoint(index)}
            onFocus={() => setActivePoint(index)}
            onBlur={() => setActivePoint(null)}
          >
            {point.unavailable
              ? <path d={`M ${point.x} ${point.y - 5} L ${point.x + 5} ${point.y} L ${point.x} ${point.y + 5} L ${point.x - 5} ${point.y} Z`} />
              : <circle cx={point.x} cy={point.y} r="4.5" />}
            <title>{label}</title>
          </g>;
        })}
        <text className="latency-time-label" x={first.x} y={chart.height - chart.padding.bottom + 20} textAnchor="start">{axisTimestamp(first.checkedAt)}</text>
        <text className="latency-time-label" x={last.x} y={chart.height - chart.padding.bottom + 20} textAnchor="end">{axisTimestamp(last.checkedAt)}</text>
      </svg>
      {active && <div className="latency-tooltip" role="tooltip" style={tooltip}>
        <span className={`tooltip-status ${active.status === 'DOWN' ? 'tooltip-down' : 'tooltip-up'}`}><i />{active.status}</span>
        <strong>{active.latencyMs === null ? 'Latency unavailable' : `${active.latencyMs} ms`}</strong>
        <time dateTime={active.checkedAt}>{fullTimestamp(active.checkedAt)}</time>
      </div>}
    </div>
    <div className="latency-legend"><span><i className="legend-up" />Reachable</span><span><i className="legend-down" />Failed check</span><span className="latency-range">{chart.points.length} persisted results · {axisTimestamp(first.checkedAt)} – {axisTimestamp(last.checkedAt)}</span></div>
  </div>;
}

export function LatencyPanel({ endpoints, selectedEndpointId, onSelectEndpoint, checks, loading, refreshing, error, onRefresh }) {
  return <section className="surface latency-surface" aria-labelledby="latency-heading">
    <div className="surface-heading latency-heading">
      <div><h2 id="latency-heading">Response latency</h2><p>Measured from persisted endpoint checks.</p></div>
      <div className="latency-controls">
        <label className="monitor-select-label" htmlFor="latency-monitor">Monitor</label>
        <select id="latency-monitor" className="monitor-select" value={selectedEndpointId || ''} onChange={(event) => onSelectEndpoint(event.target.value)} disabled={!endpoints.length}>
          {endpoints.length ? endpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>) : <option value="">No monitors</option>}
        </select>
        <button className="secondary-button compact-refresh" type="button" onClick={onRefresh} disabled={!selectedEndpointId || loading || refreshing}>
          <span className={refreshing ? 'refresh-icon spinning' : 'refresh-icon'} aria-hidden="true">↻</span>{refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
    </div>
    {endpoints.length
      ? <LatencyChart checks={checks} loading={loading} error={error} onRetry={onRefresh} />
      : <div className="latency-state latency-empty"><strong>No monitors to chart</strong><span>Register a monitor and run a check to create history.</span></div>}
    <div className="latency-refresh-note" aria-live="polite">{selectedEndpointId ? 'History refreshes every 30 seconds while this dashboard is open.' : 'Select a monitor to view history.'}</div>
  </section>;
}
