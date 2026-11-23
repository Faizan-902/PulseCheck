import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api.js';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [csrfToken, setCsrfToken] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest('/auth/me')
      .then((data) => {
        if (active) {
          setUser(data.user);
          setCsrfToken(data.csrfToken);
        }
      })
      .catch((error) => {
        if (active && error.status !== 401) setAuthError(error.message);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function authenticate(mode, credentials) {
    const body =
      mode === 'signup' ? credentials : { email: credentials.email, password: credentials.password };
    const data = await apiRequest(`/auth/${mode === 'signup' ? 'signup' : 'login'}`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    setUser(data.user);
    setCsrfToken(data.csrfToken);
    setAuthError('');
  }

  async function logout() {
    await apiRequest('/auth/logout', { method: 'POST' }, csrfToken);
    setUser(null);
    setCsrfToken('');
  }

  return { user, csrfToken, authLoading, authError, authenticate, logout };
}
