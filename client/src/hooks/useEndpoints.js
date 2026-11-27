import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../lib/api.js';
import { deleteMonitorAndReconcile } from '../monitor-deletion.js';
import { nextCooldownUntil, remainingCooldownSeconds } from './check-cooldown.js';
import { useLatencyHistory } from './useLatencyHistory.js';

function emptyMonitorForm(scheduling) {
  return {
    name: '',
    url: '',
    timeoutMs: '5000',
    checkIntervalSeconds: String(scheduling.defaultIntervalSeconds)
  };
}

export function useEndpoints({ user, authLoading, csrfToken, page, messages }) {
  const { setPageError, setPageErrorAction, setNotice } = messages;
  const [endpoints, setEndpoints] = useState([]);
  const [checksByEndpoint, setChecksByEndpoint] = useState({});
  const [expandedEndpointId, setExpandedEndpointId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState(null);
  const [checkError, setCheckError] = useState(null);
  const [cooldownUntilByEndpoint, setCooldownUntilByEndpoint] = useState({});
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
  const [deletingId, setDeletingId] = useState(null);
  const [historyLoadingId, setHistoryLoadingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [scheduling, setScheduling] = useState(null);
  const [maxEndpointsPerUser, setMaxEndpointsPerUser] = useState(null);
  const [form, setForm] = useState(null);
  const loadRequestIdRef = useRef(0);

  const loadEndpoints = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    if (!user) {
      setEndpoints([]);
      setLoading(false);
      return false;
    }
    setPageError('');
    setPageErrorAction(null);
    try {
      const { data, meta } = await apiRequest('/endpoints', {}, csrfToken, true);
      if (loadRequestIdRef.current !== requestId) return false;
      setScheduling(meta.scheduling);
      setMaxEndpointsPerUser(meta.maxEndpointsPerUser);
      setEndpoints(data);
      return true;
    } catch (error) {
      if (loadRequestIdRef.current !== requestId) return false;
      setPageError(error.message);
      setPageErrorAction({ label: 'Retry monitor list', run: () => loadEndpoints() });
      return false;
    } finally {
      if (loadRequestIdRef.current === requestId) setLoading(false);
    }
  }, [user, csrfToken, setPageError, setPageErrorAction]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setEndpoints([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadEndpoints();
  }, [authLoading, user, loadEndpoints]);

  const latency = useLatencyHistory({
    enabled: Boolean(user && csrfToken),
    page,
    endpoints,
    csrfToken
  });

  const hasActiveCooldown = useMemo(
    () => Object.values(cooldownUntilByEndpoint).some((until) => until > cooldownNow),
    [cooldownUntilByEndpoint, cooldownNow]
  );

  useEffect(() => {
    if (!hasActiveCooldown) return undefined;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setCooldownNow(now);
      setCooldownUntilByEndpoint((current) => {
        const nextEntries = Object.entries(current).filter(([, until]) => until > now);
        return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
      });
      setCheckError((current) => {
        if (!current?.isCooldown) return current;
        const until = cooldownUntilByEndpoint[current.endpointId];
        return until && until > now ? current : null;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveCooldown, cooldownUntilByEndpoint]);

  const cooldownSecondsByEndpoint = useMemo(() => {
    const next = {};
    for (const [id, until] of Object.entries(cooldownUntilByEndpoint)) {
      const seconds = remainingCooldownSeconds(until, cooldownNow);
      if (seconds > 0) next[id] = seconds;
    }
    return next;
  }, [cooldownUntilByEndpoint, cooldownNow]);

  const summary = useMemo(
    () => ({
      total: endpoints.length,
      up: endpoints.filter((endpoint) => endpoint.latestStatus === 'UP').length,
      down: endpoints.filter((endpoint) => endpoint.latestStatus === 'DOWN').length,
      unchecked: endpoints.filter((endpoint) => !endpoint.latestStatus).length
    }),
    [endpoints]
  );

  const recentIncidents = useMemo(
    () =>
      endpoints
        .flatMap((endpoint) =>
          (endpoint.recentIncidents ?? []).map((incident) => ({
            ...incident,
            endpointName: endpoint.name
          }))
        )
        .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt) || b.id.localeCompare(a.id))
        .slice(0, 5),
    [endpoints]
  );
  const hasOpenIncidents = endpoints.some((endpoint) => endpoint.open_incident_count > 0);

  const loadHistory = useCallback(
    async (endpointId) => {
      setHistoryLoadingId(endpointId);
      setChecksByEndpoint((current) => ({
        ...current,
        [endpointId]: { ...current[endpointId], checks: current[endpointId]?.checks || [], error: '' }
      }));
      try {
        const [checks, incidents] = await Promise.all([
          apiRequest(`/endpoints/${endpointId}/checks?limit=20`, {}, csrfToken),
          apiRequest(`/endpoints/${endpointId}/incidents`, {}, csrfToken)
        ]);
        setChecksByEndpoint((current) => ({
          ...current,
          [endpointId]: { checks, incidents, error: '' }
        }));
      } catch (error) {
        setChecksByEndpoint((current) => ({
          ...current,
          [endpointId]: { ...current[endpointId], checks: [], error: error.message }
        }));
      } finally {
        setHistoryLoadingId((current) => (current === endpointId ? null : current));
      }
    },
    [csrfToken]
  );

  const closeDeleteDialog = useCallback(() => {
    setDeleteTarget(null);
    setDeleteError('');
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      await apiRequest(
        '/endpoints',
        {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            url: form.url,
            timeoutMs: Number(form.timeoutMs),
            checkIntervalSeconds: Number(form.checkIntervalSeconds)
          })
        },
        csrfToken
      );
      setFormOpen(false);
      setNotice('Monitor added. Run a check to record its first result.');
      await loadEndpoints();
    } catch (error) {
      setFormError(
        error.details?.find(({ path }) => path === 'checkIntervalSeconds')?.message || error.message
      );
      if (error.code === 'endpoint_limit_reached') await loadEndpoints();
    } finally {
      setSaving(false);
    }
  }

  async function runCheck(endpoint) {
    const now = Date.now();
    if (checkingId === endpoint.id || remainingCooldownSeconds(cooldownUntilByEndpoint[endpoint.id], now) > 0) {
      return;
    }
    setCheckingId(endpoint.id);
    setCheckError(null);
    setPageError('');
    setPageErrorAction(null);
    setNotice('');
    try {
      const check = await apiRequest(`/endpoints/${endpoint.id}/check`, { method: 'POST' }, csrfToken);
      const completedAt = Date.now();
      setCooldownNow(completedAt);
      setCooldownUntilByEndpoint((current) => ({
        ...current,
        [endpoint.id]: nextCooldownUntil({ currentUntil: current[endpoint.id], now: completedAt })
      }));
      latency.showSavedCheck(endpoint.id, check);
      const httpStatus = check.httpStatus ? ` · HTTP ${check.httpStatus}` : '';
      setNotice(`${endpoint.name}: ${check.status}${httpStatus} · ${check.latencyMs} ms`);
      await loadEndpoints();
      if (expandedEndpointId === endpoint.id) await loadHistory(endpoint.id);
    } catch (error) {
      if ([403, 429].includes(error.status)) {
        const failedAt = Date.now();
        const isPerMonitorCooldown = error.status === 429
          && Number.isFinite(error.retryAfterSeconds)
          && error.retryAfterSeconds > 0
          && error.retryAfterSeconds <= 30;
        if (isPerMonitorCooldown) {
          setCooldownNow(failedAt);
          setCooldownUntilByEndpoint((current) => ({
            ...current,
            [endpoint.id]: nextCooldownUntil({
              currentUntil: current[endpoint.id],
              retryAfterSeconds: error.retryAfterSeconds,
              now: failedAt
            })
          }));
        }
        setCheckError({ endpointId: endpoint.id, message: error.message, isCooldown: isPerMonitorCooldown });
      } else {
        setPageError(error.message);
        setPageErrorAction({ label: 'Retry check', run: () => runCheck(endpoint) });
      }
    } finally {
      setCheckingId(null);
    }
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
      else if (result.status === 'deleted')
        setEndpoints((current) => current.filter((endpoint) => endpoint.id !== target.id));

      if (result.status === 'not-found') {
        setDeleteError(
          endpoints.some((endpoint) => endpoint.id === target.id)
            ? 'The API returned 404, but this monitor still appears in the refreshed list. Refresh the list and try again.'
            : 'This monitor is not in your current monitor list. It may be stale or belong to another account.'
        );
        return;
      }
      if (result.status === 'unverified') {
        const message =
          'The API returned 404, and the monitor list could not be refreshed to verify its state.';
        setDeleteError(`${message} ${result.refreshError.message}`);
        return;
      }

      latency.clearForMonitor(target.id);
      setCooldownUntilByEndpoint((current) => {
        if (!(target.id in current)) return current;
        const next = { ...current };
        delete next[target.id];
        return next;
      });
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
      setNotice(
        result.status === 'already-absent'
          ? `${target.name} was already absent; the monitor list is now up to date.`
          : result.refreshError
            ? `${target.name} was deleted, but the monitor list refresh failed. Use Refresh to reload it.`
            : `${target.name} and its saved check history were deleted.`
      );
      if (result.refreshError) {
        setPageError(result.refreshError.message);
        setPageErrorAction({ label: 'Retry monitor list', run: () => loadEndpoints() });
      }
    } catch (error) {
      setDeleteError(
        `Could not confirm deletion. Refresh monitors to verify its current state. ${error.message}`
      );
    } finally {
      setDeletingId(null);
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

  function openForm() {
    setFormError('');
    setForm(emptyMonitorForm(scheduling));
    setFormOpen(true);
  }

  function openDeleteDialog(endpoint) {
    setDeleteTarget(endpoint);
    setDeleteError('');
  }

  function resetPolicy() {
    setScheduling(null);
    setMaxEndpointsPerUser(null);
    setCheckError(null);
  }

  function clearMonitors() {
    loadRequestIdRef.current += 1;
    setEndpoints([]);
    setChecksByEndpoint({});
    setExpandedEndpointId(null);
    setCheckingId(null);
    setCheckError(null);
    setCooldownUntilByEndpoint({});
    setDeletingId(null);
    setHistoryLoadingId(null);
    setDeleteTarget(null);
    setDeleteError('');
    setFormOpen(false);
    setFormError('');
    setForm(null);
  }

  return {
    endpoints,
    checksByEndpoint,
    expandedEndpointId,
    loading,
    saving,
    checkingId,
    checkError,
    cooldownSecondsByEndpoint,
    deletingId,
    historyLoadingId,
    deleteTarget,
    deleteError,
    formOpen,
    formError,
    scheduling,
    maxEndpointsPerUser,
    form,
    setForm,
    summary,
    recentIncidents,
    hasOpenIncidents,
    loadEndpoints,
    openForm,
    closeForm: () => setFormOpen(false),
    openDeleteDialog,
    closeDeleteDialog,
    handleSubmit,
    runCheck,
    handleDeleteMonitor,
    toggleHistory,
    resetPolicy,
    clearMonitors,
    latency: latency.panel
  };
}
