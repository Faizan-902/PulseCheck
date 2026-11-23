import { useEffect, useRef } from 'react';
import { Icon } from './Icon.jsx';

export function AddMonitorDialog({
  form,
  setForm,
  formError,
  saving,
  scheduling,
  atMonitorLimit,
  onClose,
  onSubmit
}) {
  const dialogRef = useRef(null);
  const firstInputRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(saving);
  onCloseRef.current = onClose;
  savingRef.current = saving;

  useEffect(() => {
    const previousFocus = document.activeElement;
    firstInputRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls =
        dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled)') || [];
      if (!controls.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="add-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-dialog-title"
        tabIndex="-1"
      >
        <div className="dialog-heading">
          <div>
            <span className="dialog-icon">
              <Icon name="plus" />
            </span>
            <div>
              <p className="eyebrow">NEW MONITOR</p>
              <h2 id="add-dialog-title">Add endpoint</h2>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            disabled={saving}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="dialog-copy">
          Register an endpoint to run manual checks and collect monitoring history.
        </p>
        <form onSubmit={onSubmit} className="endpoint-form">
          <label>
            <span>Monitor name</span>
            <input
              ref={firstInputRef}
              autoComplete="off"
              maxLength={100}
              placeholder="Payments API"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            <span>Endpoint URL</span>
            <input
              autoComplete="url"
              placeholder="https://api.example.com/health"
              required
              type="url"
              value={form.url}
              onChange={(event) => setForm({ ...form, url: event.target.value })}
            />
          </label>
          <div className="form-columns">
            <label>
              <span>
                Timeout <small>100–30,000 ms</small>
              </span>
              <input
                inputMode="numeric"
                max="30000"
                min="100"
                required
                type="number"
                value={form.timeoutMs}
                onChange={(event) => setForm({ ...form, timeoutMs: event.target.value })}
              />
            </label>
            <label>
              <span>
                Interval{' '}
                <small>
                  {scheduling.minIntervalSeconds.toLocaleString()}–
                  {scheduling.maxIntervalSeconds.toLocaleString()} sec
                </small>
              </span>
              <input
                inputMode="numeric"
                max={scheduling.maxIntervalSeconds}
                min={scheduling.minIntervalSeconds}
                required
                type="number"
                value={form.checkIntervalSeconds}
                onInvalid={(event) => {
                  const input = event.currentTarget;
                  if (input.validity.rangeUnderflow)
                    input.setCustomValidity(
                      `Use an interval of at least ${scheduling.minIntervalSeconds} seconds.`
                    );
                  if (input.validity.rangeOverflow)
                    input.setCustomValidity(
                      `Use an interval of at most ${scheduling.maxIntervalSeconds} seconds.`
                    );
                }}
                onChange={(event) => {
                  event.target.setCustomValidity('');
                  setForm({ ...form, checkIntervalSeconds: event.target.value });
                }}
              />
            </label>
          </div>
          {scheduling.mode === 'cron' && (
            <p className="form-hint">
              Hosted intervals start at {scheduling.minIntervalSeconds.toLocaleString()} seconds.
              Scheduled runs can be delayed.
            </p>
          )}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <p className="form-hint">
            Only public HTTP and HTTPS destinations are allowed. The server validates the URL before
            checking it.
          </p>
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="primary-button" disabled={saving || atMonitorLimit} type="submit">
              {saving ? (
                <>
                  <span className="button-spinner" />
                  Adding monitor…
                </>
              ) : (
                <>
                  <Icon name="plus" size={16} /> Add monitor
                </>
              )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
