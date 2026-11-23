import { Icon } from './Icon.jsx';

export function Sidebar({
  user,
  page,
  onNavigate,
  summary,
  hasOpenIncidents,
  currentDown,
  systemPending,
  systemLabel,
  handleLogout
}) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <a
        className="brand"
        href="#overview"
        onClick={(event) => {
          event.preventDefault();
          onNavigate('overview');
        }}
      >
        <span className="brand-mark">
          <Icon name="pulse" size={19} />
        </span>
        <span>
          pulse<span className="brand-light">check</span>
        </span>
        <span className="brand-version">BETA</span>
      </a>
      <div className="workspace-switch">
        <span className="workspace-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
        <span>
          <strong>Personal workspace</strong>
          <small>{user.email}</small>
        </span>
        <Icon name="chevron" size={14} />
      </div>
      <p className="nav-label">WORKSPACE</p>
      <nav className="primary-nav">
        {[
          ['overview', 'Overview', 'overview'],
          ['monitors', 'Monitors', 'monitors'],
          ['incidents', 'Incidents', 'incidents']
        ].map(([id, label, icon]) => (
          <button
            className={`nav-item ${page === id ? 'nav-active' : ''}`}
            type="button"
            key={id}
            onClick={() => onNavigate(id)}
          >
            <Icon name={icon} />
            <span>{label}</span>
            {id === 'monitors' && <span className="nav-count">{summary.total}</span>}
            {id === 'incidents' && hasOpenIncidents && <span className="nav-indicator" />}
          </button>
        ))}
      </nav>
      <p className="nav-label secondary-nav-label">PREFERENCES</p>
      <button
        className="nav-item nav-disabled"
        type="button"
        disabled
        title="Settings are not available yet"
      >
        <Icon name="settings" />
        <span>Settings</span>
        <span className="soon-label">Soon</span>
      </button>
      <div className="sidebar-bottom">
        <div className="sidebar-status">
          <span className={`live-dot ${currentDown ? 'live-down' : systemPending ? 'live-warn' : ''}`} />
          <div>
            <strong>{systemLabel}</strong>
            <small>
              {summary.total ? `${summary.up} up · ${summary.down} down` : 'Status from your monitors'}
            </small>
          </div>
        </div>
        <div className="sidebar-user">
          <span className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </span>
          <button
            className="user-menu"
            type="button"
            onClick={handleLogout}
            aria-label="Sign out"
            title="Sign out"
          >
            ↪
          </button>
        </div>
      </div>
    </aside>
  );
}

export function Topbar({
  page,
  systemTone,
  systemLabel,
  canAddMonitor,
  atMonitorLimit,
  openForm,
  handleLogout
}) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span>Workspace</span>
        <span className="breadcrumb-slash">/</span>
        <strong>
          {page === 'overview' ? 'Overview' : page === 'monitors' ? 'Monitors' : 'Incidents'}
        </strong>
      </div>
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
          Add monitor
        </button>
        <button className="signout-button" type="button" onClick={handleLogout}>
          Sign out
        </button>
      </div>
    </header>
  );
}
