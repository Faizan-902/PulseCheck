import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api.js';
import {
  shouldClearLatencyOnMonitorDelete,
  shouldFetchLatencyHistory
} from './fetch-guards.js';

export function useLatencyHistory({ enabled, page, endpoints, csrfToken }) {
  const [selectedLatencyEndpointId, setSelectedLatencyEndpointId] = useState('');
  const [latencyChecks, setLatencyChecks] = useState([]);
  const [latencyLoading, setLatencyLoading] = useState(false);
  const [latencyRefreshing, setLatencyRefreshing] = useState(false);
  const [latencyError, setLatencyError] = useState('');
  const [latencyRefreshToken, setLatencyRefreshToken] = useState(0);
  const shouldFetch = shouldFetchLatencyHistory({
    enabled,
    page,
    selectedEndpointId: selectedLatencyEndpointId
  });

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
    if (!shouldFetch) {
      setLatencyLoading(false);
      setLatencyRefreshing(false);
      if (!enabled || !selectedLatencyEndpointId) {
        setLatencyChecks([]);
        setLatencyError('');
      }
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
  }, [shouldFetch, selectedLatencyEndpointId, csrfToken, latencyRefreshToken]);

  const refreshLatencyHistory = useCallback(() => {
    setLatencyRefreshToken((current) => current + 1);
  }, []);

  function showSavedCheck(endpointId, check) {
    if (selectedLatencyEndpointId === endpointId) {
      setLatencyChecks((current) =>
        [check, ...current.filter((item) => item.id !== check.id)].slice(0, 100)
      );
      setLatencyError('');
      refreshLatencyHistory();
    } else {
      setSelectedLatencyEndpointId(endpointId);
    }
  }

  function clearForMonitor(id) {
    if (!shouldClearLatencyOnMonitorDelete({ selectedEndpointId: selectedLatencyEndpointId, deletedEndpointId: id })) {
      return;
    }
    setSelectedLatencyEndpointId('');
    setLatencyChecks([]);
    setLatencyError('');
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
    clearForMonitor,
    showSavedCheck
  };
}
