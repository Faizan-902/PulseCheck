# Google OAuth 2.0 (PKCE) & Home Viewport Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side Google OAuth 2.0 (Authorization Code + PKCE + RS256 ID-token verification) to Sign In and Sign Up, and fix the `#home` landing page viewport fit so it renders without vertical scrolling on desktop/laptop screens.

**Architecture:** Store single-use hashed OAuth `state` + `binding_hash` + PKCE `code_verifier` + `nonce` in PostgreSQL (`oauth_states`), verify Google's OIDC `id_token` cryptographically via Google's JWKS using `node:crypto`, link/create users in `users` (`google_sub`, nullable `password_hash`), issue the existing `HttpOnly` `pulsecheck_session` cookie, and update `SignIn.jsx` / `usePublicPage.js` / `auth.css`.

**Tech Stack:** Node 24 (`node:crypto`), Express 5, PostgreSQL, Zod, React 19, Vite, Vitest.

**Spec:** [2026-11-28-google-auth-and-home-viewport-design.md](../specs/2026-11-28-google-auth-and-home-viewport-design.md)

## Global Constraints
- Preserve existing email/password authentication, CSRF protection, rate limiting, and API compatibility.
- Keep `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` optional in `env.js` (requiring both if either is set) so unconfigured environments still boot.
- Never accept `email_verified !== true` or unverified JWT payloads.

---

### Task 1: Migration `009`, OAuth env config, and `google-oauth.js` (PKCE + JWKS RS256 verification)
- **Files:** `server/migrations/009_add_google_oauth.sql`, `server/src/config/env.js`, `server/src/services/google-oauth.js`, `server/test/google-oauth.test.js`, `server/test/config.test.js`
- Write failing tests for PKCE challenge, auth URL construction, RS256 ID-token verification (valid, bad signature, wrong audience, expired, wrong nonce, unverified email), and paired env validation; verify RED, implement, verify GREEN.

### Task 2: `auth-model.js`, `auth-controller.js`, `routes/auth.js`, `app.js`, `runtime.js`, `data-retention.js`
- **Files:** `server/src/models/auth-model.js`, `server/src/controllers/auth-controller.js`, `server/src/routes/auth.js`, `server/src/app.js`, `server/src/runtime.js`, `server/src/services/data-retention.js`, `server/test/auth.test.js`, `server/test/postgres-scheduling.test.js`
- Write failing tests for `GET /api/auth/google` (unconfigured redirect & configured state/PKCE/cookie), `GET /api/auth/google/callback` (valid login/signup/linking, replay/missing-cookie rejection, cancelled OAuth), and password login rejection on Google-only accounts (`passwordHash: null`); verify RED, implement, verify GREEN.

### Task 3: Frontend `#home` viewport fix & "Continue with Google" UI
- **Files:** `client/src/views/auth.css`, `client/src/views/SignIn.jsx`, `client/src/hooks/usePublicPage.js`, `client/src/App.jsx`
- Adjust `.home-hero`, `.home-copy`, and `.home-hero img` in `auth.css` so `#home` fits within `100dvh` on `1280×800` and `1440×900`.
- Add **"Continue with Google"** button + divider + OAuth error message handling on `SignIn.jsx` and `usePublicPage.js`.

### Task 4: Apply migrations, run full suite & build, restart localhost, and verify in Chrome
- Run `npm run migrate`, `npm test`, `npm run build`, `git diff --check`.
- Restart localhost services (`npm start`, `npm run start:worker`, `npm run dev:client`) and verify `#home`, `#signin`, and `#signup` in Chrome at `1280×800` and `1440×900`.
