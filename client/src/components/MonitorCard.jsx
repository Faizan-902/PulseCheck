import { Icon } from './Icon.jsx';
import { formatDate, relativeDate } from '../lib/format.js';

export function MonitorCard({
  endpoint,
  history,
  expanded,
  checkingId,
  checkError,
  cooldownSeconds = 0,
  deletingId,
  historyLoadingId,
  scheduling,
  onCheck,
  onDelete,
  onHistory
}) {
  const detail = history || { checks: [], incidents: [], error: '' };
  const mark =
    endpoint.latestStatus === 'UP' ? 'mark-up' : endpoint.latestStatus === 'DOWN' ? 'mark-down' : '';
  return (
    <article className={`monitor-card ${expanded ? 'monitor-expanded' : ''}`}>
      <div className="monitor-row">
        <div className="monitor-name-cell">
          <span className={`monitor-mark ${mark}`}>
            <Icon name="pulse" size={18} />
          </span>
          <div className="monitor-name-copy">
            <div className="monitor-title">
              <h3>{endpoint.name}</h3>
              <StatusBadge status={endpoint.latestStatus} />
            </div>
            <a className="endpoint-url" href={endpoint.url} target="_blank" rel="noreferrer">
              {endpoint.url}
              <Icon name="arrow" size={12} />
            </a>
          </div>
        </div>
        <div className="monitor-data">
          <span className="mobile-column-label">HTTP</span>
          <strong className={endpoint.latestHttpStatus >= 400 ? 'text-down' : ''}>
            {endpoint.latestHttpStatus ?? '—'}
          </strong>
        </div>
        <div className="monitor-data">
          <span className="mobile-column-label">Latency</span>
          <strong>{endpoint.latestLatencyMs == null ? '—' : `${endpoint.latestLatencyMs} ms`}</strong>
        </div>
        <div className="monitor-data last-checked">
          <span className="mobile-column-label">Last checked</span>
          <strong title={formatDate(endpoint.latestCheckedAt)}>
            {relativeDate(endpoint.latestCheckedAt)}
          </strong>
        </div>
        <div className="monitor-actions">
          <button
            className="icon-button history-trigger"
            type="button"
            aria-label={`${expanded ? 'Hide' : 'View'} ${endpoint.name} history`}
            aria-expanded={expanded}
            onClick={() => onHistory(endpoint.id)}
            title="View history"
          >
            <Icon name="clock" />
          </button>
          <button
            className="check-button"
            disabled={checkingId === endpoint.id || cooldownSeconds > 0}
            onClick={() => onCheck(endpoint)}
            type="button"
            aria-label={
              cooldownSeconds > 0
                ? `Wait ${cooldownSeconds} ${cooldownSeconds === 1 ? 'second' : 'seconds'} before checking ${endpoint.name}`
                : `Check ${endpoint.name}`
            }
          >
            {checkingId === endpoint.id ? (
              <>
                <span className="button-spinner" />
                Checking
              </>
            ) : cooldownSeconds > 0 ? (
              <>
                <Icon name="clock" size={13} /> {cooldownSeconds}s
              </>
            ) : (
              <>
                <Icon name="play" size={13} /> Check
              </>
            )}
          </button>
          <button
            className="delete-button"
            disabled={deletingId === endpoint.id}
            onClick={() => onDelete(endpoint)}
            type="button"
          >
            {deletingId === endpoint.id ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
      {checkError?.endpointId === endpoint.id && (
        <p className="detail-error monitor-check-error" role="alert">
          {checkError.isCooldown && cooldownSeconds > 0
            ? `Wait ${cooldownSeconds} ${cooldownSeconds === 1 ? 'second' : 'seconds'} between manual checks of this monitor.`
            : checkError.message}
        </p>
      )}
      {expanded && (
        <div className="monitor-detail">
          <div className="detail-head history-title">
            <div>
              <h4>Check history</h4>
              <p>Last 20 persisted results · {describeSchedule(endpoint, scheduling)}</p>
            </div>
            <span className="detail-updated">
              {detail.checks?.length ? `${detail.checks.length} results` : ''}
            </span>
          </div>
          <CheckHistory
            checks={detail.checks || []}
            error={detail.error}
            loading={historyLoadingId === endpoint.id}
          />
          {(endpoint.open_incident_count > 0 || detail.incidents?.length > 0) && (
            <div className="endpoint-incident-note">
              {endpoint.open_incident_count ?? 0} open incident
              {endpoint.open_incident_count === 1 ? '' : 's'} for this monitor
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function StatusBadge({ status }) {
  const normalized = status === 'UP' ? 'up' : status === 'DOWN' ? 'down' : 'unknown';
  const label = status || 'NOT CHECKED';
  return (
    <span className={`status-badge status-${normalized}`}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

function CheckHistory({ checks, loading, error }) {
  if (loading)
    return (
      <div className="detail-state">
        <span className="spinner" />
        Loading check history…
      </div>
    );
  if (error)
    return (
      <p className="detail-error" role="alert">
        {error}
      </p>
    );
  if (!checks.length) return <p className="detail-muted">No checks have been recorded yet.</p>;
  return (
    <div className="history-table-wrap">
      <table className="history-table">
        <thead>
          <tr>
            <th>Checked</th>
            <th>Result</th>
            <th>HTTP</th>
            <th>Latency</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.id}>
              <td title={formatDate(check.checkedAt)}>{relativeDate(check.checkedAt)}</td>
              <td>
                <StatusBadge status={check.status} />
              </td>
              <td>{check.httpStatus ?? '—'}</td>
              <td>{check.latencyMs == null ? '—' : `${check.latencyMs} ms`}</td>
              <td>{check.errorType || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function describeSchedule(endpoint, scheduling) {
  const seconds = Math.max(endpoint.checkIntervalSeconds, scheduling.minIntervalSeconds);
  const interval = seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
  return scheduling.mode === 'cron'
    ? `Hosted target: about every ${interval}, subject to scheduler delays`
    : `Worker target: every ${interval} while running`;
}
