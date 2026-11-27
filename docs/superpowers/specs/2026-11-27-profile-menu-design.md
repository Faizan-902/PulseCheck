# Top-Right Profile Menu Design

**Size:** Small change (frontend-only, using existing `/api/auth/me` and `/api/endpoints` metadata).

## Intent & Why
Replace the bare **Sign out** text link in the top-right header with a production-style profile trigger and popover menu so signed-in users can see who is logged in, check their workspace limits at a glance, and sign out from one clean control.

## Goals, Non-Goals & Anti-Goals
- **Goals:**
  - Show a circular profile/avatar trigger (initials derived from `user.name`, falling back to a profile icon) in the top-right of `Topbar` where **Sign out** sits today.
  - Open a keyboard- and screen-reader-accessible popover displaying `user.name`, `user.email`, live workspace limits (monitors used / cap, manual check rate limit `20/hr · 30s cooldown`, and scheduler mode), and the **Sign out** action (disabled with busy feedback while signing out).
  - Preserve responsive layout on mobile (`<= 700px`) and all existing `Topbar` actions (`system-pill`, `Add monitor`).
- **Non-Goals:** Editing display name, changing password, or adding avatar uploads (keeps auth surface unchanged; YAGNI unless requested later).
- **Anti-Goals:** Cluttering the sticky header bar with full email strings, leaving the menu stuck open on Escape / outside click / sign-out failure, or inventing unavailable fields (such as fake "Member since" dates when `/api/auth/me` does not return `createdAt`).

## Constraints
- Preserve existing API compatibility, authentication/CSRF flow (`handleLogout` in `client/src/App.jsx`), and PulseCheck's light paper/surface/accent CSS design tokens in `client/src/styles.css`.
- Pass `user={auth.user}` from `App.jsx` → `Dashboard.jsx` → `Topbar` → `ProfileMenu.jsx` without altering unauthenticated views.

## Approaches Considered
- **Approach A — Top-Right Profile Popover (Selected):** Self-contained `ProfileMenu` component triggered by an initials/icon button in `Topbar`, showing identity, live workspace quotas, and Sign out. Chosen because it delivers the expected production UX cleanly with zero backend/schema risk.
- **Approach B — Profile Popover + Account Settings Modal:** Adds backend profile/password-update endpoints and modal forms. Rejected for now as unnecessary auth/CSRF complexity when only viewing user info and signing out was requested.
- **Approach C — Dedicated `#profile` Page:** Moves Sign out behind full-page navigation. Rejected because signing out and checking account identity should stay 1-click from the top right.

## Component & Behavior Design (Calls Made)
- **`client/src/components/Icon.jsx`:** Add a `user` icon (and reuse existing `chevron` / `signout` or add a small `logout` icon).
- **`client/src/components/ProfileMenu.jsx`:**
  - Trigger button: circular initials badge (e.g. `MF` from `"Mohd Faizan"`, or `user` icon if name is blank) + subtle chevron, `aria-haspopup="menu"`, `aria-expanded={open}`, `aria-controls`.
  - Dismisses on `Escape` (returning focus to trigger), outside `pointerdown`/`mousedown`, or when `Sign out` is triggered.
  - Popover sections:
    1. Identity block: larger initials/avatar badge, `user.name`, `user.email`.
    2. Workspace limits block: `Monitors` (`summary.total / maxEndpointsPerUser`), `Manual checks` (`20/hr · 30s cooldown`), `Scheduler` (hosted vs worker cadence from `scheduling`).
    3. Footer action: **Sign out** button calling `handleLogout` with busy state (`Signing out…`).
- **`client/src/App.jsx`, `client/src/views/Dashboard.jsx`, `client/src/components/DashboardNavigation.jsx`, `client/src/styles.css`:** Thread `user` and `signingOut` state cleanly and style `.profile-menu` / `.profile-trigger` / `.profile-popover` consistently on desktop and `<= 700px` mobile.
- **Verification:** Render/unit tests in `server/test/` for initials formatting, menu structure, and accessibility attributes, plus full `npm test` and `npm run build`.
