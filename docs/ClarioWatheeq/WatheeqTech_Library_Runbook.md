# WatheeqTech Reference Library + Second Brain — Ops Runbook

**Status:** Operational runbook (Workstream D — Deployment & Platform Integration)
**Date:** 2026-07-11
**Owns:** deploy/env/ecosystem wiring, gateway/routing, Helm/compose for the AI
runtime, CI. Companion to the build design
[`WatheeqTech_Library_Design.md`](./WatheeqTech_Library_Design.md).

This runbook takes a fresh environment from "code merged" to "a user asks the
Second Brain a question and gets a cited Arabic answer", and documents the
one dangerous side-task: scrubbing the 95 MB corpus out of git history.

> **Honest scope.** The *code + config + tests + manifests* here are complete and
> validated (`helm lint` 0 failures, both modes `helm template` render, compose
> parses, pytest green). What must be **provisioned** to actually RUN it — the
> corpus bytes (a mounted volume in dev / a MinIO bucket in prod), a pgvector DB,
> the ~2 GB embedding model, `ANTHROPIC_API_KEY`, tesseract-ara — is called out
> explicitly in §1 and never faked. `/ask` returns a clean `503` until its key is
> present; nothing pretends to work when a dependency is absent.
>
> **Two byte-storage modes (design §2.3 / §2.4), both now wired in code:**
>
> | Mode | Where | How bytes are served | Selected by |
> |---|---|---|---|
> | **`volume`** | dev / local (docker compose, pm2), and the **safe chart default** | lex streams from a mounted read-only corpus dir (`LEX_REFERENCE_LIBRARY_DIR`) | Helm `lexService.referenceLibrary.storageMode: volume` (default); seed `--byte-source=volume` |
> | **`file-service`** | **production** (Kubernetes) | lex fetches bytes from the platform **file-service / MinIO** as the canonical library tenant, minting that tenant's JWT with the RS256 **private** key | Helm `storageMode: file-service` (baked into **`values-production.yaml`**); seed `--byte-source=file-service` |
>
> The catalog's per-row `byte_source` discriminator makes the two frontend-invisible,
> so you can run `volume` in dev and `file-service` in prod off the **same** code +
> catalog. An out-of-the-box `helm install` with no MinIO stays on `volume` and
> boots cleanly; enabling `file-service` without its prerequisites **fails the Helm
> render loudly** (never a silent 502).

---

## 0. Architecture at a glance — how the pieces talk

```
 Browser ──▶ nginx ──▶ api-gateway ──▶ lex-service ──┬─▶ lex_db  (catalog: reference_library_documents)
   /api/v1/lex/reference-library/*   (JWT + entitlement │       app.watheeq + RequireAnyPermission(lex:reference:view, lex:read))
                                                        │
                                                        ├─▶ mounted corpus volume  (PDF bytes; /{id}/download, design §2.4)
                                                        │       LEX_REFERENCE_LIBRARY_DIR
                                                        │
                                                        └─▶ ai-second-brain  (FastAPI RAG; /search + /ask PROXY)
                                                                LEX_AI_SERVICE_URL ─▶ :8000
                                                                    │
                                            ai-second-brain-db  ◀───┤  pgvector (embeddings + citations)
                                            Anthropic API       ◀───┘  generation (/ask only)
```

**Two independent lex ⇄ second-brain directions — do not confuse them:**

| Direction | Who calls whom | Env that wires it | Purpose |
|---|---|---|---|
| **Query (runtime)** | lex-service → second-brain `/search`, `/ask` | `LEX_AI_SERVICE_URL` on **lex-service** | Proxy a user's semantic search / Q&A. Auth+tenant were already enforced at the gateway→lex boundary; lex→AI is a trusted internal call. |
| **Ingest (ops)** | second-brain → lex-service `/reference-library` + `/{id}/download` | `LEX_API_URL`/`LEX_API_TOKEN`/`LEX_TENANT_ID` on **second-brain** | Pull the catalog + PDF bytes to embed (Option A). Blank ⇒ second-brain ingests from its mounted local corpus instead. |

**Why no `/api/v1/ai/*` gateway upstream.** The platform pattern (and the shipped
Go code, `internal/lex/handler/reference_library_handler.go`) is that **lex owns
the cross-tenant + RBAC decision and proxies** to the Second Brain. A direct
gateway upstream would (a) collide with the existing `/api/v1/ai` → iam-service
route (`gateway/config/routes.go:74`), (b) bypass the `lex:reference:view` gate
and the global-catalog cross-tenant control, and (c) force the Second Brain to
validate JWTs it has no business handling. So the AI service is **internal-only**
and reached exclusively through `LEX_AI_SERVICE_URL`. No nginx or gateway route
change is needed — `/api/v1/lex/*` already reaches lex.

---

## 1. Provisioning matrix — what must be supplied to RUN it

Everything below is wired in code/config; these are the live resources an operator
must provide per environment. Nothing is faked when absent.

### 1.1 Always (both storage modes)

| Dependency | Needed for | Absent behaviour |
|---|---|---|
| **lex_db migration 000080** (`reference_library_documents` catalog) | listing/search/download of the catalog | lex-service **FATALs at boot** if the migration errors (applied automatically, §3) |
| **lex_db migration 000081** (`reference_library_access_log`) | the per-access audit trail (download / ask / search) | audit writes are best-effort and log a warning; downloads/ask still work, but there is no audit row (§3) |
| **`reference-library-seed` run** | the 33 catalog rows | empty library (0 rows) |

### 1.2 Byte path — pick ONE per environment

| Dependency | Needed for | Absent behaviour |
|---|---|---|
| **`volume` mode** — corpus bytes (95 MB, gitignored) staged at `LEX_REFERENCE_LIBRARY_DIR` | `/reference-library/{id}/download`; local-corpus ingest (dev) | `404 NOT_FOUND` on download; catalog metadata still lists/searches |
| **`file-service` mode** — the 33 PDFs uploaded to the platform **file-service / MinIO** bucket `clario360-lex` (via `reference-library-seed --byte-source=file-service`) | `/download` in production | download `502` if the object/tenant is missing |
| **`file-service` mode** — `LEX_REFERENCE_LIBRARY_TENANT_ID` (canonical library tenant UUID) | minting the file-service read JWT | download `502 REFERENCE_LIBRARY_NO_LIBRARY_TENANT`; **Helm render FAILS** if unset (`storageMode=file-service`) |
| **`file-service` mode** — `AUTH_RSA_PRIVATE_KEY_PEM` present on lex-service | lex MINTS the library-tenant JWT (validation-only lex cannot sign) | `Token()` errors → download falls back to volume / `502` (rendered automatically in file-service mode from the `jwt-keys` secret) |
| **`file-service` mode** — `LEX_FILE_SERVICE_URL` reachable | fetching bytes from file-service | download `502`; Helm derives it in-cluster (`http://<release>-file-service:8092`) or from `referenceLibrary.fileServiceUrl` |

### 1.3 Second Brain (optional — search + Q&A)

| Dependency | Needed for | Absent behaviour |
|---|---|---|
| **pgvector Postgres** (`AI_DATABASE_URL`) | `/search`, `/ingest`, `/ask` | those → `503`; `/health` → `degraded` |
| **Embedding model** (~2 GB, first `/ingest`) | `/search`, `/ingest`, `/ask` | those → `503` until the model loads |
| **`ANTHROPIC_API_KEY`** | `/ask` + `/ask/stream` (generation) only | `/ask` → `503 {"error":"llm not configured"}`; `/search` still works |
| **tesseract + `tesseract-ocr-ara` + poppler** | OCR of scanned مجلة قضاء issues | scanned pages stay unsearchable; born-digital PDFs unaffected (baked into the AI image) |
| **`LEX_AI_SERVICE_URL`** set on lex-service | the `/search` + `/ask` + `/ask/stream` proxies | those routes → `503 {"error":"second brain not configured"}` (clean, by design) |

**Code complete vs must-be-provisioned.** Everything in the "Dependency" column is a
*live resource an operator supplies* — not code. The code, the Helm templates (both
modes), the seeder (both byte sources), the migrations, the compose, and the pytest
suite are done. The bucket, the pgvector DB, the `ANTHROPIC_API_KEY`, `tesseract-ara`,
and the ~2 GB embedding model are the only things left, and each degrades honestly.

---

## 1.5 End-to-end quickstart (copy-paste)

The full seven-step flow, from "code merged" to "a user gets a cited Arabic
answer". Each step links to its detailed section. **DEV** = `volume` byte path on
your workstation; **PROD** = `file-service` byte path on Kubernetes. Run the steps
in order.

```bash
# ── 0. env every step below reads (DEV) ────────────────────────────────────
export LEX_DB_URL='postgres://clario:clario_dev_pass@localhost:5436/lex_db?sslmode=disable'
export CORPUS='docs/ClarioWatheeq/WatheeqTech Library'
export MANIFEST='docs/ClarioWatheeq/reference_library_manifest.json'

# ── 1. apply lex_db migrations 000080 + 000081 (catalog + audit log) ── §3 ──
#     lex-service auto-runs these on boot (FATAL on error). To apply standalone
#     (migrator auto-discovers backend/migrations/<db>; pass a DSN override):
GOWORK=off go run ./backend/cmd/migrator -direction up -db lex_db -lex-db-url "$LEX_DB_URL"
psql "$LEX_DB_URL" -c "SELECT version,dirty FROM schema_migrations"   # 81, f

# ── 2. stage the 33 PDFs + committed manifest ──────────────────────── §2 ──
#     DEV volume path: the corpus is already at $CORPUS in the repo working copy.
ls "$CORPUS" | wc -l          # 33 PDFs (gitignored — never cloned; see §2)

# ── 3. seed the 33 catalog rows (idempotent) ───────────────────────── §4 ──
GOWORK=off go run ./backend/cmd/reference-library-seed \
  --db-url "$LEX_DB_URL" --dir "$CORPUS" --manifest "$MANIFEST"    # byte-source=volume (default)
psql "$LEX_DB_URL" -c "SELECT count(*) FROM reference_library_documents WHERE deleted_at IS NULL"   # 33

# ── 4. bring up the Second Brain + pgvector (opt-in "ai" profile) ──── §5 ──
cp ai/second-brain/.env.example ai/second-brain/.env     # set ANTHROPIC_API_KEY for /ask
export ANTHROPIC_API_KEY=sk-ant-…                         # optional; /search works without it
docker compose --profile ai up -d ai-second-brain-db ai-second-brain

# ── 5. embed the corpus (first run downloads the ~2 GB model) ──────── §5 ──
curl -X POST localhost:8000/ingest -H 'content-type: application/json' -d '{}'

# ── 6. smoke the AI service directly, then through the lex proxy ───── §6 ──
curl -s localhost:8000/health | jq '{status, indexed_chunks, components}'   # ok|degraded
curl -s 'localhost:8000/search?q=%D8%A7%D9%84%D8%AA%D8%AD%D9%83%D9%8A%D9%85&top_k=5' | jq '.meta'   # {count, mode}
curl -s -X POST localhost:8000/ask -H 'content-type: application/json' \
     -d '{"question":"ما هي شروط تسجيل العلامة التجارية؟"}' | jq '{model, n:(.citations|length)}'   # 503 if no key
curl -sN -X POST localhost:8000/ask/stream -H 'content-type: application/json' \
     -d '{"question":"ما هي عقوبة التوقيع على بياض؟"}'     # SSE: token deltas + final citations event

# ── 7. wire lex → AI and smoke the whole platform path ─────────────── §6 ──
#     set LEX_AI_SERVICE_URL=http://localhost:8000 in frontend/.env.local, restart lex:
pm2 restart clario360-lex-service --update-env
#     then the gateway-proxied smoke (needs a Watheeq JWT) is in §6.
```

**PROD deltas (file-service byte path, Kubernetes).** Same seven steps; the byte
path and the wiring differ:

- **Step 2** — instead of staging a volume, upload the 33 PDFs to the MinIO bucket
  `clario360-lex` **as part of step 3** (the seeder does it): run
  `reference-library-seed --byte-source=file-service --file-service-url "$LEX_FILE_SERVICE_URL"
  --library-tenant-id "$LEX_REFERENCE_LIBRARY_TENANT_ID"` (needs `AUTH_RSA_PRIVATE_KEY_PEM`
  in the seeder's env so it can mint the library-tenant JWT). See §4.
- **Steps 1, 4–7** — driven by Helm: enable `file-service` mode + the Second Brain
  in one install (§5.2). lex auto-derives `LEX_AI_SERVICE_URL`; migrations run on
  lex boot. Provide `lexService.referenceLibrary.libraryTenantId` or **the render
  fails loudly**.

---

## 2. Stage the corpus (once per environment)

The 33 PDFs (`docs/ClarioWatheeq/WatheeqTech Library/`, 94.5 MB) are **gitignored**
(`.gitignore:116`) and therefore never rsynced/cloned. Stage them out-of-band to
the path lex-service reads (`LEX_REFERENCE_LIBRARY_DIR`).

**Local dev** — already correct: `ecosystem.local.js` sets
`LEX_REFERENCE_LIBRARY_DIR` to the absolute repo-root working copy
(`<repo>/docs/ClarioWatheeq/WatheeqTech Library`). No action unless you deleted it.
(The absolute path matters: lex-service runs with `cwd=backend/`, so the app.go
relative default would resolve under `backend/` and 404.)

**VPS (pm2 prod)** — the corpus is *not* in the rsync set. Upload it once:

```bash
# from your workstation (path has spaces → quote it)
rsync -az --delete \
  "docs/ClarioWatheeq/WatheeqTech Library/" \
  root@109.199.103.82:/opt/clario360/reference-library/
```

`ecosystem.prod.config.js` points `LEX_REFERENCE_LIBRARY_DIR` at
`/opt/clario360/reference-library` (override in `clario360.env`). Restart lex:
`pm2 restart clario360-lex-service --update-env`.

**Kubernetes** — mount the corpus read-only into lex-service. Provision a
`ReadOnlyMany` PVC (or CSI/NFS volume) seeded with the PDFs, then set:

```yaml
# values-<env>.yaml
lexService:
  referenceLibrary:
    dir: /var/lib/clario360/reference-library      # LEX_REFERENCE_LIBRARY_DIR
    volume:                                          # any Pod volume source
      persistentVolumeClaim:
        claimName: watheeq-corpus
```

The chart mounts `volume` read-only at `dir` (verified render:
`templates/lex-service/deployment.yaml`).

### 2.1 Byte path: volume (dev) vs file-service (production) — BOTH wired

The catalog's per-row `byte_source` discriminator selects the store at runtime, and
**both stores are now wired end to end** (`internal/lex/service/reference_library_service.go`
`ResolveBytes`; `file_service_client.go`; `cmd/reference-library-seed --byte-source`):

- **`volume` (dev / local, and the safe Helm default).** The seeder writes
  `byte_source='volume'` + `storage_key=<on-disk filename>`; the download handler
  streams from `LEX_REFERENCE_LIBRARY_DIR/<storage_key>` via `http.ServeContent`
  (design §2.4). No object store. **Stage the corpus per §2.**

- **`file-service` (production, design §2.3 Option A).** The seeder uploads each PDF
  to the platform **file-service / MinIO** bucket `clario360-lex` under a canonical
  *library tenant* and writes `byte_source='file-service'` + `file_id` +
  `library_tenant_id`. At download time lex fetches the bytes from file-service **as
  that library tenant**, minting a short-lived JWT with the shared RS256 **private**
  key (`AUTH_RSA_PRIVATE_KEY_PEM`) — so a validation-only lex cannot mint and would
  fall back to the volume path / a clean `502`. This is the **production default**,
  baked into `values-production.yaml` (`storageMode: file-service`, §5.2).

The discriminator makes the swap **frontend-invisible**: the same code + catalog runs
`volume` in dev and `file-service` in prod. Provision the byte path that matches the
environment (§4 seeds either), and note the migration DB default is
`byte_source='file-service'` — the seeder is what actually sets each row.

### 2.2 Helm storage-mode toggle (Kubernetes)

The chart chooses the lex-service byte path from a single value —
`lexService.referenceLibrary.storageMode` (`volume` | `file-service`):

| | `volume` (chart default) | `file-service` (production) |
|---|---|---|
| lex env rendered | `LEX_REFERENCE_LIBRARY_DIR` | `LEX_FILE_SERVICE_URL`, `LEX_REFERENCE_LIBRARY_TENANT_ID`, `AUTH_RSA_PRIVATE_KEY_PEM` |
| corpus volume | mounted read-only at `dir` **iff** `referenceLibrary.volume` is set | **none** |
| MinIO needed | no | yes (bucket `clario360-lex`) |
| set in | `values.yaml` (default) | **`values-production.yaml`** |

**Base install is safe.** An out-of-the-box `helm install` (or any `values-<env>.yaml`
that does not flip the mode) renders `volume` mode with no corpus volume: lex boots,
browse/search work, `/download` returns `404` until the corpus is staged — it never
silently 502s.

**Production = file-service.** `values-production.yaml` sets
`storageMode: file-service`. That mode **fails the Helm render loudly** (never a
silent bad default) unless its prerequisites are present:

```bash
# production install (file-service byte path):
helm upgrade --install clario360 deploy/helm/clario360 -n clario360 \
  -f values-production.yaml \
  --set lexService.referenceLibrary.libraryTenantId="$LEX_REFERENCE_LIBRARY_TENANT_ID"
#   ↑ REQUIRED — omit it and the render aborts with a clear message.
```

- `libraryTenantId` empty → render aborts: *"lexService.referenceLibrary.libraryTenantId
  is REQUIRED when storageMode=file-service …"*. Supply it at install (never commit it).
- `LEX_FILE_SERVICE_URL` derives to the in-cluster `http://<release>-file-service:8092`
  when `fileService.enabled` (default), or set `referenceLibrary.fileServiceUrl` for an
  external file-service; neither present + `fileService.enabled=false` → render aborts.
- `AUTH_RSA_PRIVATE_KEY_PEM` is auto-mounted from the `jwt-keys` secret in this mode
  (validation-only lex — public key only — cannot mint the library-tenant JWT).
- An unknown `storageMode` (e.g. `s3`) → render aborts: *"must be \"volume\" or
  \"file-service\""*.

Verified: `helm lint` 0 failures; `helm template` renders `volume` mode by default and
`file-service` env (no volume) with `--set storageMode=file-service` + a tenant id; all
four guards abort with the messages above.

---

## 3. Apply migrations 000080 + 000081 (catalog + audit log)

Two lex_db migrations back the library:

- **`000080_reference_library.(up|down).sql`** — the global
  `reference_library_documents` catalog (no `tenant_id`, permissive RLS read
  policy, idempotent-UPSERT unique index on `content_hash`; column default
  `byte_source='file-service'`).
- **`000081_reference_library_access_log.(up|down).sql`** — the
  `reference_library_access_log` table: one durable audit row per `download` /
  `ask` / `search` (who + what + when + outcome + bytes served, byte-source-independent).
  The write is best-effort and NON-BLOCKING — an audit-write failure logs a warning
  but never fails the request.

- **Local + VPS + k8s:** lex-service runs `runMigrations` on boot
  (`cmd/lex-service/main.go`, **FATAL on error**), so 000080 **and** 000081 apply
  the moment a rebuilt lex-service starts. The VPS `deploy.sh migrate` step and the
  Helm migration Job also run the standalone `migrator -direction up` across lex_db
  before lex starts (`-db lex_db -lex-db-url "$LEX_DB_URL"` for lex only).
- **Verify:**

  ```bash
  psql "$LEX_DB_URL" -c "\d reference_library_documents"      # catalog table exists
  psql "$LEX_DB_URL" -c "\d reference_library_access_log"     # audit table exists
  psql "$LEX_DB_URL" -c "SELECT version, dirty FROM schema_migrations"   # 81, f
  ```

> **Dev gotcha (known):** `lex_db` migrations past v24 need a local `tenants`
> shim (project memory: "lex_db tenants shim"). If 000080 fails dirty in dev,
> `migrate force <n>` and re-run — never in prod.

---

## 4. Seed the 33 catalog rows

`backend/cmd/reference-library-seed` is a one-shot, **idempotent** job (count-guard
+ `content_hash` UPSERT). It is **not** the per-tenant demo seeder and does **not**
run on boot. It reads the committed manifest
(`docs/ClarioWatheeq/reference_library_manifest.json`) and hashes the staged PDFs.

**`--byte-source=volume` (dev / local / VPS — the default):**

```bash
# local
GOWORK=off go run ./backend/cmd/reference-library-seed \
  --db-url "$LEX_DB_URL" \
  --dir "docs/ClarioWatheeq/WatheeqTech Library" \
  --manifest "docs/ClarioWatheeq/reference_library_manifest.json"
# add --force to re-UPSERT an already-seeded catalog

# VPS (on the box, from the rsynced repo; corpus at /opt/clario360/reference-library)
cd /opt/clario360/repo && GOWORK=off go run ./backend/cmd/reference-library-seed \
  --db-url "$LEX_DB_URL" --dir /opt/clario360/reference-library \
  --manifest docs/ClarioWatheeq/reference_library_manifest.json
```

**`--byte-source=file-service` (PRODUCTION — uploads to MinIO):** the seeder reads
each PDF from `--dir`, uploads it to the platform file-service (`suite=lex`,
dedup-by-checksum) **as the library tenant**, and writes
`byte_source='file-service'` + `file_id` + `library_tenant_id`. It mints the
library-tenant JWT from the shared RS256 key, so `AUTH_RSA_PRIVATE_KEY_PEM` (and the
matching public key) **must be in the seeder's env** (via `config.Load()` /
`clario360.env`) — the seed fails loudly with "is AUTH_RSA_PRIVATE_KEY_PEM set?" if not.

```bash
# run once, from a box that can reach file-service and has the RS256 keys in env
export AUTH_RSA_PRIVATE_KEY_PEM="$(cat /path/to/jwt-private.pem)"
export AUTH_RSA_PUBLIC_KEY_PEM="$(cat /path/to/jwt-public.pem)"
GOWORK=off go run ./backend/cmd/reference-library-seed \
  --db-url "$LEX_DB_URL" \
  --dir "$CORPUS" --manifest "$MANIFEST" \
  --byte-source=file-service \
  --file-service-url "$LEX_FILE_SERVICE_URL" \
  --library-tenant-id "$LEX_REFERENCE_LIBRARY_TENANT_ID"
# optional: --reindex --ai-url "$LEX_AI_SERVICE_URL" also POSTs {ai}/ingest
```

In Kubernetes, run this as a one-shot Job (or `kubectl run` a pod from the
`lex-service` image) that mounts the `jwt-keys` secret and the corpus, targeting the
in-cluster `http://<release>-file-service:8092`. The upload is idempotent
(dedup-by-checksum); a fully-seeded catalog is a no-op without `--force`.

Expect `upserted 33 of 33 catalog rows`. Verify + smoke the read API:

```bash
psql "$LEX_DB_URL" -c "SELECT count(*) FROM reference_library_documents WHERE deleted_at IS NULL"   # 33
# through the gateway (needs a Watheeq JWT with lex:read / lex:reference:view):
curl -H "Authorization: Bearer $JWT" https://<host>/api/v1/lex/reference-library | jq '.meta'
curl -H "Authorization: Bearer $JWT" https://<host>/api/v1/lex/reference-library/facets | jq
# stream a PDF (proves the volume byte path): expect Content-Type: application/pdf
curl -sD- -H "Authorization: Bearer $JWT" \
  "https://<host>/api/v1/lex/reference-library/$ID/download" -o /dev/null | grep -i content-type
```

---

## 5. Bring up the Second Brain (P2 — search + Q&A)

The Second Brain is **opt-in** and heavy (pgvector + ~2 GB embedding model +
tesseract). Skip it and the library still ships (browse/metadata-search/download);
`/search` + `/ask` just return the clean `503`.

### 5.1 Local — docker compose (`ai` profile)

```bash
cp .env.example .env                      # then set ANTHROPIC_API_KEY (optional)
docker compose --profile ai up -d ai-second-brain-db ai-second-brain
# first ingest downloads the ~2 GB embedding model into the sb-models volume:
curl -X POST localhost:8000/ingest -H 'content-type: application/json' -d '{}'
curl 'localhost:8000/search?q=%D8%B1%D8%B3%D9%88%D9%85%20%D8%A7%D9%84%D8%A3%D8%B1%D8%A7%D8%B6%D9%8A%20%D8%A7%D9%84%D8%A8%D9%8A%D8%B6%D8%A7%D8%A1&top_k=5'
curl -X POST localhost:8000/ask -H 'content-type: application/json' \
     -d '{"question":"ما هي شروط تسجيل العلامة التجارية؟"}'    # 503 if no ANTHROPIC_API_KEY
```

Then point lex at it: set `LEX_AI_SERVICE_URL=http://localhost:8000` in `.env.local`
and restart lex-service (`pm2 restart clario360-lex-service --update-env`).

The compose service (`docker-compose.yml`, `profiles: ["ai"]`) bundles a
`pgvector/pgvector:pg16` DB, publishes the API on `:8000`, mounts
`docs/ClarioWatheeq` read-only for the local-corpus ingest path, and persists the
model in the `ai-second-brain-models` volume. Standalone dev variant:
`ai/second-brain/docker-compose.yml`.

### 5.2 Kubernetes — Helm

Enable the `aiSecondBrain` component (disabled by default). It ships a Deployment
(non-root, read-only rootfs, writable `/models` + `/tmp`), a ClusterIP Service on
`:8000`, a bundled pgvector StatefulSet+Service+PVC, a model-cache PVC, a Secret
(existingSecret pattern), and an optional PDB.

```bash
helm upgrade --install clario360 deploy/helm/clario360 -n clario360 \
  -f values-<env>.yaml \
  --set aiSecondBrain.enabled=true \
  --set aiSecondBrain.secret.anthropicApiKey="$ANTHROPIC_API_KEY" \
  --set aiSecondBrain.pgvector.password="$AI_DB_PASSWORD" \
  --set 'aiSecondBrain.config.LEX_API_URL=http://clario360-api-gateway:8080' \
  --set 'aiSecondBrain.config.LEX_TENANT_ID=<library-tenant-uuid>' \
  --set aiSecondBrain.secret.lexApiToken="$LEX_SERVICE_TOKEN"     # for Option A ingest
```

> In **production** the same install carries `-f values-production.yaml`, which puts
> the lex byte path in `file-service` mode — so **also pass**
> `--set lexService.referenceLibrary.libraryTenantId="$LEX_REFERENCE_LIBRARY_TENANT_ID"`
> or the render aborts (§2.2). `LEX_TENANT_ID` above (on the AI service, for Option-A
> ingest) and `libraryTenantId` (on lex, for the byte path) are the **same** canonical
> library tenant UUID.

When `aiSecondBrain.enabled=true`, lex-service **auto-derives**
`LEX_AI_SERVICE_URL=http://<release>-ai-second-brain:8000` (verified render). Then
run `/ingest` once against the AI pod (Job or `kubectl exec … curl -XPOST
localhost:8000/ingest`). Secrets land via the platform existingSecret pattern; a
misconfigured install (pgvector enabled, no password) **fails the render
loudly** — verified.

**Resource note (honest):** requests 500m/2Gi, limits 2/4Gi; the model PVC is 5Gi;
pgvector PVC 10Gi. On the memory-tight shared VPS (~9 GiB free) the full torch +
model footprint is real — deploy the Second Brain on a node with headroom or leave
it disabled (the library degrades gracefully to metadata search).

---

## 6. End-to-end smoke through the platform

With lex wired to the AI service, exercise the **proxy** (not the AI service
directly) so auth/tenant/RBAC are on the path:

```bash
# semantic contents search (proxied to second-brain /search)
curl -H "Authorization: Bearer $JWT" \
  "https://<host>/api/v1/lex/reference-library/search?q=%D8%A7%D9%84%D8%AA%D8%AD%D9%83%D9%8A%D9%85&top_k=5" | jq '.meta'
# grounded Q&A (proxied to /ask) — 503 if ANTHROPIC_API_KEY unset (expected, honest)
curl -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  -X POST https://<host>/api/v1/lex/reference-library/ask \
  -d '{"question":"ما هي عقوبة التوقيع على بياض؟"}' | jq '{model, citations: (.citations|length)}'
# streaming Q&A (proxied to /ask/stream) — SSE: `token` deltas then a final
# `citations` event; -N disables curl buffering so tokens print as they arrive.
curl -N -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  -X POST https://<host>/api/v1/lex/reference-library/ask/stream \
  -d '{"question":"ما هي عقوبة التوقيع على بياض؟"}'
# byte download (proves the active byte path — volume OR file-service, transparently)
curl -sD- -H "Authorization: Bearer $JWT" \
  "https://<host>/api/v1/lex/reference-library/$ID/download" -o /dev/null | grep -i content-type   # application/pdf
```

Expected states: unset `LEX_AI_SERVICE_URL` → `503 second brain not configured`;
set but AI down → `502`; AI up, no `ANTHROPIC_API_KEY` → `/search` works, `/ask`
+ `/ask/stream` `503`; fully provisioned → cited Arabic answer (streamed). For
`/download`: `file-service` mode with the bucket unprovisioned → `502`; `volume`
mode with the corpus unstaged → `404`; provisioned → `200` + `Content-Type: application/pdf`.

---

## 7. Git-history scrub — remove the 95 MB corpus from history

> ⚠️ **READ THIS BEFORE TOUCHING HISTORY.** This is the one destructive procedure
> in the runbook. It is documented for when it is safe to run; **as of this
> writing it is NOT safe to run unilaterally** (see 7.0). Do not execute it as
> part of a routine deploy.

### 7.0 Current state (measured 2026-07-11)

- The 33 PDFs (94.5 MB) were committed in **`3001e382`**, which **IS an ancestor of
  `ui_revamp`** — locally **and** on `origin/ui_revamp`. The current index no
  longer tracks them (`git ls-files 'docs/ClarioWatheeq/WatheeqTech Library/'`
  → 0), and `.gitignore:116` prevents re-adds, but the bytes remain in history and
  are pushed.
- `ui_revamp` has a **concurrent auto-committer + pusher** (project memory). A
  history rewrite requires a **force-push**, which will (a) race/clobber the
  auto-pusher and (b) break every teammate's checkout of the branch.

**Therefore:** the scrub is a **coordinated, scheduled** operation, not a
side-effect of this workstream. This runbook does **not** perform it (the task
mandates *no git commits/pushes*). Do it only with the steps below.

### 7.1 Safe execution checklist (when scheduled)

1. **Freeze the branch.** Stop the ui_revamp auto-committer/pusher and announce a
   push freeze. Confirm no open work depends on the current SHAs.
2. **Full backup.** `git clone --mirror` the repo to a dated, offline location.
   Record the pre-rewrite `origin/ui_revamp` SHA.
3. **Rewrite (prefer git-filter-repo; BFG is the fallback):**

   ```bash
   # git-filter-repo (recommended). Run on a FRESH clone.
   git clone git@github.com:<org>/clario360.git clario360-scrub && cd clario360-scrub
   git filter-repo --force --invert-paths \
     --path 'docs/ClarioWatheeq/WatheeqTech Library/' \
     --path-glob 'docs/ClarioWatheeq/WatheeqTech Library/*'
   # (add --path-glob '*_copy.pdf' only if that suffix must die repo-wide)
   ```

   ```bash
   # BFG fallback:
   git clone --mirror git@github.com:<org>/clario360.git clario360.git
   bfg --delete-folders 'WatheeqTech Library' --no-blob-protection clario360.git
   cd clario360.git && git reflog expire --expire=now --all && git gc --prune=now --aggressive
   ```

4. **Verify the bytes are gone before pushing:**

   ```bash
   git verify-pack -v .git/objects/pack/*.idx 2>/dev/null | sort -k3 -n -r | head   # no ~3 MB pdf blobs
   git log --all --oneline -- 'docs/ClarioWatheeq/WatheeqTech Library/'             # empty
   git cat-file -e 3001e382 2>/dev/null && echo "OLD SHA still present" || echo "rewritten"
   ```

5. **Force-push the rewritten refs** (`git push --force-with-lease origin ui_revamp`,
   `--mirror` for BFG). Then have **every** collaborator re-clone or hard-reset —
   old clones re-introduce the blobs on the next push. Ask GitHub support to run GC
   / expire stale refs if the pack size must drop server-side.
6. **Re-enable** the auto-committer only after all clones are reset.

### 7.2 Don't forget

Keep `.gitignore:116` in place, keep the tiny **manifest**
(`reference_library_manifest.json`) and the seeder source in git, and confirm
`git ls-files 'docs/ClarioWatheeq/WatheeqTech Library/'` stays empty on the tip.

> Note: `backend/*-service` compiled binaries (50–64 MB each) are *also* in the
> HEAD tree and dwarf the corpus. They are a **separate, pre-existing** bloat issue
> outside this workstream — flag to the platform team; the same filter-repo run can
> optionally purge `backend/*-service` while the branch is already frozen.

---

## 8. Rollback

| To undo | Do |
|---|---|
| Second Brain (query path) | Unset `LEX_AI_SERVICE_URL` on lex-service + restart → `/search`+`/ask` cleanly `503`; browse/download unaffected. Helm: `--set aiSecondBrain.enabled=false` (removes AI Deployment/StatefulSet/PVCs — pgvector data is destroyed, re-ingest to restore). Compose: `docker compose --profile ai down` (add `-v` to drop the model + pgvector volumes). |
| Catalog rows | `UPDATE reference_library_documents SET deleted_at = now();` (soft delete; reads filter `deleted_at IS NULL`). Re-seed with `reference-library-seed` (it clears `deleted_at` on UPSERT). |
| Migration 000080 | `migrator`/golang-migrate `down` one step runs `000080_reference_library.down.sql` (drops the table). Do this only if no dependent data matters — it is destructive and lex-service will re-apply `up` on next boot. |
| Corpus bytes | Remove `LEX_REFERENCE_LIBRARY_DIR` contents → downloads `404`; metadata intact. Re-stage per §2. |

---

## 9. CI

- **`test-ai`** (`.github/workflows/ci.yml`) runs the Second Brain pure-logic
  pytest (Arabic chunking + citation assembly) on `python:3.11`; `anthropic`/torch
  are imported lazily so `pytest` alone suffices — fast, no infra. Locally:
  `make test-ai`. **Verified: 13 passed.**
- **Go reference-library** tests live under `internal/lex/...` and are already
  covered by the existing `go test ./internal/...` in the `test-backend` job.
- **`helm-validate`** renders the chart (incl. the new `aiSecondBrain` templates
  when enabled) via `make helm-template`. **Verified: `helm lint` 0 failures;
  full render 120 objects; YAML parses.**
- **`build-images`** now builds/signs/scans (SBOM + Trivy) the
  `clario360/ai-second-brain` image from its self-contained `ai/second-brain`
  context (a new, backward-compatible `context` input on the shared build-image
  action, default `.`). Runs on push to `main` only.

---

## 10. Environment variable reference

| Var | Service | Default | Meaning |
|---|---|---|---|
| `LEX_AI_SERVICE_URL` | lex-service | *(empty ⇒ 503)* | Second Brain base URL for the `/search`+`/ask` proxy. Helm auto-derives it from `aiSecondBrain`. |
| `LEX_REFERENCE_LIBRARY_DIR` | lex-service | dev: repo working copy; VPS: `/opt/clario360/reference-library`; k8s: `lexService.referenceLibrary.dir` | **`volume` mode:** read-only corpus dir the `/download` route streams from (must be absolute). |
| `LEX_FILE_SERVICE_URL` | lex-service | *(empty ⇒ file-service byte path disabled)* | **`file-service` mode:** file-service origin (design §2.3). Helm derives it in-cluster (`http://<release>-file-service:8092`) or from `referenceLibrary.fileServiceUrl`. |
| `LEX_REFERENCE_LIBRARY_TENANT_ID` | lex-service | *(empty ⇒ 502 on file-service download)* | **`file-service` mode:** canonical library tenant lex mints the read JWT for. REQUIRED (Helm render fails without it in file-service mode). |
| `AUTH_RSA_PRIVATE_KEY_PEM` | lex-service | *(from `jwt-keys` secret)* | **`file-service` mode:** signs the library-tenant JWT so file-service accepts lex's server-to-server byte reads. Auto-rendered in file-service mode; validation-only lex (public key only) cannot mint → falls back to volume / `502`. |
| `AI_DATABASE_URL` | ai-second-brain | bundled pgvector | pgvector DSN. Helm builds it from the bundled DB or `secret.databaseUrl`. |
| `ANTHROPIC_API_KEY` | ai-second-brain | *(empty ⇒ /ask 503)* | Generation key (Anthropic has no embeddings API — generation only). |
| `AI_EMBEDDING_MODEL` / `AI_EMBEDDING_DIM` | ai-second-brain | `intfloat/multilingual-e5-large` / `1024` | Local multilingual embedder; dim must match the pgvector column. |
| `AI_LLM_MODEL` | ai-second-brain | `claude-opus-4-8` | Generation model. |
| `LEX_API_URL` / `LEX_API_TOKEN` / `LEX_TENANT_ID` | ai-second-brain | *(empty ⇒ local corpus)* | Option A ingest source (pull catalog+bytes from lex via the gateway). |
| `OCR_ENABLED` / `OCR_LANG` | ai-second-brain | `true` / `ara` | tesseract OCR for scanned مجلة قضاء issues (baked into the image). |
| `RERANK_ENABLED` / `RERANK_MODEL` | ai-second-brain | `true` / `BAAI/bge-reranker-v2-m3` | Cross-encoder rerank (no `AI_` prefix — the field is `rerank_enabled`, consistent with its siblings `RERANK_MODEL`/`RERANK_TOP_N`). Set `RERANK_ENABLED=false` to disable. `.env.example`, compose and README all use the correct name. |

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `helm template`/`install` aborts: *"libraryTenantId is REQUIRED when storageMode=file-service"* | Production install (`values-production.yaml` = file-service mode) without the library tenant | `--set lexService.referenceLibrary.libraryTenantId=<uuid>` (never commit it). This is the fail-loud guard, working as intended (§2.2). |
| `helm template` aborts: *"storageMode=file-service needs a reachable file-service"* | `fileService.enabled=false` and no `referenceLibrary.fileServiceUrl` | Enable `fileService`, or set `referenceLibrary.fileServiceUrl` to an external origin. |
| `helm template` aborts: *"storageMode must be \"volume\" or \"file-service\""* | Typo in `storageMode` | Use exactly `volume` or `file-service`. |
| `/download` → `502 REFERENCE_LIBRARY_FILE_SERVICE_UNCONFIGURED` | file-service mode, but lex's file client isn't ready (no `LEX_FILE_SERVICE_URL`) or the row has no `storage_key` fallback | Confirm `LEX_FILE_SERVICE_URL` is set/derived and file-service is reachable; re-seed with `--byte-source=file-service`. |
| `/download` → `502 REFERENCE_LIBRARY_NO_LIBRARY_TENANT` | Catalog row (or env) has no library tenant to mint the JWT for | Set `LEX_REFERENCE_LIBRARY_TENANT_ID` (and/or re-seed so rows carry `library_tenant_id`). |
| seed fails: *"mint library-tenant token (is AUTH_RSA_PRIVATE_KEY_PEM set?)"* | `--byte-source=file-service` seeder run without the RS256 private key in env | Export `AUTH_RSA_PRIVATE_KEY_PEM` (+ public) before the seed (§4). |
| `/download` → `404` in production, seed reported success | Ran the **volume**-mode seeder (`storage_key`) but lex is in **file-service** mode (expects `file_id`) — or vice-versa | Match the seed byte-source to `storageMode`; re-seed with `--force`. |
| `/download` → `404` in dev | Corpus not staged at `LEX_REFERENCE_LIBRARY_DIR`, or a spaces/NFC path mismatch | Stage the corpus (§2); ensure the dir path is absolute and quoted (path has spaces). |
| lex `/search`+`/ask` → `503 second brain not configured` | `LEX_AI_SERVICE_URL` unset on lex | Set it (or enable `aiSecondBrain` so Helm derives it) + restart lex. |
| `/ask` → `503 llm not configured`, but `/search` works | No `ANTHROPIC_API_KEY` on the AI service | Provide the key (`aiSecondBrain.secret.anthropicApiKey` / compose `.env`). Expected/honest until then. |
| `/search`+`/ingest` → `503`, `/health` → `degraded` (`indexed_chunks: 0`) | pgvector empty or unreachable, or the embedding model hasn't loaded | Run `POST /ingest` once (first run pulls the ~2 GB model); check `AI_DATABASE_URL`. |
| Reranking won't turn off | — | Set `RERANK_ENABLED=false` (no `AI_` prefix; consistent across config.py, `.env.example`, compose, README). |
| Scanned مجلة قضاء pages don't match | tesseract Arabic pack missing (only in the AI image) | Ensure `tesseract-ocr-ara` + poppler are present; they're baked into the `ai-second-brain` image (Dockerfile). |

> The standalone `ai/second-brain/docker-compose.yml` (services `db` + `second-brain`)
> is the minimal dev variant; the **root** `docker-compose.yml --profile ai` (services
> `ai-second-brain-db` + `ai-second-brain`, both with healthchecks) is what the
> quickstart §1.5 and §5.1 use. Both `docker compose config`-validate clean.
