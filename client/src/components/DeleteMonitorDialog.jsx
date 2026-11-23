import { useEffect, useRef } from 'react';
import { Icon } from './Icon.jsx';

export function DeleteMonitorDialog({ endpoint, busy, error, onCancel, onConfirm }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const previousFocus = document.activeElement;
    cancelRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCancel();
      }
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll('button:not(:disabled)') || [];
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
  }, [onCancel]);

  return (
    <div
      className="dialog-backdrop delete-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="add-dialog delete-dialog"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        tabIndex="-1"
      >
        <div className="dialog-heading">
          <div>
            <span className="dialog-icon delete-dialog-icon">
              <Icon name="incidents" />
            </span>
            <div>
              <p className="eyebrow">REMOVE MONITOR</p>
              <h2 id="delete-dialog-title">Delete {endpoint.name}?</h2>
            </div>
          </div>
        </div>
        <p id="delete-dialog-description" className="dialog-copy">
          This permanently deletes the monitor, its saved check history, and its incidents. An
          in-progress scheduled check will be discarded safely.
        </p>
        {error && (
          <p className="form-error delete-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            className="secondary-button"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="danger-button" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? (
              <>
                <span className="button-spinner" />
                Deleting…
              </>
            ) : (
              'Delete monitor'
            )}
          </button>
        </div>
      </section>
    </div>
  );
}
