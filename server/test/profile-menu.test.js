import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getUserInitials, ProfileMenu } from '../../client/src/components/ProfileMenu.jsx';
import { Topbar } from '../../client/src/components/DashboardNavigation.jsx';

describe('profile menu', () => {
  it('derives clean initials from user names and handles blank names', () => {
    expect(getUserInitials('Mohd Faizan Khan')).toBe('MK');
    expect(getUserInitials('Ada Lovelace')).toBe('AL');
    expect(getUserInitials('Ada')).toBe('A');
    expect(getUserInitials('   ')).toBe('');
    expect(getUserInitials(null)).toBe('');
  });

  it('renders a top-right profile trigger with user info, limits, and sign-out inside Topbar', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Topbar, {
        page: 'overview',
        onNavigate: vi.fn(),
        hasOpenIncidents: false,
        systemTone: 'system-operational',
        systemLabel: 'All monitored endpoints up',
        canAddMonitor: true,
        atMonitorLimit: false,
        openForm: vi.fn(),
        user: { name: 'Mohd Faizan', email: 'faizan@example.com' },
        monitorCount: 3,
        maxEndpointsPerUser: 10,
        scheduling: { mode: 'worker', minIntervalSeconds: 30 },
        signingOut: false,
        handleLogout: vi.fn()
      })
    );

    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-label="Account menu for Mohd Faizan"');
    expect(markup).toContain('>MF<');
    expect(markup).not.toContain('class="signout-button"');
  });

  it('renders user details, workspace limits, and sign out when open', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProfileMenu, {
        user: { name: 'Mohd Faizan', email: 'faizan@example.com' },
        monitorCount: 3,
        maxEndpointsPerUser: 10,
        scheduling: { mode: 'cron', minIntervalSeconds: 900 },
        signingOut: false,
        onLogout: vi.fn(),
        defaultOpen: true
      })
    );

    expect(markup).toContain('Mohd Faizan');
    expect(markup).toContain('faizan@example.com');
    expect(markup).toContain('3 / 10');
    expect(markup).toContain('20 / hr · 30s cooldown');
    expect(markup).toContain('Hosted (~15 min)');
    expect(markup).toContain('Sign out');
  });

  it('falls back to the user profile icon when user name is missing', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProfileMenu, {
        user: { name: '  ', email: 'anon@example.com' },
        onLogout: vi.fn()
      })
    );

    expect(markup).toContain('aria-label="Account menu"');
    expect(markup).toContain('<circle cx="12" cy="8.5" r="3.5"');
  });
});
