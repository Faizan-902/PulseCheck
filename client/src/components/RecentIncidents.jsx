import { Icon } from './Icon.jsx';
import { relativeDate } from '../lib/format.js';

export function RecentIncidents({ incidents, scheduling, onViewAll }) {
  return (
    <aside className="activity-column">
      <section className="surface activity-surface">
        <div className="surface-heading activity-heading">
          <div>
            <h2>Recent incidents</h2>
            <p>From endpoint incident history.</p>
          </div>
          <button className="text-button" type="button" onClick={onViewAll}>
            View all
          </button>
        </div>
        {incidents.length ? (
          <div className="activity-list">
            {incidents.map((incident) => (
              <div className="activity-item" key={incident.id}>
                <span className={`activity-dot ${incident.resolvedAt ? 'activity-resolved' : ''}`} />
                <div>
                  <strong>{incident.endpointName}</strong>
                  <p>
                    {incident.resolvedAt ? 'Incident resolved' : 'Incident open'} ·{' '}
                    {relativeDate(incident.resolvedAt || incident.openedAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="activity-empty">
            <span className="activity-empty-icon">
              <Icon name="incidents" size={16} />
            </span>
            <p>No incident activity to show.</p>
          </div>
        )}
      </section>
      <section className="worker-note">
        <span className="worker-note-icon">
          <Icon name="pulse" size={17} />
        </span>
        <div>
          <strong>Monitoring status</strong>
          <p>
            {scheduling?.mode === 'cron'
              ? 'Hosted checks depend on a best-effort schedule and may run late.'
              : 'Scheduled checks run while the worker process is running.'}
          </p>
        </div>
      </section>
    </aside>
  );
}
