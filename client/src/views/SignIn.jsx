import { useState } from 'react';
import { Icon } from '../components/Icon.jsx';

function AuthStory() {
  return (
    <section className="auth-story">
      <a className="brand auth-brand" href="#signin">
        <span className="brand-mark">
          <Icon name="pulse" size={19} />
        </span>
        <span>
          pulse<span className="brand-light">check</span>
        </span>
      </a>
      <div className="auth-story-copy">
        <span className="auth-overline">
          <span className="live-dot" /> API HEALTH, CLEARLY
        </span>
        <h1>
          Know when your APIs
          <br />
          need attention.
        </h1>
        <p>
          Monitor public endpoints, run checks on demand, and keep a clear record of response health.
        </p>
        <div className="auth-preview">
          <div className="preview-heading">
            <span>HOW PULSECHECK WORKS</span>
            <span className="preview-live">
              <i /> WORKFLOW
            </span>
          </div>
          <div className="preview-line">
            <span className="preview-step">01</span>
            <span>
              <b>Register a public endpoint</b>
              <small>Set its check timeout and interval</small>
            </span>
            <span className="preview-arrow">↗</span>
          </div>
          <div className="preview-line">
            <span className="preview-step">02</span>
            <span>
              <b>Review real check results</b>
              <small>Inspect status, latency, and history</small>
            </span>
            <span className="preview-arrow">↗</span>
          </div>
          <div className="preview-foot">
            <span>Live monitor data appears after sign in.</span>
            <span>· · ·</span>
          </div>
        </div>
      </div>
      <div className="auth-story-footer">
        <span>Built for people who care about reliability.</span>
        <span>PulseCheck · API monitoring</span>
      </div>
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
    <main className="auth-shell">
      <AuthStory />
      <section className="auth-form-side">
        <div className="auth-mobile-brand">
          <a className="brand" href="#signin">
            <span className="brand-mark">
              <Icon name="pulse" size={19} />
            </span>
            <span>
              pulse<span className="brand-light">check</span>
            </span>
          </a>
        </div>
        <div className="auth-form-wrap">
          <p className="eyebrow">YOUR MONITORING WORKSPACE</p>
          <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
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
          <p className="auth-security-note">
            <span aria-hidden="true">▣</span> Sessions use HttpOnly cookies; secure transport is enabled
            in production.
          </p>
        </div>
        <div className="auth-form-footer">PulseCheck · Secure API monitoring</div>
      </section>
    </main>
  );
}
