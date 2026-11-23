import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildLatencyChart, getRecentLatencyChecks } from '../latency-series.js';

function fullTimestamp(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(value));
}

function axisTimestamp(value, span = Infinity) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(span < 10 * 60_000 ? { second: '2-digit' } : {}),
    ...(span < 10_000 ? { fractionalSecondDigits: 3 } : {})
  }).format(new Date(value));
}

export function LatencyChart({ checks, loading, error, onRetry, emptyInRange = false }) {
  const [activePoint, setActivePoint] = useState(null);
  const chartContainerRef = useRef(null);
  const [dimensions, setDimensions] = useState(null);
  const chart = useMemo(
    () => buildLatencyChart(checks, dimensions?.width, dimensions?.height),
    [checks, dimensions]
  );
  const hasPoints = chart.points.length > 0;

  useLayoutEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return undefined;
    const updateDimensions = () => {
      const { clientWidth: width, clientHeight: height } = container;
      if (!width || !height) return;
      setDimensions((current) =>
        current?.width === width && current.height === height ? current : { width, height }
      );
    };
    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(container);
    return () => observer.disconnect();
  }, [hasPoints]);

  if (loading && !checks.length) {
    return <div className="latency-skeleton" role="status" aria-label="Loading persisted check history">
      <span className="skeleton-axis" /><span className="skeleton-line skeleton-line-one" /><span className="skeleton-line skeleton-line-two" /><span className="skeleton-line skeleton-line-three" /><span className="skeleton-axis-bottom" />
    </div>;
  }
  if (error && !checks.length) {
    return <div className="latency-state latency-error" role="alert"><span>{error}</span><button className="text-button" type="button" onClick={onRetry}>Try again</button></div>;
  }
  if (!hasPoints) {
    return (
      <div className="latency-state latency-empty">
        <span className="chart-empty-mark" aria-hidden="true">↗</span>
        <strong>{emptyInRange ? 'No checks in the last 24 hours' : 'No check history yet'}</strong>
        <span>{emptyInRange
          ? 'Select Full history to see older checks.'
          : 'Latency appears here after a manual or scheduled check is saved.'}</span>
      </div>
    );
  }

  const first = chart.points[0];
  const last = chart.points.at(-1);
  const timeSpan = last.timestamp - first.timestamp;
  const plotBottom = chart.height - chart.padding.bottom;
  const plotRight = chart.width - chart.padding.right;
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
            <line x1={chart.padding.left} x2={plotRight} y1={y} y2={y} />
            <text x={chart.padding.left - 12} y={y + 4} textAnchor="end">{tick.toLocaleString()}</text>
          </g>;
        })}
        <line className="latency-axis-line" x1={chart.padding.left} x2={chart.padding.left} y1={chart.padding.top} y2={plotBottom} />
        <line className="latency-axis-line" x1={chart.padding.left} x2={plotRight} y1={plotBottom} y2={plotBottom} />
        <text className="latency-axis-title" x={chart.padding.left} y={12}>Latency (ms)</text>
        <text className="latency-axis-title" x={(chart.padding.left + plotRight) / 2} y={chart.height - 8} textAnchor="middle">Time</text>
        {chart.segments.map((segment, index) => segment.length > 1 && <path
          key={`segment-${index}`}
          className="latency-line"
          d={segment.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')}
        />)}
        {chart.points.map((point, index) => {
          const statusClass = point.status.toLowerCase();
          const label = `${point.status} · ${point.latencyMs === null ? 'latency unavailable' : `${point.latencyMs} ms`} · ${fullTimestamp(point.checkedAt)}`;
          return <g
            key={point.id || `${point.timestamp}-${index}`}
            className={`latency-point point-${statusClass}`}
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
        {chart.timeTicks.map(({ timestamp, x }, index) => {
          const atEdge = chart.timeTicks.length > 1;
          const anchor = atEdge && index === 0
            ? 'start'
            : atEdge && index === chart.timeTicks.length - 1 ? 'end' : 'middle';
          return (
            <text key={timestamp} className="latency-time-label" x={x} y={plotBottom + 20} textAnchor={anchor}>
              {axisTimestamp(timestamp, timeSpan)}
            </text>
          );
        })}
      </svg>
      {active && <div className="latency-tooltip" role="tooltip" style={tooltip}>
        <span className={`tooltip-status tooltip-${active.status.toLowerCase()}`}><i />{active.status}</span>
        <strong>{active.latencyMs === null ? 'Latency unavailable' : `${active.latencyMs} ms`}</strong>
        <time dateTime={active.checkedAt}>{fullTimestamp(active.checkedAt)}</time>
      </div>}
    </div>
    <div className="latency-legend"><span><i className="legend-up" />Reachable</span><span><i className="legend-down" />Failed check</span><span className="latency-range">{chart.points.length} persisted results · {axisTimestamp(first.checkedAt, timeSpan)}{timeSpan > 0 && ` – ${axisTimestamp(last.checkedAt, timeSpan)}`}</span></div>
  </div>;
}

export function LatencyPanel({ endpoints, selectedEndpointId, onSelectEndpoint, checks, loading, refreshing, error, onRefresh }) {
  const [range, setRange] = useState(null);
  const recent = getRecentLatencyChecks(checks);
  const selectedRange = range ?? (recent.length || !checks.length ? 'recent' : 'all');
  const visibleChecks = selectedRange === 'recent' ? recent : checks;

  return <section className="surface latency-surface" aria-labelledby="latency-heading">
    <div className="surface-heading latency-heading">
      <div><h2 id="latency-heading">Response latency</h2><p>Showing up to the latest 100 saved checks.</p></div>
      <div className="latency-controls">
        <label className="monitor-select-label" htmlFor="latency-monitor">Monitor</label>
        <select id="latency-monitor" className="monitor-select" value={selectedEndpointId || ''} onChange={(event) => {
          setRange(null);
          onSelectEndpoint(event.target.value);
        }} disabled={!endpoints.length}>
          {endpoints.length ? endpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>) : <option value="">No monitors</option>}
        </select>
        <label className="monitor-select-label" htmlFor="latency-range">Range</label>
        <select id="latency-range" className="monitor-select latency-range-select" value={selectedRange}
          onChange={(event) => setRange(event.target.value)} disabled={!endpoints.length}>
          <option value="recent">Last 24 hours</option>
          <option value="all">Full history</option>
        </select>
        <button className="secondary-button compact-refresh" type="button" onClick={onRefresh} disabled={!selectedEndpointId || loading || refreshing}>
          <span className={refreshing ? 'refresh-icon spinning' : 'refresh-icon'} aria-hidden="true">↻</span>{refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
    </div>
    {endpoints.length
      ? <LatencyChart
        key={`${selectedEndpointId}:${selectedRange}`}
        checks={visibleChecks}
        loading={loading}
        error={error}
        onRetry={onRefresh}
        emptyInRange={selectedRange === 'recent' && checks.length > 0}
      />
      : <div className="latency-state latency-empty"><strong>No monitors to chart</strong><span>Register a monitor and run a check to create history.</span></div>}
    <div className="latency-refresh-note" aria-live="polite">{selectedEndpointId ? 'History refreshes every 30 seconds while this dashboard is open.' : 'Select a monitor to view history.'}</div>
  </section>;
}
