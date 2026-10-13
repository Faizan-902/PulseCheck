export function prepareLatencySeries(checks) {
  return checks
    .map((check, index) => {
      const timestamp = check.checkedAt == null ? Number.NaN : new Date(check.checkedAt).getTime();
      const rawLatency = check.latencyMs;
      const latency = rawLatency === null || rawLatency === undefined || rawLatency === ''
        ? null
        : Number(rawLatency);
      return {
        ...check,
        timestamp,
        latencyMs: Number.isFinite(latency) && latency >= 0 ? latency : null,
        status: check.status === 'UP' || check.status === 'DOWN' ? check.status : 'UNKNOWN',
        sourceIndex: index
      };
    })
    .filter((check) => Number.isFinite(check.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp || left.sourceIndex - right.sourceIndex);
}

function roundedAxisMaximum(maximum) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, maximum)));
  const normalized = maximum / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function buildLatencyChart(checks, width = 780, height = 280) {
  const series = prepareLatencySeries(checks);
  if (!series.length) return { points: [], segments: [], ticks: [], width, height };

  const padding = { top: 22, right: 18, bottom: 48, left: Math.min(68, Math.max(48, width * 0.18)) };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const minTime = series[0].timestamp;
  const maxTime = series.at(-1).timestamp;
  const maxLatency = Math.max(1, ...series.map((point) => point.latencyMs ?? 0));
  const axisMaximum = roundedAxisMaximum(maxLatency);
  const points = series.map((point) => ({
    ...point,
    x: padding.left + (maxTime === minTime ? plotWidth / 2 : ((point.timestamp - minTime) / (maxTime - minTime)) * plotWidth),
    y: padding.top + plotHeight * (1 - (point.latencyMs ?? 0) / axisMaximum),
    unavailable: point.latencyMs === null
  }));

  const segments = [];
  let segment = [];
  for (const point of points) {
    if (point.unavailable) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else {
      segment.push(point);
    }
  }
  if (segment.length) segments.push(segment);

  return {
    points,
    segments,
    ticks: [0, axisMaximum / 2, axisMaximum],
    padding,
    plotHeight,
    width,
    height,
    axisMaximum
  };
}
