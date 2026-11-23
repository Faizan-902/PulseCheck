const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export async function apiRequest(path, options = {}, csrfToken = '', includeMetadata = false) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method || 'GET').toUpperCase()) &&
        csrfToken
          ? { 'X-CSRF-Token': csrfToken }
          : {}),
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
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }
  return includeMetadata ? payload : payload.data;
}
