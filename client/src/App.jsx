import { useState } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useEndpoints } from './hooks/useEndpoints.js';
import { useIncidentFeed } from './hooks/useIncidentFeed.js';
import { Dashboard } from './views/Dashboard.jsx';
import { Home } from './views/Home.jsx';
import { usePublicPage } from './hooks/usePublicPage.js';
import { SignIn } from './views/SignIn.jsx';

export default function App() {
  const [page, setPage] = useState('overview');
  const [pageError, setPageError] = useState('');
  const [pageErrorAction, setPageErrorAction] = useState(null);
  const [notice, setNotice] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const auth = useAuth();
  const publicPage = usePublicPage();
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
  const incidents = useIncidentFeed({
    enabled: Boolean(auth.user && auth.csrfToken),
    page,
    csrfToken: auth.csrfToken,
    setPageError
  });

  async function handleAuthenticate(mode, credentials) {
    await auth.authenticate(mode, credentials);
    monitors.resetPolicy();
    setPage('overview');
    messages.clearPageError();
    messages.dismissNotice();
  }

  async function handleLogout() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await auth.logout();
      window.location.hash = 'home';
      setPage('overview');
      monitors.clearMonitors();
      incidents.clear();
      messages.clearPageError();
      messages.dismissNotice();
    } catch (error) {
      setPageError(error.message);
      setPageErrorAction({ label: 'Retry sign out', run: handleLogout });
    } finally {
      setSigningOut(false);
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
    return publicPage === 'home' ? (
      <Home />
    ) : (
      <SignIn
        key={publicPage}
        initialMode={publicPage === 'signup' ? 'signup' : 'login'}
        onAuthenticate={handleAuthenticate}
        serviceError={auth.authError}
      />
    );
  }
  return (
    <Dashboard
      page={page}
      setPage={setPage}
      user={auth.user}
      signingOut={signingOut}
      handleLogout={handleLogout}
      messages={messages}
      monitors={monitors}
      incidents={incidents}
    />
  );
}
