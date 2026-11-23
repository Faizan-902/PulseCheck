import { ErrorBanner } from '../components/DashboardMessages.jsx';
import { Icon } from '../components/Icon.jsx';
import { formatDate } from '../lib/format.js';

export function Incidents({ incidentFeed, incidentsLoading, pageError, viewMonitors, dismissError }) {
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">MONITORING</p>
          <h1>Incidents</h1>
          <p className="heading-copy">Availability incidents recorded for your monitors.</p>
        </div>
        <button className="secondary-button refresh-action" type="button" onClick={viewMonitors}>
          <Icon name="monitors" size={15} /> View monitors
        </button>
      </section>
      <ErrorBanner message={pageError} onDismiss={dismissError} compact />
      <section className="surface incidents-surface">
        <div className="surface-heading">
          <div>
            <h2>Incident history</h2>
            <p>Incidents are opened and resolved from consecutive check results.</p>
          </div>
          <span className="incident-count">{incidentFeed.length} total</span>
        </div>
        {incidentsLoading ? (
          <div className="loading-state">
            <span className="spinner" />
            Loading incidents…
          </div>
        ) : incidentFeed.length ? (
          <div className="incident-list">
            {incidentFeed.map((incident) => (
              <article className="incident-item" key={incident.id}>
                <span className={`incident-icon ${incident.resolvedAt ? 'incident-resolved' : ''}`}>
                  <Icon name={incident.resolvedAt ? 'pulse' : 'incidents'} size={17} />
                </span>
                <div className="incident-copy">
                  <div>
                    <h3>{incident.endpointName}</h3>
                    <span
                      className={`incident-state ${incident.resolvedAt ? 'state-resolved' : 'state-open'}`}
                    >
                      {incident.resolvedAt ? 'Resolved' : 'Open'}
                    </span>
                  </div>
                  <p>
                    {incident.resolvedAt
                      ? `Resolved ${formatDate(incident.resolvedAt)}`
                      : `Opened ${formatDate(incident.openedAt)}`}
                  </p>
                </div>
                <span className="incident-date">{formatDate(incident.openedAt)}</span>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state incident-empty">
            <span className="empty-icon">
              <Icon name="incidents" size={23} />
            </span>
            <h3>No incidents recorded</h3>
            <p>When a monitor has two consecutive failures, its incident will appear here.</p>
          </div>
        )}
      </section>
    </>
  );
}
