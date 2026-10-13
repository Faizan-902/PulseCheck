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

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PGHOST` | Yes | — | PostgreSQL host or socket directory |
| `PGPORT` | No | `5432` | PostgreSQL port |
| `PGDATABASE` | Yes | — | Database name |
| `PGUSER` | Yes | — | PostgreSQL role |
| `PGPASSWORD` | No | empty | Password for that role |
| `PGSSLMODE` | No | `disable` | `disable` for local PostgreSQL or `require` for TLS with certificate verification |
| `HOST` | No | `127.0.0.1` | API bind address; localhost is the development default |
| `PORT` | No | `3001` | API port |
| `FRONTEND_ORIGIN` | No | `http://localhost:5173` | Browser origin allowed by the API's CORS middleware |
| `CHECK_TIMEOUT_MS` | No | `5000` | Default timeout for a new endpoint, from 100 to 30,000 ms |
| `WORKER_POLL_INTERVAL_MS` | No | `5000` | How often the worker looks for due endpoints, from 250 to 60,000 ms |
| `WORKER_BATCH_SIZE` | No | `10` | Maximum due endpoints claimed per cycle, from 1 to 100 |
| `VITE_API_BASE_URL` | No | `/api` | Optional dashboard API base URL; set it in `client/.env.local` when needed; local development uses the Vite proxy |

The server loads `.env` from the project root and validates these values at startup. Database credentials are never stored in source files.

## API

All successful responses use `{ "data": ... }`. Errors use `{ "error": { "code": "...", "message": "..." } }`; validation errors also include field details.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check API and PostgreSQL connectivity |
| `POST` | `/api/endpoints` | Register an endpoint |
| `GET` | `/api/endpoints` | List endpoints, including each endpoint's latest result |
| `GET` | `/api/endpoints/:id` | Get one endpoint |
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

The worker claims due endpoints with PostgreSQL `FOR UPDATE SKIP LOCKED` and a lease plus fencing token, then performs network checks outside the transaction. A claim gets a lease longer than the endpoint timeout; claimed checks in a batch start together. If a worker dies, the lease expires and the endpoint can be claimed again. A newer claim changes the token, so a stale worker cannot persist a result or overwrite the newer schedule. Check result, incident transition, and next schedule update commit in one transaction.

Incident policy: **manual checks do not affect incident state**. Only scheduled results count toward the two-consecutive-failure/open and two-consecutive-success/resolve thresholds. The check history stores a source for each result so manual results cannot alter those thresholds. A partial unique index prevents multiple open incidents for one endpoint.

## Network safety

Registration and every check resolve the hostname and reject any DNS answer that is not a public unicast address. Literal private/reserved addresses and local/internal hostnames are rejected. Requests use a per-hop Undici dispatcher pinned to the validated DNS answers, so the connection cannot perform a second unvalidated DNS lookup. Redirects are handled manually, capped at five hops, and each new destination is checked before it is contacted. HTTPS-to-HTTP redirects are blocked. Request timeouts use `AbortSignal.timeout()`. PulseCheck reads response headers and status only, then cancels the response body.

The URL is only an endpoint target. The API does not expose a general-purpose fetch or proxy route.

## Tests and build

Run the backend tests:

```bash
npm test
```

Unit tests use an in-memory repository, DNS resolver fixtures, and mocked fetch responses; they do not call public websites. The suite also runs PostgreSQL integration tests against a dedicated database named `pulsecheck_test` by default. Create it once with `createdb pulsecheck_test` using the same local PostgreSQL role, then run `npm test`. If you use a different test database name, set `PULSETEST_PGDATABASE` to a name ending in `_test` before running tests. Integration tests create and drop a unique temporary schema inside that database; they never drop the database itself.

Build the dashboard:

```bash
npm run build
```


## Code map

- `server/src/config/env.js` loads and validates the environment; `server/src/db/pool.js` owns the PostgreSQL connection pool.
- `server/migrations/` defines endpoints, check results, scheduling, incidents, and lease fencing; `server/src/db/migrate.js` applies and tracks those SQL files.
- `server/src/validation/schemas.js` contains the Zod request schemas; `server/src/routes/` maps URLs to controllers; `server/src/controllers/` coordinates validation, models, and services.
- `server/src/models/endpoint-model.js` contains parameterized SQL, due-check claims, scheduled result persistence, and incident transitions.
- `server/src/security/target-url.js` validates public destinations and pins the HTTP connection to vetted DNS answers; `server/src/services/health-check.js` handles redirects, timeouts, latency, and UP/DOWN classification.
- `server/src/app.js` assembles middleware and routes; `server/src/index.js` starts the API; `server/src/worker.js` starts the separate worker process.
- `client/src/App.jsx` contains registration, endpoint list, manual check, and history interactions; `client/src/styles.css` provides the dashboard layout.
- `server/test/` covers API behavior, check classification, DNS safety, and PostgreSQL-backed scheduling and incident behavior.

## Request flow

1. The dashboard sends a registration request to the API.
2. Zod checks the body. The network-safety layer resolves the target and rejects non-public addresses before the endpoint is stored.
3. The repository inserts the endpoint with a parameterized PostgreSQL query.
4. A manual check loads that endpoint, resolves and validates it again, connects to a pinned address, applies the timeout, follows only validated redirects, and measures elapsed time.
5. The repository inserts an `UP` or `DOWN` row in `check_results`. The dashboard refreshes the endpoint list and can load recent checks and incident history.
6. The separate worker polls due endpoints, checks them using the same safety-checked service, and advances each endpoint's next scheduled time.
