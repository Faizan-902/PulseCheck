import { Brand } from './Brand.jsx';
import { Icon } from './Icon.jsx';

const pages = [
  { id: 'overview', label: 'Overview' },
  { id: 'monitors', label: 'Monitors' },
  { id: 'incidents', label: 'Incidents' }
];

export function Topbar({
  page,
  onNavigate,
  hasOpenIncidents,
  systemTone,
  systemLabel,
  canAddMonitor,
  atMonitorLimit,
  openForm,
  handleLogout
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand
          href="#overview"
          onClick={(event) => {
            event.preventDefault();
            onNavigate('overview');
          }}
        />
        <nav className="primary-nav" aria-label="Workspace">
          {pages.map(({ id, label }) => (
            <button
              className="nav-item"
              aria-current={page === id ? 'page' : undefined}
              type="button"
              key={id}
              onClick={() => onNavigate(id)}
            >
              {label}
              {id === 'incidents' && hasOpenIncidents && (
                <span className="nav-indicator" aria-label="Open incidents" />
              )}
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <span className={`system-pill ${systemTone}`}>
            <span className="live-dot" />
            {systemLabel}
          </span>
          <button
            className="primary-button add-button"
            type="button"
            disabled={!canAddMonitor}
            title={atMonitorLimit ? 'Monitor limit reached' : undefined}
            onClick={openForm}
          >
            <Icon name="plus" size={16} />
            <span>Add monitor</span>
          </button>
          <button className="signout-button" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
