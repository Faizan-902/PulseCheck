import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api.js';
import { shouldFetchIncidentFeed } from './fetch-guards.js';

export function useIncidentFeed({ enabled, page, csrfToken, setPageError }) {
  const [incidentFeed, setIncidentFeed] = useState([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);

  useEffect(() => {
    if (!shouldFetchIncidentFeed({ enabled, page })) {
      if (!enabled) {
        setIncidentFeed([]);
        setIncidentsLoading(false);
      }
      return undefined;
    }
    const controller = new AbortController();
    setIncidentsLoading(true);
    apiRequest('/endpoints/incident-feed', { signal: controller.signal }, csrfToken)
      .then((incidents) => {
        if (!controller.signal.aborted) setIncidentFeed(incidents);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPageError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIncidentsLoading(false);
      });
    return () => controller.abort();
  }, [enabled, page, csrfToken, setPageError]);

  return { feed: incidentFeed, loading: incidentsLoading, clear: () => setIncidentFeed([]) };
}
