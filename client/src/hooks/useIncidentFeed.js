import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api.js';

export function useIncidentFeed({ page, csrfToken, setPageError }) {
  const [incidentFeed, setIncidentFeed] = useState([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);

  useEffect(() => {
    if (page !== 'incidents') return undefined;
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
  }, [page, csrfToken, setPageError]);

  return { feed: incidentFeed, loading: incidentsLoading, clear: () => setIncidentFeed([]) };
}
