import { useState } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useEndpoints } from './hooks/useEndpoints.js';
import { useIncidentFeed } from './hooks/useIncidentFeed.js';
import { Dashboard } from './views/Dashboard.jsx';
import { SignIn } from './views/SignIn.jsx';

export default function App() {
  const [page, setPage] = useState('overview');
  const [pageError, setPageError] = useState('');
  const [pageErrorAction, setPageErrorAction] = useState(null);
  const [notice, setNotice] = useState('');
  const auth = useAuth();
  const messages = {
    pageError,
    setPageError,
    pageErrorAction,
    setPageErrorAction,
    notice,
    setNotice,
    clearPageError() {
      setPageError('');
      setPageErrorAction(null);
    },
    dismissNotice: () => setNotice('')
  };
  const monitors = useEndpoints({
    user: auth.user,
    authLoading: auth.authLoading,
    csrfToken: auth.csrfToken,
    page,
    messages
  });
  const incidents = useIncidentFeed({ page, csrfToken: auth.csrfToken, setPageError });

  async function handleAuthenticate(mode, credentials) {
    await auth.authenticate(mode, credentials);
    monitors.resetPolicy();
    setPage('overview');
    messages.dismissNotice();
  }

  async function handleLogout() {
    try {
      await auth.logout();
      monitors.clearMonitors();
      incidents.clear();
      messages.clearPageError();
      messages.dismissNotice();
    } catch (error) {
      setPageError(error.message);
      setPageErrorAction({ label: 'Retry sign out', run: handleLogout });
    }
  }

  if (auth.authLoading) {
    return (
      <main className="auth-loading">
        <span className="spinner" />
        <p>Checking your session…</p>
      </main>
    );
  }

  if (!auth.user) {
    return <SignIn onAuthenticate={handleAuthenticate} serviceError={auth.authError} />;
  }
  return (
    <Dashboard
      page={page}
      setPage={setPage}
      handleLogout={handleLogout}
      messages={messages}
      monitors={monitors}
      incidents={incidents}
    />
  );
}
