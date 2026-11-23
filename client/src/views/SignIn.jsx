import { useState } from 'react';
import { Brand } from '../components/Brand.jsx';
import './auth.css';

function AuthStory() {
  return (
    <section className="auth-story" aria-labelledby="auth-hero-heading">
      <div className="auth-story-copy">
        <h1 id="auth-hero-heading">Know when your APIs need attention.</h1>
        <p>Monitor public endpoints, spot slow responses, and keep a record of what went wrong.</p>
      </div>
      <img
        className="auth-hero-image"
        src="/images/pulsecheck-glass.jpg"
        fetchPriority="high"
        width="1200"
        height="800"
        alt=""
      />
    </section>
  );
}

export function SignIn({ onAuthenticate, serviceError = '' }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onAuthenticate(mode, form);
    } catch (authError) {
      setError(authError.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <header className="auth-header">
        <Brand href="#auth-hero-heading" />
      </header>
      <main className="auth-layout">
        <AuthStory />
        <section id="signin" className="auth-form-side" aria-labelledby="auth-form-heading">
          <div className="auth-form-wrap">
            <h2 id="auth-form-heading">{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
            <p className="auth-subtitle">
              {mode === 'login'
                ? 'Sign in to continue to PulseCheck.'
                : 'Start tracking your API health in a few steps.'}
            </p>
            {serviceError && (
              <p className="auth-error" role="alert">
                {serviceError}
              </p>
            )}
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <form className="auth-form" onSubmit={submit}>
              {mode === 'signup' && (
                <label>
                  <span>Your name</span>
                  <input
                    autoComplete="name"
                    maxLength={100}
                    required
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </label>
              )}
              <label>
                <span>Email address</span>
                <input
                  autoComplete="email"
                  type="email"
                  maxLength={320}
                  required
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  type="password"
                  minLength={mode === 'signup' ? 12 : undefined}
                  maxLength={128}
                  required
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
                {mode === 'signup' && <small>Use at least 12 characters.</small>}
              </label>
              <button className="primary-button auth-submit" type="submit" disabled={busy}>
                {busy ? (
                  <>
                    <span className="button-spinner" />
                    {mode === 'login' ? 'Signing in…' : 'Creating account…'}
                  </>
                ) : mode === 'login' ? (
                  'Sign in'
                ) : (
                  'Create account'
                )}
              </button>
            </form>
            <p className="auth-switch">
              {mode === 'login' ? 'New to PulseCheck?' : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError('');
                }}
              >
                {' '}
                {mode === 'login' ? 'Create an account' : 'Sign in'}
              </button>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
