import { Icon } from './Icon.jsx';

export function ErrorBanner({ message, action, onDismiss, compact = false }) {
  if (!message) return null;
  const dismiss = (
    <button type="button" onClick={onDismiss} aria-label="Dismiss error">
      <Icon name="close" size={15} />
    </button>
  );
  if (compact) {
    return (
      <div className="alert-banner" role="alert">
        {message}
        {dismiss}
      </div>
    );
  }
  return (
    <div className="alert-banner" role="alert">
      <span>{message}</span>
      <div className="alert-actions">
        {action && (
          <button type="button" onClick={action.run}>
            {action.label}
          </button>
        )}
        {dismiss}
      </div>
    </div>
  );
}

export function SuccessBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="success-banner" role="status">
      <span className="success-check">✓</span>
      {message}
      <button onClick={onDismiss} type="button" aria-label="Dismiss message">
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
