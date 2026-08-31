# Local Setup

This is the definitive guide to running Clario 360 on your machine. It exists because the
first end-to-end local run surfaced several real bugs in the bootstrap scripts and app code
(stale migration lists, port collisions, an invalid generated CSS token). Those are fixed in
this repo now — follow the steps below and you should not hit them again. If you do hit
something new, add it to the [Troubleshooting](#troubleshooting) section once you fix it.

## Prerequisites

- Go 1.25+
- Node.js 20+
- Docker Desktop (or compatible) with Compose v2, daemon running
- `openssl` (key generation)
- Ports free (or overridden — see below): `5436`, `6382`, `8080-8091`, `9080-9091`, `9000`,
  `9001`, `9092`, `9094`, `3002`, `16686`

## 1. Create your `.env`

`docker-compose.yml` requires several credentials that are **not** committed (the file is
gitignored). Copy the template and fill in real values:

```bash
cp .env.example .env
```

Then set at minimum:

```dotenv
POSTGRES_USER=clario
POSTGRES_PASSWORD=clario_dev_pass
POSTGRES_DB=clario360
MINIO_ROOT_USER=clario_minio
MINIO_ROOT_PASSWORD=clario_minio_secret
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=<anything>
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=<anything>
```

**The Postgres and MinIO values above are not arbitrary** — `scripts/start.sh` hardcodes
`clario` / `clario_dev_pass` and `clario_minio` / `clario_minio_secret` when it launches the
Go services. If your `.env` doesn't match, every service will fail to authenticate against
the containers this file provisions.

## 2. Run the startup script

```bash
bash ./scripts/start.sh
```

(The script isn't marked executable in git — invoke it via `bash`, or `chmod +x scripts/*.sh`
locally if you prefer `./scripts/start.sh`.)

This does everything in one shot: generates dev JWT/encryption keys, starts Postgres/Redis/
Kafka/MinIO/Jaeger in Docker, creates all 7 databases, applies **every** migration file for
each one, seeds a dev tenant + admin user, builds all 11 Go service binaries, starts them,
and starts the Next.js frontend. First run takes several minutes (Docker image pulls + Go
build + `npm install`); subsequent runs are much faster with `--no-build`.

Useful variants:

```bash
./scripts/start.sh --infra-only     # Infra + migrations only, no services
./scripts/start.sh --no-build       # Skip Go rebuild (use existing .dev-bin/)
./scripts/start.sh --skip-frontend  # Backend only

./scripts/status.sh                 # Check all services
./scripts/stop.sh                   # Stop everything
```

## 3. Log in

| | |
|---|---|
| App | http://localhost:3002 |
| API Gateway | http://localhost:8080/healthz |
| MinIO Console | http://localhost:9001 (`clario_minio` / `clario_minio_secret`) |
| Jaeger | http://localhost:16686 |
| Email / Password | `admin@clario.dev` / `Cl@rio360Dev!` |
| Tenant / Role | `clario-dev` / `super-admin` |

Logs, PIDs, and dev secrets live in `.dev-logs/`, `.dev-pids/`, `.dev-secrets/` (all
gitignored).

## Port conflicts

`docker-compose.yml` maps Postgres to host port **5436** (not 5432) and Redis to **6382**
(not 6379) specifically to avoid clashing with other local Postgres/Redis instances — a
real one exists on 5432 on at least one dev machine already. `start.sh` and `status.sh`
default to these same ports. If *those* also collide with something on your machine,
override them:

```bash
DB_PORT=5555 REDIS_PORT=6399 bash ./scripts/start.sh
```

(Just make sure the override matches whatever you also change in `docker-compose.yml`'s
port mapping, if you change that too.)

## Troubleshooting

**A service crash-loops with "migration failed: type/column already exists" or a query
fails with "column X does not exist".**
`start.sh` applies every `*.up.sql` file under each `backend/migrations/<db>/` directory in
order (see `run_migrations_dir` in the script) — it no longer hand-lists files, so it can't
drift out of sync with what's on disk the way it used to. If you still see this, check
whether a migration file was added with a version number that doesn't sort correctly (must
be `NNNNNN_description.up.sql`, zero-padded) or whether the DB was left in a partially
migrated state — `docker exec -it clario360-postgres psql -U clario -d <db> -c 'SELECT * FROM schema_migrations'`
tells you the last version the script recorded.

**Every page returns 500 with a CSS parse error in the browser/Next.js console.**
Tailwind's `content` globs in `frontend/tailwind.config.ts` exclude `*.test.{ts,tsx}` — if a
new test file introduces a template-literal string that looks like a Tailwind arbitrary-value
class (e.g. `` `bg-[var(${x})]` ``), Tailwind's regex-based scanner can still pick it up
verbatim from non-excluded files and bake invalid CSS. Check `frontend/src/app/globals.css`'s
build error for the exact source line.

**Turbopack build error: "Unexpected token" in `tokens.css`.**
That file is generated — never edit it by hand. If you change
`frontend/src/styles/tokens/index.ts` or `css.ts`, regenerate it:

```bash
cd frontend && node scripts/generate-tokens.mjs
```

CSS custom-property names can't contain a literal `.` — fractional keys (e.g. spacing `0.5`)
are sanitized to `0_5` by the generator; don't reintroduce raw dots into emitted property
names.

**A backend service fails to bind its admin/metrics port ("address already in use").**
Several services default to the same metrics port (9090) in code when their dedicated
`*_ADMIN_PORT` env var isn't set. `start.sh` explicitly sets one for every service it starts
(see the exports above each `start_service` call in Phase 6) — if you add a new service,
give it an explicit, unique admin port here too rather than relying on the in-code default.

**`iam-service` (or another service) restarted but is still serving old behavior.**
`start_service()` skips launching a service if its PID file points at a still-running
process. Kill it and remove `.dev-pids/<service>.pid` before re-running `start.sh`, or use
`./scripts/stop.sh` first.
