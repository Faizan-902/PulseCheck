# Top-Right Profile Menu & No-Scroll Auth Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-ready top-right profile trigger + popover menu (user info, workspace limits, sign out) in `Topbar`, and tighten the Sign In / Create Account viewport layout so Create Account requires no scrolling on standard desktop/laptop viewports.

**Architecture:** Extract initials/formatting helpers and a self-contained `ProfileMenu` component using PulseCheck's existing design tokens, thread `auth.user` and sign-out busy state from `App.jsx` through `Dashboard.jsx` and `Topbar`, and constrain `auth.css` vertical sizing with `vh`-responsive `clamp()` rules so both panels fit within `100dvh`.

**Tech Stack:** React 19, Vite, CSS custom properties, Vitest + `react-dom/server`.

**Spec:** [2026-11-27-profile-menu-design.md](../specs/2026-11-27-profile-menu-design.md)

## Global Constraints
- Preserve existing authentication, CSRF, rate-limit behavior, and API compatibility.
- Preserve existing light paper/surface/accent visual design and responsive `<= 700px` / `<= 795px` mobile layouts.

## Review Focus
- Blank or single-word `user.name` must fall back cleanly (`getUserInitials` -> `""` triggers user icon, `"Ada"` -> `"A"`, `"Mohd Faizan Khan"` -> `"MK"`).
- `ProfileMenu` must support Escape (returning focus to trigger), outside pointer click, and disabled busy state during `handleLogout` without crashing when `scheduling` or `maxEndpointsPerUser` is still loading (`null`).
- `auth.css` must keep Create Account fitting within `100dvh` on `1280x720`+ without breaking mobile stacking (`<= 795px`) or clipping if zoomed.

---

### Task 1: Add `user` and `logout` icons + `ProfileMenu` component and wire into `Topbar` / `Dashboard` / `App`

**Files:**
- Modify: `client/src/components/Icon.jsx`
- Create: `client/src/components/ProfileMenu.jsx`
- Modify: `client/src/components/DashboardNavigation.jsx`
- Modify: `client/src/views/Dashboard.jsx`
- Modify: `client/src/App.jsx`
- Modify: `client/src/styles.css`
- Test: `server/test/profile-menu.test.js`

- [ ] **Step 1: Write the failing test in `server/test/profile-menu.test.js`**
- [ ] **Step 2: Run `npm --workspace server exec vitest run test/profile-menu.test.js` to verify RED**
- [ ] **Step 3: Implement `Icon` (`user`, `logout`), `ProfileMenu.jsx`, wire `user` & `signingOut` in `App.jsx` -> `Dashboard.jsx` -> `DashboardNavigation.jsx`, and add `.profile-*` styles in `client/src/styles.css`**
- [ ] **Step 4: Run `npm --workspace server exec vitest run test/profile-menu.test.js` to verify GREEN**

### Task 2: Fix Create Account / Sign In vertical overflow in `client/src/views/auth.css`

**Files:**
- Modify: `client/src/views/auth.css`

- [ ] **Step 1: Adjust `.auth-shell`, `.auth-header`, `.auth-layout`, `.auth-story`, `.auth-hero-image`, `.auth-form-side`, `.auth-mode`, and `.auth-form` spacing/sizing in `client/src/views/auth.css` so Create Account fits comfortably within a standard laptop viewport without vertical scrolling**
- [ ] **Step 2: Run full `npm test && npm run build`, restart localhost, and verify both the Create Account viewport height and the signed-in Profile Menu in the live browser**
