# PulseCheck

PulseCheck is a small API availability monitor. Day 1 includes a React dashboard and an Express API that registers public HTTP/HTTPS endpoints, runs checks on demand, saves every completed check in PostgreSQL, and displays recent history.

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

5. Start the API and dashboard in separate terminals from the project root:

   ```bash
   npm run dev:server
   ```

   ```bash
   npm run dev:client
   ```

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

Example registration body:

```json
{
  "name": "Payments API",
  "url": "https://api.example.com/health",
  "timeoutMs": 5000
}
```

Endpoint names must be 1–100 characters. URLs must use HTTP or HTTPS and cannot contain embedded credentials. `timeoutMs` is optional and must be 100–30,000 ms. A response to the manual-check request is `201` whether the monitored endpoint is UP or DOWN; its `data` contains the saved check result. An HTTP response in the 2xx–4xx range is considered reachable (`UP`); 5xx responses and connection errors are `DOWN`.

## Network safety

Registration and every check resolve the hostname and reject any DNS answer that is not a public unicast address. Literal private/reserved addresses and local/internal hostnames are rejected. Requests use a per-hop Undici dispatcher pinned to the validated DNS answers, so the connection cannot perform a second unvalidated DNS lookup. Redirects are handled manually, capped at five hops, and each new destination is checked before it is contacted. HTTPS-to-HTTP redirects are blocked. Request timeouts use `AbortSignal.timeout()`. PulseCheck reads response headers and status only, then cancels the response body.

The URL is only an endpoint target. The API does not expose a general-purpose fetch or proxy route.

## Tests and build

Run the backend tests:

```bash
npm test
```

Tests use an in-memory repository, DNS resolver fixtures, and mocked fetch responses; they do not call public websites or require a running PostgreSQL server.

Build the dashboard:

```bash
npm run build
```


## Code map

- `server/src/config/env.js` loads and validates the environment; `server/src/db/pool.js` owns the PostgreSQL connection pool.
- `server/migrations/` defines the endpoint and check tables; `server/src/db/migrate.js` applies and tracks those SQL files.
- `server/src/validation/schemas.js` contains the Zod request schemas; `server/src/routes/` maps URLs to controllers; `server/src/controllers/` coordinates validation, models, and services.
- `server/src/models/endpoint-model.js` contains parameterized SQL and converts database rows into API fields.
- `server/src/security/target-url.js` validates public destinations and pins the HTTP connection to vetted DNS answers; `server/src/services/health-check.js` handles redirects, timeouts, latency, and UP/DOWN classification.
- `server/src/app.js` assembles middleware and routes; `server/src/index.js` starts the API and closes the pool on shutdown.
- `client/src/App.jsx` contains registration, endpoint list, manual check, and history interactions; `client/src/styles.css` provides the dashboard layout.
- `server/test/` covers API behavior, check classification, DNS safety, and pinned local connections.

## Request flow

1. The dashboard sends a registration request to the API.
2. Zod checks the body. The network-safety layer resolves the target and rejects non-public addresses before the endpoint is stored.
3. The repository inserts the endpoint with a parameterized PostgreSQL query.
4. A manual check loads that endpoint, resolves and validates it again, connects to a pinned address, applies the timeout, follows only validated redirects, and measures elapsed time.
5. The repository inserts an `UP` or `DOWN` row in `check_results`. The dashboard refreshes the endpoint list and can load the newest 20 saved results.

Scheduled checks, authentication, incident management, and notifications are outside this Day 1 slice.
