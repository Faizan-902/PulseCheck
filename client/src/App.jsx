import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LatencyPanel } from './components/LatencyChart.jsx';
import { deleteMonitorAndReconcile } from './monitor-deletion.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

async function apiRequest(path, options = {}, csrfToken = '') {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method || 'GET').toUpperCase()) && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error('Could not reach the PulseCheck API. Check your connection and try again.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function relativeDate(value) {
  if (!value) return 'Never';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (!Number.isFinite(elapsed)) return '—';
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Icon({ name, size = 18 }) {
  const paths = {
    pulse: <><path d="M3 12h4l2.2-6 4.1 12 2.1-6H21" /></>,
    overview: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>,
    monitors: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h6M7 17h3" /></>,
    incidents: <><path d="m12 3 9 16H3L12 3Z" /><path d="M12 9v4m0 3h.01" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.2 1-1.2 2-1.5-.5a8 8 0 0 1-1.6.9l-.3 1.5h-2.4l-.3-1.5a8 8 0 0 1-1.6-.9l-1.5.5-1.2-2 1.2-1a7 7 0 0 1 0-1.9l-1.2-1 1.2-2 1.5.5a8 8 0 0 1 1.6-.9l.3-1.5h2.4l.3 1.5a8 8 0 0 1 1.6.9l1.5-.5 1.2 2-1.2 1a7 7 0 0 1-.1 1.8Z" /></>,
    plus: <path d="M12 5v14m-7-7h14" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 11.7-2L20 12M4 12l2.8 5a7 7 0 0 0 11.7-2" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
    close: <path d="m18 6-12 12M6 6l12 12" />,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function StatusBadge({ status }) {
  const normalized = status === 'UP' ? 'up' : status === 'DOWN' ? 'down' : 'unknown';
  const label = status || 'NOT CHECKED';
  return <span className={`status-badge status-${normalized}`}><span className="status-dot" />{label}</span>;
}

function CheckHistory({ checks, loading, error }) {
  if (loading) return <div className="detail-state"><span className="spinner" />Loading check history…</div>;
  if (error) return <p className="detail-error" role="alert">{error}</p>;
  if (!checks.length) return <p className="detail-muted">No checks have been recorded yet.</p>;
  return <div className="history-table-wrap"><table className="history-table">
    <thead><tr><th>Checked</th><th>Result</th><th>HTTP</th><th>Latency</th><th>Error</th></tr></thead>
    <tbody>{checks.map((check) => <tr key={check.id}>
      <td title={formatDate(check.checkedAt)}>{relativeDate(check.checkedAt)}</td><td><StatusBadge status={check.status} /></td>
      <td>{check.httpStatus ?? '—'}</td><td>{check.latencyMs == null ? '—' : `${check.latencyMs} ms`}</td><td>{check.errorType || '—'}</td>
    </tr>)}</tbody>
  </table></div>;
}

function MonitorTable({ endpoints, checksByEndpoint, expandedEndpointId, checkingId, deletingId, historyLoadingId, error, onRetry, onCheck, onDelete, onHistory }) {
  if (!endpoints.length) return <div className="empty-state">
    <span className="empty-icon"><Icon name={error ? 'refresh' : 'pulse'} size={23} /></span>
    <h3>{error ? 'Monitor list unavailable' : 'No monitors registered'}</h3>
    <p>{error || 'Add a public API endpoint to start collecting real availability and response-time data.'}</p>
    {error && <button className="secondary-button" type="button" onClick={onRetry}>Retry monitor list</button>}
  </div>;
  return <div className="monitor-list">{endpoints.map((endpoint) => {
    const detail = checksByEndpoint[endpoint.id] || { checks: [], incidents: [], error: '' };
    const expanded = expandedEndpointId === endpoint.id;
    return <article className={`monitor-card ${expanded ? 'monitor-expanded' : ''}`} key={endpoint.id}>
      <div className="monitor-row">
        <div className="monitor-name-cell">
          <span className={`monitor-mark ${endpoint.latestStatus === 'UP' ? 'mark-up' : endpoint.latestStatus === 'DOWN' ? 'mark-down' : ''}`}><Icon name="pulse" size={18} /></span>
          <div className="monitor-name-copy"><div className="monitor-title"><h3>{endpoint.name}</h3><StatusBadge status={endpoint.latestStatus} /></div>
            <a className="endpoint-url" href={endpoint.url} target="_blank" rel="noreferrer">{endpoint.url}<Icon name="arrow" size={12} /></a>
          </div>
        </div>
        <div className="monitor-data"><span className="mobile-column-label">HTTP</span><strong className={endpoint.latestHttpStatus >= 400 ? 'text-down' : ''}>{endpoint.latestHttpStatus ?? '—'}</strong></div>
        <div className="monitor-data"><span className="mobile-column-label">Latency</span><strong>{endpoint.latestLatencyMs == null ? '—' : `${endpoint.latestLatencyMs} ms`}</strong></div>
        <div className="monitor-data last-checked"><span className="mobile-column-label">Last checked</span><strong title={formatDate(endpoint.latestCheckedAt)}>{relativeDate(endpoint.latestCheckedAt)}</strong></div>
        <div className="monitor-actions">
          <button className="icon-button history-trigger" type="button" aria-label={`${expanded ? 'Hide' : 'View'} ${endpoint.name} history`} aria-expanded={expanded} onClick={() => onHistory(endpoint.id)} title="View history"><Icon name="clock" /></button>
          <button className="check-button" disabled={checkingId === endpoint.id} onClick={() => onCheck(endpoint)} type="button" aria-label={`Check ${endpoint.name}`}>
            {checkingId === endpoint.id ? <><span className="button-spinner" />Checking</> : <><Icon name="play" size={13} /> Check</>}
          </button>
          <button className="delete-button" disabled={deletingId === endpoint.id} onClick={() => onDelete(endpoint)} type="button">{deletingId === endpoint.id ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>
      {expanded && <div className="monitor-detail">
        <div className="detail-head history-title"><div><h4>Check history</h4><p>Last 20 persisted results · scheduled every {endpoint.checkIntervalSeconds ?? 300}s</p></div><span className="detail-updated">{detail.checks?.length ? `${detail.checks.length} results` : ''}</span></div>
        <CheckHistory checks={detail.checks || []} error={detail.error} loading={historyLoadingId === endpoint.id} />
        {detail.incidents?.length > 0 && <div className="endpoint-incident-note">{detail.incidents.filter((incident) => !incident.resolvedAt).length} open incident{detail.incidents.filter((incident) => !incident.resolvedAt).length === 1 ? '' : 's'} for this monitor</div>}
      </div>}
    </article>;
  })}</div>;
}

function MonitorSkeleton() {
  return <div className="monitor-skeleton-list" role="status" aria-label="Loading monitors">
    {[0, 1, 2].map((row) => <div className="monitor-skeleton-row" key={row}><span /><div><i /><i /></div><span /><span /><span /></div>)}
    <span className="sr-only">Loading monitors…</span>
  </div>;
}

function DeleteMonitorDialog({ endpoint, busy, error, onCancel, onConfirm }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const previousFocus = document.activeElement;
    cancelRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCancel();
      }
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll('button:not(:disabled)') || [];
      if (!controls.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onCancel]);

  return <div className="dialog-backdrop delete-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section className="add-dialog delete-dialog" ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" tabIndex="-1">
      <div className="dialog-heading"><div><span className="dialog-icon delete-dialog-icon"><Icon name="incidents" /></span><div><p className="eyebrow">REMOVE MONITOR</p><h2 id="delete-dialog-title">Delete {endpoint.name}?</h2></div></div></div>
      <p id="delete-dialog-description" className="dialog-copy">This permanently deletes the monitor, its saved check history, and its incidents. An in-progress scheduled check will be discarded safely.</p>
      {error && <p className="form-error delete-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button ref={cancelRef} className="secondary-button" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="danger-button" type="button" onClick={onConfirm} disabled={busy}>{busy ? <><span className="button-spinner" />Deleting…</> : 'Delete monitor'}</button></div>
    </section>
  </div>;
}

function AddMonitorDialog({ form, setForm, formError, saving, onClose, onSubmit }) {
  const dialogRef = useRef(null);
  const firstInputRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(saving);
  onCloseRef.current = onClose;
  savingRef.current = saving;

  useEffect(() => {
    const previousFocus = document.activeElement;
    firstInputRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled)') || [];
      if (!controls.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="add-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-dialog-title" tabIndex="-1">
      <div className="dialog-heading"><div><span className="dialog-icon"><Icon name="plus" /></span><div><p className="eyebrow">NEW MONITOR</p><h2 id="add-dialog-title">Add endpoint</h2></div></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose} disabled={saving}><Icon name="close" /></button></div>
      <p className="dialog-copy">Register an endpoint to run manual checks and collect monitoring history.</p>
      <form onSubmit={onSubmit} className="endpoint-form">
        <label><span>Monitor name</span><input ref={firstInputRef} autoComplete="off" maxLength={100} placeholder="Payments API" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label><span>Endpoint URL</span><input autoComplete="url" placeholder="https://api.example.com/health" required type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /></label>
        <div className="form-columns"><label><span>Timeout <small>100–30,000 ms</small></span><input inputMode="numeric" max="30000" min="100" required type="number" value={form.timeoutMs} onChange={(event) => setForm({ ...form, timeoutMs: event.target.value })} /></label>
          <label><span>Interval <small>30–86,400 sec</small></span><input inputMode="numeric" max="86400" min="30" required type="number" value={form.checkIntervalSeconds} onChange={(event) => setForm({ ...form, checkIntervalSeconds: event.target.value })} /></label></div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <p className="form-hint">Only public HTTP and HTTPS destinations are allowed. The server validates the URL before checking it.</p>
        <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" disabled={saving} type="submit">{saving ? <><span className="button-spinner" />Adding monitor…</> : <><Icon name="plus" size={16} /> Add monitor</>}</button></div>
      </form>
    </section>
  </div>;
}

function AuthenticationScreen({ onAuthenticate, serviceError = '' }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onAuthenticate(mode, form); }
    catch (authError) { setError(authError.message); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell">
    <section className="auth-story"><a className="brand auth-brand" href="#signin"><span className="brand-mark"><Icon name="pulse" size={19} /></span><span>pulse<span className="brand-light">check</span></span></a>
      <div className="auth-story-copy"><span className="auth-overline"><span className="live-dot" /> API HEALTH, CLEARLY</span><h1>Know when your APIs<br />need attention.</h1><p>Monitor public endpoints, run checks on demand, and keep a clear record of response health.</p>
        <div className="auth-preview"><div className="preview-heading"><span>HOW PULSECHECK WORKS</span><span className="preview-live"><i /> WORKFLOW</span></div><div className="preview-line"><span className="preview-step">01</span><span><b>Register a public endpoint</b><small>Set its check timeout and interval</small></span><span className="preview-arrow">↗</span></div><div className="preview-line"><span className="preview-step">02</span><span><b>Review real check results</b><small>Inspect status, latency, and history</small></span><span className="preview-arrow">↗</span></div><div className="preview-foot"><span>Live monitor data appears after sign in.</span><span>· · ·</span></div></div>
      </div><div className="auth-story-footer"><span>Built for people who care about reliability.</span><span>PulseCheck · API monitoring</span></div>
    </section>
    <section className="auth-form-side"><div className="auth-mobile-brand"><a className="brand" href="#signin"><span className="brand-mark"><Icon name="pulse" size={19} /></span><span>pulse<span className="brand-light">check</span></span></a></div>
      <div className="auth-form-wrap"><p className="eyebrow">YOUR MONITORING WORKSPACE</p><h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2><p className="auth-subtitle">{mode === 'login' ? 'Sign in to continue to PulseCheck.' : 'Start tracking your API health in a few steps.'}</p>
        {serviceError && <p className="auth-error" role="alert">{serviceError}</p>}{error && <p className="auth-error" role="alert">{error}</p>}
        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && <label><span>Your name</span><input autoComplete="name" maxLength={100} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>}
          <label><span>Email address</span><input autoComplete="email" type="email" maxLength={320} required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label><span>Password</span><input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" minLength={mode === 'signup' ? 12 : undefined} maxLength={128} required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />{mode === 'signup' && <small>Use at least 12 characters.</small>}</label>
          <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? <><span className="button-spinner" />{mode === 'login' ? 'Signing in…' : 'Creating account…'}</> : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <p className="auth-switch">{mode === 'login' ? 'New to PulseCheck?' : 'Already have an account?'} <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}> {mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
        <p className="auth-security-note"><span aria-hidden="true">▣</span> Sessions use HttpOnly cookies; secure transport is enabled in production.</p>
      </div><div className="auth-form-footer">PulseCheck · Secure API monitoring</div>
    </section>
  </main>;
}

export default function App() {
  const [page, setPage] = useState('overview');
  const [user, setUser] = useState(null);
  const [csrfToken, setCsrfToken] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [endpoints, setEndpoints] = useState([]);
  const [checksByEndpoint, setChecksByEndpoint] = useState({});
  const [incidentFeed, setIncidentFeed] = useState([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [expandedEndpointId, setExpandedEndpointId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [historyLoadingId, setHistoryLoadingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [selectedLatencyEndpointId, setSelectedLatencyEndpointId] = useState('');
  const [latencyChecks, setLatencyChecks] = useState([]);
  const [latencyLoading, setLatencyLoading] = useState(false);
  const [latencyRefreshing, setLatencyRefreshing] = useState(false);
  const [latencyError, setLatencyError] = useState('');
  const [latencyRefreshToken, setLatencyRefreshToken] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [pageError, setPageError] = useState('');
  const [pageErrorAction, setPageErrorAction] = useState(null);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ name: '', url: '', timeoutMs: '5000', checkIntervalSeconds: '300' });

  const loadEndpoints = useCallback(async () => {
    if (!user) { setEndpoints([]); setLoading(false); return false; }
    setPageError('');
    setPageErrorAction(null);
    try {
      const latestEndpoints = await apiRequest('/endpoints', {}, csrfToken);
      setEndpoints(latestEndpoints);
      return true;
    } catch (error) {
      setPageError(error.message);
      setPageErrorAction({ label: 'Retry monitor list', run: () => loadEndpoints() });
      return false;
    }
    finally { setLoading(false); }
  }, [user, csrfToken]);

  useEffect(() => {
    let active = true;
    apiRequest('/auth/me')
      .then((data) => { if (active) { setUser(data.user); setCsrfToken(data.csrfToken); } })
      .catch((error) => { if (active && error.status !== 401) setAuthError(error.message); })
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setEndpoints([]); setLoading(false); return; }
    setLoading(true);
    loadEndpoints();
  }, [authLoading, user, loadEndpoints]);

  useEffect(() => {
    if (!endpoints.some((endpoint) => endpoint.id === selectedLatencyEndpointId)) {
      setSelectedLatencyEndpointId(endpoints[0]?.id || '');
    }
  }, [endpoints, selectedLatencyEndpointId]);

  useEffect(() => {
    setLatencyChecks([]);
    setLatencyError('');
  }, [selectedLatencyEndpointId]);

  useEffect(() => {
    if (page === 'incidents') return undefined;
    if (!selectedLatencyEndpointId) {
      setLatencyChecks([]);
      setLatencyLoading(false);
      setLatencyRefreshing(false);
      setLatencyError('');
      return undefined;
    }

    let active = true;
    let timer;
    let controller;
    let inFlight = false;
    const refresh = async (initial = false) => {
      if (!active || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      if (initial) setLatencyLoading(true);
      else setLatencyRefreshing(true);
      try {
        const checks = await apiRequest(
          `/endpoints/${selectedLatencyEndpointId}/checks?limit=100`,
          { signal: controller.signal },
          csrfToken
        );
        if (active) { setLatencyChecks(checks); setLatencyError(''); }
      } catch (error) {
        if (active) setLatencyError(error.message);
      } finally {
        inFlight = false;
        if (active) {
          setLatencyLoading(false);
          setLatencyRefreshing(false);
          timer = window.setTimeout(() => refresh(false), 30000);
        }
      }
    };

    void refresh(true);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [page, selectedLatencyEndpointId, csrfToken, latencyRefreshToken]);

  const summary = useMemo(() => ({
    total: endpoints.length,
    up: endpoints.filter((endpoint) => endpoint.latestStatus === 'UP').length,
    down: endpoints.filter((endpoint) => endpoint.latestStatus === 'DOWN').length,
    unchecked: endpoints.filter((endpoint) => !endpoint.latestStatus).length
  }), [endpoints]);

  const loadHistory = useCallback(async (endpointId) => {
    setHistoryLoadingId(endpointId);
    setChecksByEndpoint((current) => ({ ...current, [endpointId]: { ...current[endpointId], checks: current[endpointId]?.checks || [], error: '' } }));
    try {
      const [checks, incidents] = await Promise.all([
        apiRequest(`/endpoints/${endpointId}/checks?limit=20`, {}, csrfToken),
        apiRequest(`/endpoints/${endpointId}/incidents`, {}, csrfToken)
      ]);
      setChecksByEndpoint((current) => ({ ...current, [endpointId]: { checks, incidents, error: '' } }));
    } catch (error) { setChecksByEndpoint((current) => ({ ...current, [endpointId]: { ...current[endpointId], checks: [], error: error.message } })); }
    finally { setHistoryLoadingId((current) => current === endpointId ? null : current); }
  }, [csrfToken]);

  const closeDeleteDialog = useCallback(() => {
    setDeleteTarget(null);
    setDeleteError('');
  }, []);

  const refreshLatencyHistory = useCallback(() => {
    setLatencyRefreshToken((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!endpoints.length) { setIncidentFeed([]); return; }
    let active = true;
    if (page === 'incidents') setIncidentsLoading(true);
    Promise.allSettled(endpoints.map(async (endpoint) => ({ endpoint, incidents: await apiRequest(`/endpoints/${endpoint.id}/incidents`, {}, csrfToken) })))
      .then((results) => {
        if (!active) return;
        const failures = results.filter((result) => result.status === 'rejected').length;
        const incidents = results.filter((result) => result.status === 'fulfilled').flatMap((result) => result.value.incidents.map((incident) => ({ ...incident, endpointName: result.value.endpoint.name })));
        incidents.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
        setIncidentFeed(incidents);
        if (failures && page === 'incidents') setPageError(`Could not load incident history for ${failures} monitor${failures === 1 ? '' : 's'}.`);
      })
      .finally(() => { if (active && page === 'incidents') setIncidentsLoading(false); });
    return () => { active = false; };
  }, [page, endpoints, csrfToken]);

  async function handleAuthenticate(mode, credentials) {
    const body = mode === 'signup'
      ? credentials
      : { email: credentials.email, password: credentials.password };
    const data = await apiRequest(`/auth/${mode === 'signup' ? 'signup' : 'login'}`, {
      method: 'POST', body: JSON.stringify(body)
    });
    setUser(data.user);
    setCsrfToken(data.csrfToken);
    setAuthError('');
    setPage('overview');
    setNotice('');
  }

  async function handleLogout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' }, csrfToken);
      setUser(null); setCsrfToken(''); setEndpoints([]); setChecksByEndpoint({}); setIncidentFeed([]);
      setPageError(''); setPageErrorAction(null); setNotice('');
    } catch (error) { setPageError(error.message); setPageErrorAction({ label: 'Retry sign out', run: () => handleLogout() }); }
  }

  async function handleSubmit(event) {
    event.preventDefault(); setFormError(''); setSaving(true);
    try {
      await apiRequest('/endpoints', { method: 'POST', body: JSON.stringify({ name: form.name, url: form.url, timeoutMs: Number(form.timeoutMs), checkIntervalSeconds: Number(form.checkIntervalSeconds) }) }, csrfToken);
      setForm({ name: '', url: '', timeoutMs: '5000', checkIntervalSeconds: '300' }); setFormOpen(false);
      setNotice('Monitor added. Run a check to record its first result.'); await loadEndpoints();
    } catch (error) { setFormError(error.message); }
    finally { setSaving(false); }
  }

  async function runCheck(endpoint) {
    setCheckingId(endpoint.id); setPageError(''); setPageErrorAction(null); setNotice('');
    try {
      const check = await apiRequest(`/endpoints/${endpoint.id}/check`, { method: 'POST' }, csrfToken);
      setNotice(`${endpoint.name}: ${check.status}${check.httpStatus ? ` · HTTP ${check.httpStatus}` : ''} · ${check.latencyMs} ms`);
      await loadEndpoints();
      if (expandedEndpointId === endpoint.id) await loadHistory(endpoint.id);
      if (selectedLatencyEndpointId === endpoint.id) refreshLatencyHistory();
    } catch (error) { setPageError(error.message); setPageErrorAction({ label: 'Retry check', run: () => runCheck(endpoint) }); }
    finally { setCheckingId(null); }
  }

  async function handleDeleteMonitor() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeletingId(target.id);
    setDeleteError('');
    try {
      const result = await deleteMonitorAndReconcile({
        id: target.id,
        knownMonitorIds: endpoints.map((endpoint) => endpoint.id),
        deleteRequest: (id) => apiRequest(`/endpoints/${id}`, { method: 'DELETE' }, csrfToken),
        listRequest: () => apiRequest('/endpoints', {}, csrfToken)
      });
      if (result.monitors) setEndpoints(result.monitors);
      else if (result.status === 'deleted') setEndpoints((current) => current.filter((endpoint) => endpoint.id !== target.id));

      if (result.status === 'not-found') {
        setDeleteError(endpoints.some((endpoint) => endpoint.id === target.id)
          ? 'The API returned 404, but this monitor still appears in the refreshed list. Refresh the list and try again.'
          : 'This monitor is not in your current monitor list. It may be stale or belong to another account.');
        return;
      }
      if (result.status === 'unverified') {
        setDeleteError(`The API returned 404, and the monitor list could not be refreshed to verify its state. ${result.refreshError.message}`);
        return;
      }

      setSelectedLatencyEndpointId((current) => current === target.id ? '' : current);
      setLatencyChecks([]);
      setChecksByEndpoint((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      if (expandedEndpointId === target.id) setExpandedEndpointId(null);
      setDeleteTarget(null);
      setDeleteError('');
      setPageError('');
      setPageErrorAction(null);
      setNotice(result.status === 'already-absent'
        ? `${target.name} was already absent; the monitor list is now up to date.`
        : result.refreshError
          ? `${target.name} was deleted, but the monitor list refresh failed. Use Refresh to reload it.`
          : `${target.name} and its saved check history were deleted.`);
      if (result.refreshError) {
        setPageError(result.refreshError.message);
        setPageErrorAction({ label: 'Retry monitor list', run: () => loadEndpoints() });
      }
    } catch (error) {
      setDeleteError(`Could not confirm deletion. Refresh monitors to verify its current state. ${error.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function toggleHistory(endpointId) {
    if (expandedEndpointId === endpointId) { setExpandedEndpointId(null); return; }
    setExpandedEndpointId(endpointId); await loadHistory(endpointId);
  }

  if (authLoading) return <main className="auth-loading"><span className="spinner" /><p>Checking your session…</p></main>;
  if (!user) return <AuthenticationScreen onAuthenticate={handleAuthenticate} serviceError={authError} />;

  const currentDown = summary.down > 0;
  const systemPending = !summary.total || summary.unchecked > 0;
  const systemTone = currentDown ? 'system-degraded' : systemPending ? 'system-pending' : 'system-operational';
  const systemLabel = loading ? 'Loading status' : !summary.total ? 'No monitors yet' : currentDown ? 'Degraded' : summary.unchecked ? 'Awaiting first checks' : 'All monitored endpoints up';

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Main navigation">
      <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setPage('overview'); setPageError(''); setPageErrorAction(null); }}><span className="brand-mark"><Icon name="pulse" size={19} /></span><span>pulse<span className="brand-light">check</span></span><span className="brand-version">BETA</span></a>
      <div className="workspace-switch"><span className="workspace-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>Personal workspace</strong><small>{user.email}</small></span><Icon name="chevron" size={14} /></div>
      <p className="nav-label">WORKSPACE</p>
      <nav className="primary-nav">
        {[['overview', 'Overview', 'overview'], ['monitors', 'Monitors', 'monitors'], ['incidents', 'Incidents', 'incidents']].map(([id, label, icon]) => <button className={`nav-item ${page === id ? 'nav-active' : ''}`} type="button" key={id} onClick={() => { setPage(id); setPageError(''); setPageErrorAction(null); }}><Icon name={icon} /><span>{label}</span>{id === 'monitors' && <span className="nav-count">{summary.total}</span>}{id === 'incidents' && incidentFeed.some((item) => !item.resolvedAt) && <span className="nav-indicator" />}</button>)}
      </nav>
      <p className="nav-label secondary-nav-label">PREFERENCES</p>
      <button className="nav-item nav-disabled" type="button" disabled title="Settings are not available yet"><Icon name="settings" /><span>Settings</span><span className="soon-label">Soon</span></button>
      <div className="sidebar-bottom"><div className="sidebar-status"><span className={`live-dot ${currentDown ? 'live-down' : systemPending ? 'live-warn' : ''}`} /><div><strong>{systemLabel}</strong><small>{summary.total ? `${summary.up} up · ${summary.down} down` : 'Status from your monitors'}</small></div></div><div className="sidebar-user"><span className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.email}</small></span><button className="user-menu" type="button" onClick={handleLogout} aria-label="Sign out" title="Sign out">↪</button></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{page === 'overview' ? 'Overview' : page === 'monitors' ? 'Monitors' : 'Incidents'}</strong></div><div className="topbar-actions"><span className={`system-pill ${systemTone}`}><span className="live-dot" />{systemLabel}</span><button className="primary-button add-button" type="button" onClick={() => { setFormError(''); setFormOpen(true); }}><Icon name="plus" size={16} />Add monitor</button><button className="signout-button" type="button" onClick={handleLogout}>Sign out</button></div></header>
      <div className="page-content">
        {page === 'incidents' ? <>
          <section className="page-heading"><div><p className="eyebrow">MONITORING</p><h1>Incidents</h1><p className="heading-copy">Availability incidents recorded for your monitors.</p></div><button className="secondary-button refresh-action" type="button" onClick={() => setPage('overview')}><Icon name="monitors" size={15} /> View monitors</button></section>
          {pageError && <div className="alert-banner" role="alert">{pageError}<button onClick={() => setPageError('')} type="button" aria-label="Dismiss error"><Icon name="close" size={15} /></button></div>}
          <section className="surface incidents-surface"><div className="surface-heading"><div><h2>Incident history</h2><p>Incidents are opened and resolved from consecutive check results.</p></div><span className="incident-count">{incidentFeed.length} total</span></div>
            {incidentsLoading ? <div className="loading-state"><span className="spinner" />Loading incidents…</div> : incidentFeed.length ? <div className="incident-list">{incidentFeed.map((incident) => <article className="incident-item" key={incident.id}><span className={`incident-icon ${incident.resolvedAt ? 'incident-resolved' : ''}`}><Icon name={incident.resolvedAt ? 'pulse' : 'incidents'} size={17} /></span><div className="incident-copy"><div><h3>{incident.endpointName}</h3><span className={`incident-state ${incident.resolvedAt ? 'state-resolved' : 'state-open'}`}>{incident.resolvedAt ? 'Resolved' : 'Open'}</span></div><p>{incident.resolvedAt ? `Resolved ${formatDate(incident.resolvedAt)}` : `Opened ${formatDate(incident.openedAt)}`}</p></div><span className="incident-date">{formatDate(incident.openedAt)}</span></article>)}</div> : <div className="empty-state incident-empty"><span className="empty-icon"><Icon name="incidents" size={23} /></span><h3>No incidents recorded</h3><p>When a monitor has two consecutive failures, its incident will appear here.</p></div>}
          </section>
        </> : <>
          <section className="page-heading"><div><p className="eyebrow">API OBSERVABILITY</p><h1>{page === 'overview' ? 'Monitoring overview' : 'Monitors'}</h1><p className="heading-copy">{page === 'overview' ? 'A clear view of endpoint health and recent check activity.' : 'Manage your registered endpoints and inspect their check history.'}</p></div><span className="updated-label"><Icon name="clock" size={14} /> Data from PostgreSQL</span></section>
          {pageError && <div className="alert-banner" role="alert"><span>{pageError}</span><div className="alert-actions">{pageErrorAction && <button type="button" onClick={pageErrorAction.run}>{pageErrorAction.label}</button>}<button type="button" onClick={() => { setPageError(''); setPageErrorAction(null); }} aria-label="Dismiss error"><Icon name="close" size={15} /></button></div></div>}
          {notice && <div className="success-banner" role="status"><span className="success-check">✓</span>{notice}<button onClick={() => setNotice('')} type="button" aria-label="Dismiss message"><Icon name="close" size={15} /></button></div>}
          <section className="kpi-grid" aria-label="Monitor summary">
            <article className="kpi-card"><span className="kpi-label">Total monitors</span><div><strong>{loading ? '—' : summary.total}</strong><span className="kpi-icon icon-neutral"><Icon name="monitors" /></span></div><small>Registered endpoints</small></article>
            <article className="kpi-card"><span className="kpi-label">Operational</span><div><strong className="kpi-green">{loading ? '—' : summary.up}</strong><span className="kpi-icon icon-green"><Icon name="pulse" /></span></div><small>Latest recorded check</small></article>
            <article className="kpi-card"><span className="kpi-label">Down</span><div><strong className={summary.down ? 'kpi-red' : ''}>{loading ? '—' : summary.down}</strong><span className="kpi-icon icon-red"><Icon name="incidents" /></span></div><small>Latest recorded check</small></article>
            <article className="kpi-card"><span className="kpi-label">Availability</span><div><strong className="kpi-na">—</strong><span className="kpi-icon icon-neutral"><Icon name="clock" /></span></div><small>No aggregate window in API</small></article>
          </section>
          <div className="dashboard-grid">
            <section className="surface monitors-surface" aria-labelledby="monitor-heading"><div className="surface-heading"><div><h2 id="monitor-heading">{page === 'overview' ? 'Your monitors' : 'All monitors'} <span className="heading-count">{summary.total}</span></h2><p>Current status from the latest persisted check.</p></div><div className="surface-controls"><button className="secondary-button compact-refresh" type="button" onClick={loadEndpoints} aria-label="Refresh monitors"><Icon name="refresh" size={15} /> Refresh</button></div></div>
              {loading ? <MonitorSkeleton /> : <MonitorTable endpoints={endpoints} checksByEndpoint={checksByEndpoint} expandedEndpointId={expandedEndpointId} checkingId={checkingId} deletingId={deletingId} historyLoadingId={historyLoadingId} error={pageError} onRetry={loadEndpoints} onCheck={runCheck} onDelete={(endpoint) => { setDeleteTarget(endpoint); setDeleteError(''); }} onHistory={toggleHistory} />}
            </section>
            <aside className="activity-column"><section className="surface activity-surface"><div className="surface-heading activity-heading"><div><h2>Recent incidents</h2><p>From endpoint incident history.</p></div><button className="text-button" type="button" onClick={() => setPage('incidents')}>View all</button></div>
                {incidentFeed.length ? <div className="activity-list">{incidentFeed.slice(0, 5).map((incident) => <div className="activity-item" key={incident.id}><span className={`activity-dot ${incident.resolvedAt ? 'activity-resolved' : ''}`} /><div><strong>{incident.endpointName}</strong><p>{incident.resolvedAt ? 'Incident resolved' : 'Incident open'} · {relativeDate(incident.resolvedAt || incident.openedAt)}</p></div></div>)}</div> : <div className="activity-empty"><span className="activity-empty-icon"><Icon name="incidents" size={16} /></span><p>No incident activity to show.</p></div>}
              </section><section className="worker-note"><span className="worker-note-icon"><Icon name="pulse" size={17} /></span><div><strong>Monitoring status</strong><p>Scheduled checks run while the worker process is running. Manual checks are available at any time.</p></div></section>
            </aside>
          </div>
          <LatencyPanel
            endpoints={endpoints}
            selectedEndpointId={selectedLatencyEndpointId}
            onSelectEndpoint={setSelectedLatencyEndpointId}
            checks={latencyChecks}
            loading={latencyLoading}
            refreshing={latencyRefreshing}
            error={latencyError}
            onRefresh={refreshLatencyHistory}
          />
        </>}
        <footer className="page-footer"><span>PulseCheck <span className="footer-separator">·</span> API monitoring</span><span>Checks and incidents persisted in PostgreSQL</span></footer>
      </div>
    </main>
    {formOpen && <AddMonitorDialog form={form} setForm={setForm} formError={formError} saving={saving} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} />}
    {deleteTarget && <DeleteMonitorDialog endpoint={deleteTarget} busy={deletingId === deleteTarget.id} error={deleteError} onCancel={closeDeleteDialog} onConfirm={handleDeleteMonitor} />}
  </div>;
}
