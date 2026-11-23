import { useRef, useState } from 'react';
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

const passwordHint = 'Use at least 12 characters.';

function Field({ name, label, error, hint, children, ...inputProps }) {
  const id = `auth-${name}`;
  const description = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input-wrap">
        <input
          id={id}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={description || undefined}
          {...inputProps}
        />
        {children}
      </div>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <small id={`${id}-error`} className="auth-field-error">
          {error}
        </small>
      )}
    </div>
  );
}

export function SignIn({ onAuthenticate, serviceError = '' }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null);
  const isSignup = mode === 'signup';

  function changeMode(nextMode) {
    if (busy || nextMode === mode) return;
    setMode(nextMode);
    setForm((current) => ({ ...current, password: '' }));
    setVisiblePassword(false);
    setErrors({});
    setError(null);
  }

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setError(null);
  }

  function showFieldErrors(nextErrors) {
    setErrors(nextErrors);
    const first = Object.keys(nextErrors)[0];
    if (first) formRef.current?.elements.namedItem(first)?.focus();
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const { name, email, password } = form;
    const credentials = { name: name.trim(), email: email.trim(), password };
    const nextErrors = {};
    if (isSignup && !credentials.name) nextErrors.name = 'Enter your name.';
    if (!credentials.email || event.currentTarget.elements.email.validity.typeMismatch) {
      nextErrors.email = 'Enter a valid email address.';
    }
    if (!password) nextErrors.password = 'Enter your password.';
    else if (isSignup && password.length < 12) nextErrors.password = passwordHint;
    setError(null);
    if (Object.keys(nextErrors).length) {
      showFieldErrors(nextErrors);
      return;
    }

    setBusy(true);
    setErrors({});
    try {
      await onAuthenticate(mode, credentials);
    } catch (authError) {
      const fields = Object.fromEntries(
        (Array.isArray(authError.details) ? authError.details : [])
          .filter(({ path }) => ['name', 'email', 'password'].includes(path))
          .map(({ path, message }) => [path, message])
      );
      setErrors(fields);
      setError(authError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <header className="auth-header">
        <Brand href="#signin" />
      </header>
      <main className="auth-layout">
        <section id="signin" className="auth-form-side" aria-labelledby="auth-form-heading">
          <div className="auth-form-wrap">
            <div className="auth-mode" role="group" aria-label="Account access">
              <button
                type="button"
                aria-pressed={!isSignup}
                disabled={busy}
                onClick={() => changeMode('login')}
              >
                Sign in
              </button>
              <button
                type="button"
                aria-pressed={isSignup}
                disabled={busy}
                onClick={() => changeMode('signup')}
              >
                Sign up
              </button>
            </div>
            <h2 id="auth-form-heading">{isSignup ? 'Create your account' : 'Welcome back'}</h2>
            <p className="auth-subtitle">
              {isSignup ? 'Start monitoring your endpoints.' : 'Sign in to your monitoring workspace.'}
            </p>
            {(error || serviceError) && (
              <div className="auth-error" role="alert">
                {error?.message ?? serviceError}
                {error?.code === 'EMAIL_IN_USE' && (
                  <button type="button" onClick={() => changeMode('login')}>
                    Sign in instead
                  </button>
                )}
              </div>
            )}
            <form ref={formRef} className="auth-form" onSubmit={submit} noValidate>
              <fieldset disabled={busy}>
                {isSignup && (
                  <Field
                    name="name"
                    label="Your name"
                    autoComplete="name"
                    maxLength={100}
                    required
                    error={errors.name}
                    value={form.name}
                    onChange={updateField}
                  />
                )}
                <Field
                  name="email"
                  label="Email address"
                  type="email"
                  autoComplete="username"
                  maxLength={320}
                  required
                  error={errors.email}
                  value={form.email}
                  onChange={updateField}
                />
                <Field
                  name="password"
                  label="Password"
                  type={visiblePassword ? 'text' : 'password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  minLength={isSignup ? 12 : undefined}
                  maxLength={128}
                  required
                  hint={isSignup && errors.password !== passwordHint ? passwordHint : undefined}
                  error={errors.password}
                  value={form.password}
                  onChange={updateField}
                >
                  <button
                    className="auth-password-toggle"
                    type="button"
                    aria-pressed={visiblePassword}
                    aria-controls="auth-password"
                    onClick={() => setVisiblePassword((current) => !current)}
                  >
                    {visiblePassword ? 'Hide' : 'Show'}
                    <span className="sr-only"> password</span>
                  </button>
                </Field>
                <button className="primary-button auth-submit" type="submit" disabled={busy}>
                  {busy && <span className="button-spinner" aria-hidden="true" />}
                  {busy
                    ? isSignup
                      ? 'Creating account…'
                      : 'Signing in…'
                    : isSignup
                      ? 'Create account'
                      : 'Sign in'}
                </button>
              </fieldset>
              <span className="sr-only" role="status">
                {busy ? (isSignup ? 'Creating account' : 'Signing in') : ''}
              </span>
            </form>
          </div>
        </section>
        <AuthStory />
      </main>
    </div>
  );
}
