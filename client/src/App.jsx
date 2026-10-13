import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload.data;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function StatusBadge({ status }) {
  const label = status || 'NOT CHECKED';
  const style = status === 'UP' ? 'up' : status === 'DOWN' ? 'down' : 'unknown';
  return <span className={`status-badge status-${style}`}><span className="status-dot" />{label}</span>;
}

function CheckHistory({ checks, loading, error }) {
  if (loading) return <p className="history-message">Loading check history…</p>;
  if (error) return <p className="history-message history-error">{error}</p>;
  if (!checks.length) return <p className="history-message">No checks have been recorded yet.</p>;

  return (
    <div className="history-table-wrap">
      <table className="history-table">
        <thead>
          <tr><th>Checked</th><th>Result</th><th>HTTP</th><th>Latency</th><th>Details</th></tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.id}>
              <td>{formatDate(check.checkedAt)}</td>
              <td><StatusBadge status={check.status} /></td>
              <td>{check.httpStatus ?? '—'}</td>
              <td>{check.latencyMs} ms</td>
              <td>{check.errorType || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [endpoints, setEndpoints] = useState([]);
  const [checksByEndpoint, setChecksByEndpoint] = useState({});
  const [expandedEndpointId, setExpandedEndpointId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState(null);
  const [historyLoadingId, setHistoryLoadingId] = useState(null);
  const [formError, setFormError] = useState('');
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ name: '', url: '', timeoutMs: '5000' });

  const loadEndpoints = useCallback(async () => {
    setPageError('');
    try {
      const data = await apiRequest('/endpoints');
      setEndpoints(data);
    } catch (error) {
      setPageError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEndpoints(); }, [loadEndpoints]);

  const summary = useMemo(() => ({
    total: endpoints.length,
    up: endpoints.filter((endpoint) => endpoint.latestStatus === 'UP').length,
    down: endpoints.filter((endpoint) => endpoint.latestStatus === 'DOWN').length
  }), [endpoints]);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    setNotice('');
    setSaving(true);
    try {
      await apiRequest('/endpoints', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          url: form.url,
          timeoutMs: Number(form.timeoutMs)
        })
      });
      setForm({ name: '', url: '', timeoutMs: '5000' });
      setNotice('Endpoint registered. Run a check when you are ready.');
      await loadEndpoints();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function runCheck(endpoint) {
    setCheckingId(endpoint.id);
    setNotice('');
    try {
      const check = await apiRequest(`/endpoints/${endpoint.id}/check`, { method: 'POST' });
      setNotice(`${endpoint.name}: ${check.status}${check.httpStatus ? ` · HTTP ${check.httpStatus}` : ''} · ${check.latencyMs} ms`);
      await loadEndpoints();
      if (expandedEndpointId === endpoint.id) await loadHistory(endpoint.id);
    } catch (error) {
      setPageError(error.message);
    } finally {
      setCheckingId(null);
    }
  }

  async function loadHistory(endpointId) {
    setHistoryLoadingId(endpointId);
    setChecksByEndpoint((current) => ({ ...current, [endpointId]: { checks: current[endpointId]?.checks || [], error: '' } }));
    try {
      const checks = await apiRequest(`/endpoints/${endpointId}/checks?limit=20`);
      setChecksByEndpoint((current) => ({ ...current, [endpointId]: { checks, error: '' } }));
    } catch (error) {
      setChecksByEndpoint((current) => ({ ...current, [endpointId]: { checks: [], error: error.message } }));
    } finally {
      setHistoryLoadingId(null);
    }
  }

  async function toggleHistory(endpointId) {
    if (expandedEndpointId === endpointId) {
      setExpandedEndpointId(null);
      return;
    }
    setExpandedEndpointId(endpointId);
    await loadHistory(endpointId);
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="PulseCheck home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>pulsecheck</span>
        </a>
        <span className="day-label"><span className="live-dot" /> MANUAL MONITORING</span>
      </header>

      <section className="intro" id="top">
        <div>
          <p className="eyebrow">YOUR API STATUS, AT A GLANCE</p>
          <h1>Endpoint monitor</h1>
          <p className="intro-copy">Register an endpoint and run a check whenever you need a quick signal.</p>
        </div>
        <div className="summary-card" aria-label="Endpoint summary">
          <div><strong>{summary.total}</strong><span>Endpoints</span></div>
          <div><strong className="summary-up">{summary.up}</strong><span>Up</span></div>
          <div><strong className="summary-down">{summary.down}</strong><span>Down</span></div>
        </div>
      </section>

      <div className="content-grid">
        <section className="panel register-panel" aria-labelledby="register-title">
          <div className="panel-heading">
            <div className="section-icon" aria-hidden="true">＋</div>
            <div><p className="eyebrow">GET STARTED</p><h2 id="register-title">Register endpoint</h2></div>
          </div>
          <form onSubmit={handleSubmit} className="endpoint-form">
            <label>
              <span>Display name</span>
              <input
                autoComplete="off"
                maxLength={100}
                placeholder="Payments API"
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label>
              <span>Endpoint URL</span>
              <input
                autoComplete="url"
                placeholder="https://api.example.com/health"
                required
                type="url"
                value={form.url}
                onChange={(event) => setForm({ ...form, url: event.target.value })}
              />
            </label>
            <label>
              <span>Timeout <small>(100–30,000 ms)</small></span>
              <input
                inputMode="numeric"
                max="30000"
                min="100"
                required
                type="number"
                value={form.timeoutMs}
                onChange={(event) => setForm({ ...form, timeoutMs: event.target.value })}
              />
            </label>
            {formError && <p className="inline-error" role="alert">{formError}</p>}
            {notice && <p className="inline-notice" role="status">{notice}</p>}
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Registering…' : 'Add endpoint'} <span aria-hidden="true">↗</span>
            </button>
            <p className="form-hint">Only public HTTP and HTTPS endpoints can be monitored.</p>
          </form>
        </section>

        <section className="endpoints-section" aria-labelledby="endpoints-title">
          <div className="list-heading">
            <div><p className="eyebrow">MONITORING</p><h2 id="endpoints-title">Your endpoints <span>{summary.total}</span></h2></div>
            <button className="refresh-button" onClick={loadEndpoints} type="button" aria-label="Refresh endpoint list">↻</button>
          </div>

          {pageError && <div className="page-error" role="alert">{pageError}<button onClick={loadEndpoints} type="button">Retry</button></div>}
          {loading ? (
            <div className="empty-state"><span className="spinner" /><p>Loading endpoints…</p></div>
          ) : endpoints.length === 0 ? (
            <div className="empty-state">
              <div className="empty-illustration" aria-hidden="true"><span>↗</span></div>
              <h3>No endpoints yet</h3>
              <p>Add your first public API endpoint to start checking its availability.</p>
            </div>
          ) : (
            <div className="endpoint-list">
              {endpoints.map((endpoint) => {
                const history = checksByEndpoint[endpoint.id] || { checks: [], error: '' };
                const isExpanded = expandedEndpointId === endpoint.id;
                return (
                  <article className={`endpoint-card ${isExpanded ? 'is-expanded' : ''}`} key={endpoint.id}>
                    <div className="endpoint-main">
                      <div className="endpoint-info">
                        <div className="endpoint-title-line"><h3>{endpoint.name}</h3><StatusBadge status={endpoint.latestStatus} /></div>
                        <a className="endpoint-url" href={endpoint.url} target="_blank" rel="noreferrer">{endpoint.url}</a>
                        <div className="endpoint-meta">
                          <span>{endpoint.latestLatencyMs == null ? 'No latency yet' : `${endpoint.latestLatencyMs} ms`}</span>
                          <span className="meta-divider" />
                          <span>{endpoint.latestHttpStatus ? `HTTP ${endpoint.latestHttpStatus}` : 'No response yet'}</span>
                          <span className="meta-divider" />
                          <span>{endpoint.latestCheckedAt ? `Checked ${formatDate(endpoint.latestCheckedAt)}` : 'Never checked'}</span>
                        </div>
                      </div>
                      <div className="endpoint-actions">
                        <button className="check-button" disabled={checkingId === endpoint.id} onClick={() => runCheck(endpoint)} type="button">
                          {checkingId === endpoint.id ? <><span className="button-spinner" /> Checking</> : <><span aria-hidden="true">▶</span> Check now</>}
                        </button>
                        <button className="history-button" aria-expanded={isExpanded} onClick={() => toggleHistory(endpoint.id)} type="button">
                          {isExpanded ? 'Hide history' : 'History'} <span aria-hidden="true">{isExpanded ? '⌃' : '⌄'}</span>
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="history-panel">
                        <div className="history-heading"><h4>Recent checks</h4><span>Last 20 results</span></div>
                        <CheckHistory checks={history.checks} error={history.error} loading={historyLoadingId === endpoint.id} />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {summary.down > 0 && <p className="down-summary">{summary.down} endpoint{summary.down === 1 ? '' : 's'} returned a server error or could not be reached.</p>}
        </section>
      </div>
      <footer className="page-footer"><span>PulseCheck</span><span>Manual checks · Results saved to PostgreSQL</span></footer>
    </main>
  );
}
