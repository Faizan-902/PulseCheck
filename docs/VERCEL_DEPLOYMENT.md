# Deploy PulseCheck on Vercel

This guide configures the current monorepo for a Vercel-hosted frontend and request-handling API. It does not provision a database or worker host.

## Architecture

- **Frontend:** Vite builds the React dashboard into `client/dist`.
- **API:** `api/index.js` is a fixed Vercel Node.js Function that restores the original `/api/*` path and forwards the request to the same Express app used by local development via `server/src/runtime.js`.
- **Worker:** `npm run start:worker` must run as a separately supervised, persistent Node.js process. Do not deploy the polling loop as a Vercel Function or rely on a daily Hobby Cron for frequent monitoring.
- **Database:** The API and worker share the same PostgreSQL database and migration set. Production connections require TLS with certificate verification.

## Vercel project settings

Keep the project linked to the repository root. Do not set Root Directory to `client` or `server`.

- Build command: `npm run build`
- Output directory: `client/dist`
- Node.js runtime: Node 24 (the linked project currently selects Node 24)
- Leave `VITE_API_BASE_URL` unset so the dashboard calls same-origin `/api`.

**Routing note:** plain Vercel Functions do not support Next.js catch-all route semantics in `api/[...path].js`. The current setup uses a normal `api/index.js` function and an explicit `/api/:path*` rewrite before the SPA fallback. The function restores the original request path from a reserved internal query parameter and rejects duplicate/ambiguous values. Do not remove the API-first rewrite or send `/api/*` to `/index.html`.

**API diagnostics:** a missing or invalid server environment returns JSON `503 API_CONFIGURATION_ERROR`; a failed runtime dependency load returns `503 API_DEPENDENCY_ERROR`; other initialization failures return `503 API_INITIALIZATION_ERROR`. Once initialized, `/api/health` reports database connection failures as JSON `503 DATABASE_UNAVAILABLE`. These responses are distinct from an unknown API route (`404 NOT_FOUND`) and from the SPA fallback. Function logs include only sanitized error categories, codes, and invalid environment variable names, never values or stack traces.

## Vercel Preview environment variables

Vercel supplies the system variables `VERCEL`, `VERCEL_ENV`, and `VERCEL_URL`; do not create or override them. For a Preview deployment, the server uses `https://${VERCEL_URL}` as the exact allowed frontend origin only when `VERCEL=1` and `VERCEL_ENV=preview`. Preview cookies remain Secure, PostgreSQL TLS remains required, and the Vercel pool defaults to two connections. If the Preview is opened through a custom alias instead of its deployment URL, set `FRONTEND_ORIGIN` to that exact HTTPS origin. Wildcard origins are never accepted.

Configure the same database variable names listed below for the **Preview** environment, using a dedicated non-production database with TLS. Do not use `localhost`; a Vercel Function cannot reach PostgreSQL on your Mac. The current linked project has no environment variables configured, so its API is expected to return a JSON configuration error until these Preview values are supplied.

## Vercel production environment variables

Add these in Vercel Project Settings → Environment Variables. Use the actual stable production domain in the origin value; do not guess it.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PGHOST` | Verified PostgreSQL hostname |
| `PGPORT` | Port supplied by the database service (usually `5432`) |
| `PGDATABASE` | Verified database name |
| `PGUSER` | Dedicated least-privilege role |
| `PGPASSWORD` | Secret password for that role |
| `PGSSLMODE` | `require` |
| `PGPOOL_MAX` | `2` to limit connections per function instance |
| `FRONTEND_ORIGIN` | Exact HTTPS origin, e.g. `https://your-stable-domain.vercel.app`, no path or trailing slash |
| `SESSION_COOKIE_SECURE` | `true` |
| `SESSION_COOKIE_SAME_SITE` | `lax` for same-origin frontend/API |

The origin must exactly match the browser's scheme and hostname. Do not place database credentials in source control, logs, or any `VITE_*` value. The existing pool verifies the database certificate when `PGSSLMODE=require`; do not disable verification to work around TLS errors.

Production must set `FRONTEND_ORIGIN` explicitly to the stable production frontend origin. The application intentionally does not use the deployment-specific `VERCEL_URL` as the Production origin.

Each Vercel function instance has its own PostgreSQL pool. `PGPOOL_MAX=2` caps each instance, but total connections can still increase with instance count. Confirm database connection limits and prefer the provider's supported pooling/proxy option when appropriate.

The Express runtime is memoized once per warm Function instance, and the PostgreSQL pool is a single module-level instance with a bounded maximum. Separate Function instances still create separate pools.

## Native Argon2 verification

`argon2` contains a native Node.js addon. The Vercel build must install/package a binary compatible with the configured Node.js runtime and Linux architecture. A local `npm ci`, local hash test, or successful frontend build does not verify that Preview can hash passwords. After adding Preview database variables, verify signup followed by login against the non-production database and inspect sanitized Function logs for dependency errors. Do not test against Production or expose diagnostic endpoints to probe the addon.

## Persistent worker environment

Run `npm run start:worker` on a separate persistent Node.js host with a restart policy. Configure it with the same verified database variables and `PGSSLMODE=require`. Also set `NODE_ENV=production`, `FRONTEND_ORIGIN` to the same stable HTTPS origin, `SESSION_COOKIE_SECURE=true`, `SESSION_COOKIE_SAME_SITE=lax`, and an appropriate `PGPOOL_MAX`. The shared environment schema validates production settings in the worker process too.

The worker requires outbound DNS and HTTP(S) access to monitored public endpoints. Confirm the host restarts it if it exits and inspect its logs. A Vercel deployment marked Ready does not prove the worker is running.

## Rollout checklist

1. Verify the PostgreSQL provider, host, port, database, role, certificate chain, and connection limit.
2. Provision a production database and least-privilege role.
3. Configure Preview variables against a dedicated non-production database and verify API health, unauthenticated JSON responses, signup/login, monitor CRUD, and manual check/history. This also exercises the native Argon2 addon in the Vercel Function runtime.
4. Configure Vercel Production variables, including the explicit stable `FRONTEND_ORIGIN`, and matching database variables on the worker host.
5. Apply migrations only after confirming the migration command's environment points to the intended database. Never run migrations against an unknown `PGDATABASE`.
6. Deploy the reviewed commit.
7. Verify `GET /api/health` returns JSON (and database status `ok` when connected). Verify `GET /api/auth/me` returns an API JSON response when unauthenticated, not SPA HTML.
8. Test signup, login, create/check/history/delete for a test monitor, and verify scheduled checks continue when no browser tab is open.

## Local verification

From the repository root:

```bash
npm ci
npm test
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

The PostgreSQL integration suite requires a dedicated database ending in `_test`; never point it at production.
