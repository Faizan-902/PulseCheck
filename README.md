# PulseCheck

PulseCheck is a small API availability monitor with a React dashboard, an Express API, and a separately runnable persistent worker. It checks registered public HTTP/HTTPS endpoints on a configurable interval and saves results and incidents in PostgreSQL.

## Requirements

- Node.js 20.19 or newer
- npm 10 or newer
- PostgreSQL 13 or newer

## Local setup

1. Install the workspace dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file and fill in your PostgreSQL settings:

   ```bash
   cp .env.example .env
   ```

   `PGPASSWORD` in `.env.example` is only a placeholder. Replace it with your own local database password, or leave it empty when your PostgreSQL server uses passwordless local authentication. The `.env` file is ignored by git.

3. Create the database named by `PGDATABASE` (the example uses `pulsecheck`). For example, connect to your PostgreSQL server with `psql` or `createdb` using the same host, port, and user from `.env`, then create the database:

   ```sql
   CREATE DATABASE pulsecheck;
   ```

   If you choose another database name, set `PGDATABASE` to match it.

4. Apply the SQL migrations:

   ```bash
   npm run migrate
   ```

   The migration command records applied migration filenames in `schema_migrations`. It is safe to run again; already-applied files are skipped.

5. Start the API, dashboard, and monitoring worker in separate terminals from the project root:

   ```bash
   npm run dev:server
   ```

   ```bash
   npm run dev:client
   ```

   ```bash
   npm run start:worker
   ```

   Scheduled checks run only while the worker process is running. It does not depend on the browser tab or frontend process.

6. Open [http://localhost:5173](http://localhost:5173). The dashboard sends `/api` requests through Vite to the API on port 3001. The API's database health is available at [http://localhost:3001/api/health](http://localhost:3001/api/health).

## Deployment preparation

For Vercel deployment, follow [the Vercel deployment guide](docs/VERCEL_DEPLOYMENT.md). In that setup, the React frontend and request-handling Express API use the same Vercel origin through `api/index.js`. The monitoring worker remains a separate persistent process.

Before deploying, provision:

- A reachable PostgreSQL 13+ database shared by the API and worker. Allow connections from both runtimes and outbound DNS/HTTP(S) from the worker to public monitored endpoints.
- A persistent Node.js 20.19+ worker service running `npm run start:worker`. Do not run the polling loop as a serverless function or cron job. Configure a supervisor to restart it with backoff; the application does not supervise or restart its own worker process.
- If operating outside the Vercel architecture, a persistent Node.js service for the Express API with the host-supplied `PORT` and `HOST=0.0.0.0`. Vercel's request Function is an alternative for the API, not the long-lived worker.

Configure the API and worker with `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` as platform-managed environment variables or secrets. A non-empty `PGPASSWORD` is required in production; an empty password remains supported for local passwordless PostgreSQL. Production startup requires `PGSSLMODE=require`; the pool verifies the server certificate. `PGSSLMODE=disable` is intended for local PostgreSQL. Set `FRONTEND_ORIGIN` to the frontend's exact HTTPS origin (scheme and hostname, with a port only when applicable). Production startup rejects localhost frontend origins and insecure session-cookie configuration. `SESSION_COOKIE_SECURE` defaults to true in production; set `SESSION_COOKIE_SAME_SITE=none` as well when the frontend and API are on different sites. `HOST` defaults to `0.0.0.0` in production and `127.0.0.1` locally. Do not put production credentials in the repository or frontend environment: values prefixed with `VITE_` are compiled into public browser assets.

Use the same database credentials for a one-off migration/release command and for both runtime services. The repository does not identify the deployed database target, so verify the deployment's `PGHOST`, `PGPORT`, `PGDATABASE`, and `PGUSER` before applying migrations. From the repository root, run `npm run migrate` after injecting those verified target settings into the command environment. Do not run it with production credentials during local verification. The migration runner is safe to rerun and serializes concurrent migration commands with a PostgreSQL advisory lock. Migration `007_allow_unavailable_latency.sql` is discovered in numeric filename order and applied through that runner. Start the API with `npm start` and the worker with `npm run start:worker` as separate long-running services. The API exposes `GET /api/health`, which includes a database connectivity check; configure the platform's readiness probe to use it. The PostgreSQL pool size is controlled by `PGPOOL_MAX` (1–10); it defaults to 2 in Vercel Function instances and 10 in other runtimes. Each serverless instance has its own pool, so estimate aggregate connections and use the database provider's supported pooler if needed. Both processes close their PostgreSQL pools on `SIGTERM`/`SIGINT`; allow enough termination grace time for in-flight requests or worker checks to finish.

The worker also performs expired-data cleanup every 15 minutes. Each cleanup statement deletes at most 500 expired sessions or rate-limit rows using ordered row locks with `SKIP LOCKED`; at most four batches per table run in one cleanup cycle. If a full backlog remains, it continues on the next worker poll. Cleanup requires the persistent worker to be supervised and running; the API does not run it. Signup currently returns `409 EMAIL_IN_USE` for an already registered address. This provides a clear account-creation error but permits email enumeration; this UX/privacy tradeoff is retained pending a product decision, and the public signup response is unchanged.

Build the frontend with `npm ci && npm run build` and publish `client/dist`. `VITE_API_BASE_URL` is read at build time. If the frontend and API share an origin, leave it unset to use `/api` and route that path to the API. If they use separate origins, set it to the API URL ending in `/api`, for example `https://api.example.com/api`, when building the frontend. Set the API's `FRONTEND_ORIGIN` to the frontend origin. The API only allows that one exact browser origin; the Vite development proxy is not part of the production build. Serve the frontend and API over HTTPS at the hosting layer.

Before launch, confirm the API health probe succeeds, the worker process remains running under the host's restart policy, the migrations are applied, and the dashboard can call the API from its configured origin. A successful frontend build alone does not verify connectivity to the deployed API or database.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PGHOST` | Yes | — | PostgreSQL host or socket directory |
| `PGPORT` | No | `5432` | PostgreSQL port |
| `PGDATABASE` | Yes | — | Database name |
| `PGUSER` | Yes | — | PostgreSQL role |
| `PGPASSWORD` | No locally; yes in production | empty locally | Password for that role |
| `PGSSLMODE` | No | `disable` locally; `require` in production | `disable` for local PostgreSQL or `require` for TLS with certificate verification; production startup rejects `disable` |
| `PGPOOL_MAX` | No | `10` outside Vercel; `2` on Vercel | Maximum PostgreSQL connections per process (1–10); estimate aggregate connections across serverless instances |
| `NODE_ENV` | No | — | Set to `production` for deployment; enables production configuration checks |
| `HOST` | No | `127.0.0.1` locally; `0.0.0.0` in production | API bind address |
| `PORT` | No | `3001` | API port |
| `FRONTEND_ORIGIN` | No | `http://localhost:5173` | Browser origin allowed by the API's CORS middleware |
| `SESSION_COOKIE_SECURE` | No | `false` locally; `true` in production | Adds the Secure flag to the session cookie; production must use HTTPS |
| `SESSION_COOKIE_SAME_SITE` | No | `lax` | Cookie SameSite policy (`strict`, `lax`, or `none`); `none` requires Secure |
| `AUTH_SESSION_TTL_HOURS` | No | `168` | Persistent session lifetime from 1 to 720 hours |
| `CHECK_TIMEOUT_MS` | No | `5000` | Default timeout for a new endpoint, from 100 to 30,000 ms |
| `WORKER_POLL_INTERVAL_MS` | No | `5000` | How often the worker looks for due endpoints, from 250 to 60,000 ms |
| `WORKER_BATCH_SIZE` | No | `10` | Maximum due endpoints claimed per cycle, from 1 to 100 |
| `VITE_API_BASE_URL` | No | `/api` | Optional dashboard API base URL; set it in `client/.env.local` when needed; local development uses the Vite proxy |

The server loads `.env` from the project root and validates these values at startup. In production, set `NODE_ENV=production`; the server then requires a non-empty `PGPASSWORD`, `PGSSLMODE=require`, an HTTPS non-local `FRONTEND_ORIGIN`, and `SESSION_COOKIE_SECURE=true`. `HOST` defaults to `0.0.0.0` in production. Database credentials are never stored in source files.

## API

All successful responses use `{ "data": ... }`. Errors use `{ "error": { "code": "...", "message": "..." } }`; validation errors also include field details.

Authentication uses Argon2id password hashes and opaque random session cookies. Only a SHA-256 hash of each session token is stored in PostgreSQL. Cookies are HttpOnly, scoped to `/api`, and use configurable Secure and SameSite flags. Browser writes require the exact configured `FRONTEND_ORIGIN`; authenticated write requests also require the synchronizer CSRF token returned from signup, login, or `/api/auth/me`, sent as `X-CSRF-Token`. The frontend keeps this CSRF token in memory and never stores session tokens in browser storage. Login and signup limits are stored as separately namespaced hashed client keys in PostgreSQL, so API instances sharing the database share counters. Migration `006_add_shared_login_rate_limits.sql` creates that store. Signup is limited to five attempts per client IP per hour by default; login is limited to ten per 15 minutes.

Migration `005_add_users_sessions_ownership.sql` adds users, sessions, and nullable endpoint ownership. Endpoints created after migration are visible only to their owner. Existing endpoints remain unowned and are hidden from all user APIs; they are not assigned to whichever account signs up first. The scheduled worker continues checking active legacy rows. To make legacy monitors available to an account, plan an explicit reviewed ownership transfer; no automatic transfer is included.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check API and PostgreSQL connectivity |
| `POST` | `/api/auth/signup` | Create an account and persistent session |
| `POST` | `/api/auth/login` | Sign in (rate limited) and create a persistent session |
| `POST` | `/api/auth/logout` | Revoke the current session |
| `GET` | `/api/auth/me` | Get the current user and CSRF token |
| `POST` | `/api/endpoints` | Register an endpoint |
| `GET` | `/api/endpoints` | List endpoints, including each endpoint's latest result |
| `GET` | `/api/endpoints/:id` | Get one endpoint |
| `DELETE` | `/api/endpoints/:id` | Delete an owned endpoint and its related checks and incidents (requires CSRF token) |
| `POST` | `/api/endpoints/:id/check` | Run and persist a manual check |
| `GET` | `/api/endpoints/:id/checks?limit=20` | Get recent check history; `limit` is 1–100 and defaults to 50 |
| `GET` | `/api/endpoints/:id/incidents` | Get incident history for an endpoint |

Example registration body:

```json
{
  "name": "Payments API",
  "url": "https://api.example.com/health",
  "timeoutMs": 5000,
  "checkIntervalSeconds": 300
}
```

Endpoint names must be 1–100 characters. URLs must use HTTP or HTTPS and cannot contain embedded credentials. `timeoutMs` is optional and must be 100–30,000 ms. `checkIntervalSeconds` is optional, defaults to 300 seconds, and must be 30–86,400 seconds. A response to the manual-check request is `201` whether the monitored endpoint is UP or DOWN; its `data` contains the saved check result. An HTTP response in the 2xx–4xx range is considered reachable (`UP`); 5xx responses and connection errors are `DOWN`.

The worker claims due endpoints with PostgreSQL `FOR UPDATE SKIP LOCKED` and a lease plus fencing token, then performs network checks outside the transaction. A claim gets a lease longer than the endpoint timeout; claimed checks in a batch start together. If a worker dies, the lease expires and the endpoint can be claimed again. A newer claim changes the token, so a stale worker cannot persist a result or overwrite the newer schedule. Check result, incident transition, and next schedule update commit in one transaction. Migration `007_allow_unavailable_latency.sql` permits `latency_ms` to be NULL when an unexpected checker failure means no measurement exists.

Incident policy: **manual checks do not affect incident state**. Only scheduled results count toward the two-consecutive-failure/open and two-consecutive-success/resolve thresholds. The check history stores a source for each result so manual results cannot alter those thresholds. A partial unique index prevents multiple open incidents for one endpoint.

## Network safety

Registration and every check resolve the hostname and reject any DNS answer that is not a public unicast address. Literal private/reserved addresses and local/internal hostnames are rejected. Requests use a per-hop Undici dispatcher pinned to the validated DNS answers, so the connection cannot perform a second unvalidated DNS lookup. Redirects are handled manually, capped at five hops, and each new destination is checked before it is contacted. HTTPS-to-HTTP redirects are blocked. Request timeouts use `AbortSignal.timeout()`. PulseCheck reads response headers and status only, then cancels the response body.

The URL is only an endpoint target. The API does not expose a general-purpose fetch or proxy route.

## Tests and build

Run the backend tests:

```bash
npm test
```

Unit tests use an in-memory repository, DNS resolver fixtures, and mocked fetch responses; they do not call public websites. The suite also runs PostgreSQL integration tests against a dedicated database named `pulsecheck_test` by default. Create it once with `createdb pulsecheck_test` using the same local PostgreSQL role, then run `npm test`. If you use a different test database name, set `PULSETEST_PGDATABASE` to a name ending in `_test` before running tests. Integration tests create and drop a unique temporary schema inside that database; they never drop the database itself. The integration setup uses the same migration filename discovery helper as `npm run migrate` and applies all migrations in order inside that temporary schema, including migration 007. Never point `PULSETEST_PGDATABASE` at production. To apply migrations to deployment, verify the intended database target in the hosting configuration first, then run `npm run migrate` from the repository root with that target's environment injected; the target database is not specified in this repository.

Build the dashboard:

```bash
npm run build
```


## Code map

- `server/src/config/env.js` loads and validates the environment; `server/src/db/pool.js` owns the PostgreSQL connection pool.
- `server/migrations/` defines users, sessions, endpoint ownership, check results, scheduling, incidents, and lease fencing; `server/src/db/migrate.js` applies and tracks those SQL files.
- `server/src/validation/schemas.js` contains the Zod request schemas; `server/src/routes/` maps URLs to controllers; `server/src/controllers/` coordinates validation, models, and services.
- `server/src/models/endpoint-model.js` contains parameterized SQL, due-check claims, scheduled result persistence, and incident transitions.
- `server/src/models/auth-model.js`, `server/src/middleware/authentication.js`, and `server/src/controllers/auth-controller.js` implement persistent sessions, CSRF validation, and account authentication.
- `server/src/security/target-url.js` validates public destinations and pins the HTTP connection to vetted DNS answers; `server/src/services/health-check.js` handles redirects, timeouts, latency, and UP/DOWN classification.
- `server/src/app.js` assembles middleware and routes; `server/src/index.js` starts the API; `server/src/worker.js` starts the separate worker process.
- `client/src/App.jsx` contains signup/login, endpoint registration, endpoint list, manual check, and history interactions; `client/src/styles.css` provides the auth and dashboard layouts.
- `server/test/` covers API behavior, check classification, DNS safety, and PostgreSQL-backed scheduling and incident behavior.

## Request flow

1. The dashboard sends a registration request to the API.
2. Zod checks the body. The network-safety layer resolves the target and rejects non-public addresses before the endpoint is stored.
3. The repository inserts the endpoint with a parameterized PostgreSQL query.
4. A manual check loads that endpoint, resolves and validates it again, connects to a pinned address, applies the timeout, follows only validated redirects, and measures elapsed time.
5. The repository inserts an `UP` or `DOWN` row in `check_results`. The dashboard refreshes the endpoint list and can load recent checks and incident history.
6. The separate worker polls due endpoints, checks them using the same safety-checked service, and advances each endpoint's next scheduled time.
