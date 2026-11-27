import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

export function getUserInitials(name) {
  if (typeof name !== 'string') return '';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0][0].toUpperCase();
  return `${words[0][0]}${words.at(-1)[0]}`.toUpperCase();
}

function formatSchedulerSummary(scheduling) {
  if (!scheduling) return 'Loading…';
  const seconds = scheduling.minIntervalSeconds;
  if (scheduling.mode === 'cron') {
    const label = seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
    return `Hosted (~${label})`;
  }
  return `Worker (${seconds}s min)`;
}

export function ProfileMenu({
  user,
  monitorCount = 0,
  maxEndpointsPerUser = null,
  scheduling = null,
  signingOut = false,
  onLogout,
  defaultOpen = false
}) {
  const [open, setOpen] = useState(defaultOpen);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = useId();
  const displayName = user?.name?.trim() || 'Account';
  const initials = getUserInitials(user?.name);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function handleSignOutClick() {
    if (signingOut) return;
    setOpen(false);
    onLogout?.();
  }

  return (
    <div className="profile-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        className={`profile-trigger ${open ? 'profile-trigger-open' : ''}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={user?.name?.trim() ? `Account menu for ${displayName}` : 'Account menu'}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="profile-avatar" aria-hidden="true">
          {initials || <Icon name="user" size={16} />}
        </span>
        <span className="profile-chevron" aria-hidden="true">
          <Icon name="chevron" size={15} />
        </span>
      </button>
      {open && (
        <div id={menuId} className="profile-popover" role="menu" aria-label="Account details">
          <div className="profile-card">
            <span className="profile-avatar profile-avatar-lg" aria-hidden="true">
              {initials || <Icon name="user" size={18} />}
            </span>
            <div className="profile-identity">
              <strong>{displayName}</strong>
              {user?.email && <span>{user.email}</span>}
            </div>
            <span className="profile-badge">Active</span>
          </div>
          <dl className="profile-meta">
            <div>
              <dt>Monitors</dt>
              <dd>{maxEndpointsPerUser == null ? monitorCount : `${monitorCount} / ${maxEndpointsPerUser}`}</dd>
            </div>
            <div>
              <dt>Manual checks</dt>
              <dd>20 / hr · 30s cooldown</dd>
            </div>
            <div>
              <dt>Scheduler</dt>
              <dd>{formatSchedulerSummary(scheduling)}</dd>
            </div>
          </dl>
          <div className="profile-actions">
            <button
              className="profile-signout"
              type="button"
              role="menuitem"
              disabled={signingOut}
              onClick={handleSignOutClick}
            >
              {signingOut ? <span className="button-spinner" /> : <Icon name="logout" size={16} />}
              <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
