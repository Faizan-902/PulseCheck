import { AddMonitorDialog } from '../components/AddMonitorDialog.jsx';
import { Sidebar, Topbar } from '../components/DashboardNavigation.jsx';
import { DeleteMonitorDialog } from '../components/DeleteMonitorDialog.jsx';
import { Incidents } from './Incidents.jsx';
import { MonitorOverview } from './MonitorOverview.jsx';

export function Dashboard({ user, page, setPage, handleLogout, messages, monitors, incidents }) {
  const { summary, loading, maxEndpointsPerUser, scheduling, hasOpenIncidents } = monitors;
  const { clearPageError, pageError, setPageError } = messages;
  const atMonitorLimit = maxEndpointsPerUser != null && summary.total >= maxEndpointsPerUser;
  const currentDown = summary.down > 0;
  const systemPending = !summary.total || summary.unchecked > 0;
  const systemTone = currentDown
    ? 'system-degraded'
    : systemPending
      ? 'system-pending'
      : 'system-operational';
  const systemLabel = loading
    ? 'Loading status'
    : !summary.total
      ? 'No monitors yet'
      : currentDown
        ? 'Degraded'
        : summary.unchecked
          ? 'Awaiting first checks'
          : 'All monitored endpoints up';

  function navigate(nextPage) {
    setPage(nextPage);
    clearPageError();
  }

  return (
    <div className="app-shell">
      <Sidebar
        user={user}
        page={page}
        onNavigate={navigate}
        summary={summary}
        hasOpenIncidents={hasOpenIncidents}
        currentDown={currentDown}
        systemPending={systemPending}
        systemLabel={systemLabel}
        handleLogout={handleLogout}
      />
      <main className="main-area">
        <Topbar
          page={page}
          systemTone={systemTone}
          systemLabel={systemLabel}
          canAddMonitor={Boolean(scheduling) && !atMonitorLimit}
          atMonitorLimit={atMonitorLimit}
          openForm={monitors.openForm}
          handleLogout={handleLogout}
        />
        <div className="page-content">
          {page === 'incidents' ? (
            <Incidents
              incidentFeed={incidents.feed}
              incidentsLoading={incidents.loading}
              pageError={pageError}
              viewMonitors={() => setPage('overview')}
              dismissError={() => setPageError('')}
            />
          ) : (
            <MonitorOverview
              page={page}
              messages={messages}
              monitors={monitors}
              viewIncidents={() => setPage('incidents')}
            />
          )}
          <footer className="page-footer">
            <span>
              PulseCheck <span className="footer-separator">·</span> API monitoring
            </span>
            <span>Checks and incidents persisted in PostgreSQL</span>
          </footer>
        </div>
      </main>
      {monitors.formOpen && (
        <AddMonitorDialog
          scheduling={scheduling}
          atMonitorLimit={atMonitorLimit}
          form={monitors.form}
          setForm={monitors.setForm}
          formError={monitors.formError}
          saving={monitors.saving}
          onClose={monitors.closeForm}
          onSubmit={monitors.handleSubmit}
        />
      )}
      {monitors.deleteTarget && (
        <DeleteMonitorDialog
          endpoint={monitors.deleteTarget}
          busy={monitors.deletingId === monitors.deleteTarget.id}
          error={monitors.deleteError}
          onCancel={monitors.closeDeleteDialog}
          onConfirm={monitors.handleDeleteMonitor}
        />
      )}
    </div>
  );
}
