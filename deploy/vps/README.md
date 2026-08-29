# Clario 360 — VPS deployment (`deploy/vps`)

One-command deploy of the **full platform** (15 Go services + Next.js frontend +
dedicated infra) to a **shared** Ubuntu host, namespaced so it never disturbs the
other apps already on the box.

Built and verified against **109.199.103.82** (Ubuntu 24.04, 8 vCPU / 23 GiB),
which also runs DigiBit `talent-portal`, `boacrm`, and `cba-uat`.

## What it does

| Layer | How it runs | Where |
|------|-------------|-------|
| Postgres, Redis, Kafka, MinIO ×2, OpenSearch, Vault, ClamAV | Docker, compose project `clario360`, **all bound `127.0.0.1`** | `docker-compose.clario360.yml` |
| 15 Go services + frontend | `pm2`, built **on the box** from synced source | `ecosystem.prod.js` |
| Public ingress | a **new nginx `server_name` block** (additive, `reload` not `restart`) | `nginx-clario360.conf.template` |

Isolation guarantees (see the compose header): dedicated project/network/volumes,
`clario360-prod-*` container names, remapped host ports off everything already in
use, per-service `mem_limit`, and `SERVER_HOST=127.0.0.1` for the app listeners.
Keycloak and the observability stack are intentionally omitted. ClamAV is included
because uploaded legal documents must receive a positive malware-scan verdict.

## Prerequisites

- **Workstation:** `ssh`, `rsync`, `openssl`, `perl`, and the deploy key
  `~/.ssh/clario360_vps_deploy` (already authorized on the box).
- **Box (already present):** Docker + compose v2, Go 1.24 (`/usr/local/go/bin`),
  Node 20, `pm2`, `nginx`, `gcc`/`make`.

## Usage

```bash
cd deploy/vps
cp clario360.env.example clario360.env     # already done for 109.199.103.82
# edit clario360.env if needed (exposure, domain, swap)

./deploy.sh preflight     # verify local + remote tooling and reachability
./deploy.sh all           # full pipeline, idempotent end-to-end
```

Phases are individually re-runnable (idempotent):

```bash
./deploy.sh provision     # dirs + swap + generate/persist infra credentials + upload config
./deploy.sh secrets       # generate JWT/encryption/mTLS key material on the box
./deploy.sh sync          # rsync source (vendored Go build, excludes stray binaries)
./deploy.sh infra         # docker compose up + WORM bucket init + verify all 14 DBs
./deploy.sh migrate       # build migrator+seeder, migrate 12 DBs, seed demo tenant
./deploy.sh build         # build 15 Go binaries + Next.js (pm2 one-shot)
./deploy.sh start         # pm2 start in dependency order + persist
./deploy.sh nginx         # install the additive vhost + reload
./deploy.sh verify        # health checks + pm2/status summary
```

Ops: `./deploy.sh status | logs <svc> | restart [svc] | stop | destroy`.

## Exposure

Set in `clario360.env`:

- **`EXPOSE_MODE=ip`** (default) → reachable at **`http://109.199.103.82/`** via a
  new nginx `server_name 109.199.103.82` block. No DNS needed. Cookies are
  non-secure (http) — fine for an internal preview.
- **`EXPOSE_MODE=domain`** + `DOMAIN=clario.example.com` + `ENABLE_TLS=true` →
  point a DNS A-record at the box, then `deploy.sh nginx` runs
  `certbot --nginx` for that host and cookies become `Secure`.

> `NEXT_PUBLIC_API_URL` is **baked into the client bundle at build time** from the
> exposure setting. Changing exposure requires re-running `build` + `start`.

## Security notes (shared box, no firewall)

- All **infra** (Postgres/Redis/Kafka/MinIO/OpenSearch/Vault) is bound to
  `127.0.0.1` — not reachable off-box.
- The app is fronted **same-origin through nginx**; frontend + gateway listen on
  loopback. `SERVER_HOST=127.0.0.1` binds the shared-config listeners to loopback;
  the remaining suite-service ports are JWT-gated (401 without a valid token).
- Generated infra credentials live only in `clario360.env` (gitignored) and the
  box's `/opt/clario360/clario360.env` (chmod 600). Key material lives only in
  `/opt/clario360/.dev-secrets` (chmod 600) — never committed, never transferred.
- The deploy key is dedicated (`clario360_vps_deploy`); no password is stored in
  any committed file.

## Demo credentials

With `SEED_DEMO_DATA=true` the Watheeq tenant **"Abdullah Al Othaim Investment
Company"** and its admin are seeded (Legal Affairs / Lex). The `migrate` step runs
`system-seeder` before `lex-service` starts.
