import { ErrorBanner, SuccessBanner } from '../components/DashboardMessages.jsx';
import { Icon } from '../components/Icon.jsx';
import { LatencyPanel } from '../components/LatencyChart.jsx';
import { MonitorList, MonitorSkeleton } from '../components/MonitorList.jsx';
import { RecentIncidents } from '../components/RecentIncidents.jsx';

function MonitorSummary({ summary, loading, maxEndpointsPerUser }) {
  return (
    <section className="kpi-grid" aria-label="Monitor summary">
      <article className="kpi-card">
        <span className="kpi-label">Total monitors</span>
        <div>
          <strong>{loading ? '—' : summary.total}</strong>
          <span className="kpi-icon icon-neutral">
            <Icon name="monitors" />
          </span>
        </div>
        <small>
          {maxEndpointsPerUser == null
            ? 'Registered endpoints'
            : `${summary.total} of ${maxEndpointsPerUser} monitors used`}
        </small>
      </article>
      <article className="kpi-card">
        <span className="kpi-label">Operational</span>
        <div>
          <strong className="kpi-green">{loading ? '—' : summary.up}</strong>
          <span className="kpi-icon icon-green">
            <Icon name="pulse" />
          </span>
        </div>
        <small>Latest recorded check</small>
      </article>
      <article className="kpi-card">
        <span className="kpi-label">Down</span>
        <div>
          <strong className={summary.down ? 'kpi-red' : ''}>{loading ? '—' : summary.down}</strong>
          <span className="kpi-icon icon-red">
            <Icon name="incidents" />
          </span>
        </div>
        <small>Latest recorded check</small>
      </article>
      <article className="kpi-card">
        <span className="kpi-label">Availability</span>
        <div>
          <strong className="kpi-na">—</strong>
          <span className="kpi-icon icon-neutral">
            <Icon name="clock" />
          </span>
        </div>
        <small>No aggregate window in API</small>
      </article>
    </section>
  );
}

export function MonitorOverview({ page, messages, monitors, viewIncidents }) {
  const { pageError, pageErrorAction, notice, clearPageError, dismissNotice } = messages;
  const {
    summary,
    loading,
    maxEndpointsPerUser,
    loadEndpoints,
    scheduling,
    endpoints,
    checksByEndpoint,
    expandedEndpointId,
    checkingId,
    checkError,
    deletingId,
    historyLoadingId,
    runCheck,
    openDeleteDialog,
    toggleHistory,
    recentIncidents,
    latency
  } = monitors;

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">API OBSERVABILITY</p>
          <h1>{page === 'overview' ? 'Monitoring overview' : 'Monitors'}</h1>
          <p className="heading-copy">
            {page === 'overview'
              ? 'A clear view of endpoint health and recent check activity.'
              : 'Manage your registered endpoints and inspect their check history.'}
          </p>
        </div>
        <span className="updated-label">
          <Icon name="clock" size={14} /> Data from PostgreSQL
        </span>
      </section>
      <ErrorBanner message={pageError} action={pageErrorAction} onDismiss={clearPageError} />
      <SuccessBanner message={notice} onDismiss={dismissNotice} />
      <MonitorSummary summary={summary} loading={loading} maxEndpointsPerUser={maxEndpointsPerUser} />
      <div className="dashboard-grid">
        <section className="surface monitors-surface" aria-labelledby="monitor-heading">
          <div className="surface-heading">
            <div>
              <h2 id="monitor-heading">
                {page === 'overview' ? 'Your monitors' : 'All monitors'}{' '}
                <span className="heading-count">{summary.total}</span>
              </h2>
              <p>Current status from the latest persisted check.</p>
            </div>
            <div className="surface-controls">
              <button
                className="secondary-button compact-refresh"
                type="button"
                onClick={loadEndpoints}
                aria-label="Refresh monitors"
              >
                <Icon name="refresh" size={15} /> Refresh
              </button>
            </div>
          </div>
          {loading ? (
            <MonitorSkeleton />
          ) : (
            <MonitorList
              scheduling={scheduling}
              endpoints={endpoints}
              checksByEndpoint={checksByEndpoint}
              expandedEndpointId={expandedEndpointId}
              checkingId={checkingId}
              checkError={checkError}
              deletingId={deletingId}
              historyLoadingId={historyLoadingId}
              error={pageError}
              onRetry={loadEndpoints}
              onCheck={runCheck}
              onDelete={openDeleteDialog}
              onHistory={toggleHistory}
            />
          )}
        </section>
        <RecentIncidents incidents={recentIncidents} scheduling={scheduling} onViewAll={viewIncidents} />
      </div>
      <LatencyPanel endpoints={endpoints} {...latency} />
    </>
  );
}
