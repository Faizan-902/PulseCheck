import { Icon } from './Icon.jsx';
import { MonitorCard } from './MonitorCard.jsx';

export function MonitorList({
  scheduling,
  endpoints,
  checksByEndpoint,
  expandedEndpointId,
  checkingId,
  checkError,
  deletingId,
  historyLoadingId,
  error,
  onRetry,
  onCheck,
  onDelete,
  onHistory
}) {
  if (!endpoints.length)
    return (
      <div className="empty-state">
        <span className="empty-icon">
          <Icon name={error ? 'refresh' : 'pulse'} size={23} />
        </span>
        <h3>{error ? 'Monitor list unavailable' : 'No monitors registered'}</h3>
        <p>
          {error ||
            'Add a public API endpoint to start collecting real availability and response-time data.'}
        </p>
        {error && (
          <button className="secondary-button" type="button" onClick={onRetry}>
            Retry monitor list
          </button>
        )}
      </div>
    );
  return (
    <div className="monitor-list">
      {endpoints.map((endpoint) => {
        return (
          <MonitorCard
            key={endpoint.id}
            endpoint={endpoint}
            history={checksByEndpoint[endpoint.id]}
            expanded={expandedEndpointId === endpoint.id}
            checkingId={checkingId}
            checkError={checkError}
            deletingId={deletingId}
            historyLoadingId={historyLoadingId}
            scheduling={scheduling}
            onCheck={onCheck}
            onDelete={onDelete}
            onHistory={onHistory}
          />
        );
      })}
    </div>
  );
}

export function MonitorSkeleton() {
  return (
    <div className="monitor-skeleton-list" role="status" aria-label="Loading monitors">
      {[0, 1, 2].map((row) => (
        <div className="monitor-skeleton-row" key={row}>
          <span />
          <div>
            <i />
            <i />
          </div>
          <span />
          <span />
          <span />
        </div>
      ))}
      <span className="sr-only">Loading monitors…</span>
    </div>
  );
}
