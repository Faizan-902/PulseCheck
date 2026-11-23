import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api.js';

export function useLatencyHistory({ page, endpoints, csrfToken }) {
  const [selectedLatencyEndpointId, setSelectedLatencyEndpointId] = useState('');
  const [latencyChecks, setLatencyChecks] = useState([]);
  const [latencyLoading, setLatencyLoading] = useState(false);
  const [latencyRefreshing, setLatencyRefreshing] = useState(false);
  const [latencyError, setLatencyError] = useState('');
  const [latencyRefreshToken, setLatencyRefreshToken] = useState(0);

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
        if (active) {
          setLatencyChecks(checks);
          setLatencyError('');
        }
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

  const refreshLatencyHistory = useCallback(() => {
    setLatencyRefreshToken((current) => current + 1);
  }, []);

  function clearForMonitor(id) {
    setSelectedLatencyEndpointId((current) => (current === id ? '' : current));
    setLatencyChecks([]);
  }

  return {
    panel: {
      selectedEndpointId: selectedLatencyEndpointId,
      onSelectEndpoint: setSelectedLatencyEndpointId,
      checks: latencyChecks,
      loading: latencyLoading,
      refreshing: latencyRefreshing,
      error: latencyError,
      onRefresh: refreshLatencyHistory
    },
    clearForMonitor
  };
}
