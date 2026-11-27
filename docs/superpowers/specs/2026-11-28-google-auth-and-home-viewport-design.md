# Google Authentication (OAuth 2.0 + PKCE) & Home Viewport Fix Design

**Size:** Project (full-stack auth migration, OAuth flow, frontend UI + Home landing viewport adjustment).

## Intent & Why
1. **Home Landing Viewport (`Home.jsx` / `auth.css`):** Eliminate unnecessary vertical scrolling on the `#home` landing page (*"Know when your APIs need attention."*) on standard laptop/desktop screens while keeping artwork proportions and mobile layout intact.
2. **Google Authentication (`SignIn.jsx` + Backend OAuth):** Let users sign in or create an account with Google using standard server-side OAuth 2.0 Authorization Code + PKCE, issuing PulseCheck's existing `HttpOnly` `pulsecheck_session` cookie and CSRF token.

## Goals, Non-Goals & Anti-Goals
- **Goals:**
  - `#home` fits within `100dvh` on `1280×800` and `1440×900` viewports without vertical scrolling.
  - Render a **"Continue with Google"** button on both **Sign in** and **Create account** modes in `SignIn.jsx` (and clear OAuth error feedback if Google login is cancelled, unconfigured, or fails).
  - Support Google OAuth 2.0 Authorization Code + PKCE via `GET /api/auth/google` and `GET /api/auth/google/callback`.
  - Verify `state`, single-use browser-bound `pulsecheck_oauth` cookie (`oauth_states` DB table), `code_verifier` (S256 PKCE), Google OIDC `id_token` signature (Google JWKS via `node:crypto`), `iss`, `aud`, `exp`, `nonce`, and `email_verified === true`.
  - Support users without passwords (`users.password_hash` nullable + `google_sub` unique column in migration `009`), linking verified Google emails to existing accounts cleanly while keeping password login safe when `password_hash IS NULL`.
  - Keep `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` optional until configured (requiring both if either is set) so local dev, CI, and unconfigured previews still boot and test cleanly.
- **Non-Goals:** Adding other OAuth providers, disconnecting Google accounts, or requiring a separate `SESSION_SECRET` env var (single-use DB-backed `oauth_states` avoids needing a new signing secret).
- **Anti-Goals:** Skipping `state`/cookie binding (login CSRF), accepting unverified emails (`email_verified !== true`), decoding ID tokens without verifying RS256 signatures against Google's JWKS, or crashing password login on Google-only accounts.

## Approaches Considered
- **Option A — Server-Side OAuth 2.0 Authorization Code + PKCE (Selected):** Browser navigates to `/api/auth/google`, Google redirects back to `/api/auth/google/callback`, server exchanges code + PKCE verifier, verifies signed ID token against Google JWKS, creates session cookie, and redirects to `/`. Chosen for maximum security (client secret stays server-side) and cross-browser reliability without FedCM/third-party script issues.
- **Option B — Frontend Google Identity Services ID Token:** Rejected because it relies on Google's frontend script/FedCM/popup behavior across browsers.

## Architecture & Component Design
1. **Database Migration (`server/migrations/009_add_google_oauth.sql`):**
   - `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;`
   - `ALTER TABLE users ADD COLUMN google_sub TEXT UNIQUE;`
   - `CREATE TABLE oauth_states (state_hash CHAR(64) PRIMARY KEY, binding_hash CHAR(64) NOT NULL, code_verifier TEXT NOT NULL, nonce TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);` + index on `expires_at` (also pruned by `data-retention.js`).
2. **Environment & OAuth Config (`server/src/config/env.js`, `server/src/services/google-oauth.js`):**
   - Optional `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `GOOGLE_REDIRECT_URI` (validate paired presence if one is set).
   - Dynamic redirect URI helper: uses `GOOGLE_REDIRECT_URI` if set, otherwise `${origin}/api/auth/google/callback` for the allowed frontend/deployment origin (`http://localhost:5173/api/auth/google/callback` locally via Vite proxy, or the Vercel deployment origin).
   - JWKS fetcher with cache + `node:crypto` RS256 signature & OIDC claims verification (`iss`, `aud`, `exp`, `nonce`, `email_verified === true`, `sub`, `email`, `name`).
3. **Auth Routes, Controller & Model (`auth-model.js`, `auth-controller.js`, `routes/auth.js`, `app.js`):**
   - `auth-controller.js` `login`: guard `user?.passwordHash` before `argon2.verify` (falling back to `DUMMY_PASSWORD_HASH` if `passwordHash == null` so timing stays uniform and returns `INVALID_CREDENTIALS`).
   - `GET /api/auth/google`: if unconfigured, redirect to `/#signin?authError=google_not_configured`; otherwise generate `state`, `bindingToken`, `codeVerifier`, `nonce`, save hashed `oauth_states` row (10 min TTL), set `pulsecheck_oauth` cookie (`HttpOnly`, `SameSite=Lax`, `path: '/api/auth/google'`), and redirect to Google's authorization endpoint.
   - `GET /api/auth/google/callback`: atomically consume `oauth_states` matching `state` + `pulsecheck_oauth` cookie, clear cookie, exchange code + PKCE verifier, verify ID token, upsert/link user (`findOrCreateGoogleUserAndSession`), issue `pulsecheck_session` cookie, and redirect to `/#overview` (or `/#signin?authError=...` on failure/cancellation without leaking secrets).
4. **Frontend (`client/src/views/Home.jsx`, `client/src/views/auth.css`, `client/src/views/SignIn.jsx`, `client/src/hooks/usePublicPage.js`):**
   - **Home viewport:** Update `.home-hero`, `.home-copy`, and `.home-hero img` sizing in `auth.css` so `#home` fits within `100dvh` on laptop/desktop viewports (`1280×800`, `1440×900`) without scrolling.
   - **SignIn / SignUp UI:** Add a clean **"Continue with Google"** button (`<a href="/api/auth/google">` or `VITE_API_BASE_URL` prefix) with Google mark below a subtle divider on both Sign in and Create account modes, and surface readable error messages when `#signin?authError=...` is returned from callback.
5. **Testing & Verification:**
   - Unit & integration tests for PKCE/state binding, replay rejection, RS256 ID-token verification (valid, wrong audience, unverified email, invalid signature, bad nonce), Google-only user password login rejection, account linking by verified email, cleanup of expired `oauth_states`, and live browser check of `#home`, `#signin`, and `#signup` at `1280×800` and `1440×900`.
