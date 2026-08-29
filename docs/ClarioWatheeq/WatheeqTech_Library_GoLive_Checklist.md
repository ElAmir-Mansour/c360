# WatheeqTech Reference Library + Second Brain — Go-Live Checklist

**Status:** Turnkey go-live pack. The system is **code-complete**; everything
left is the client's **provisioning** plus one command and a smoke test.
**Date:** 2026-07-12
**Pack location:** `deploy/reference-library/` (`.env.example`, `up.sh`, `smoke.sh`).
**Detail / operations:** see the
[Ops Runbook](./WatheeqTech_Library_Runbook.md) — this checklist is the tight,
sequenced path and does **not** duplicate it.

> **Honest scope.** The code, migrations, seeder, Helm charts (both storage
> modes), compose, and tests are done and validated. What must be **provided**
> to actually run it — an object store *or* a mounted corpus, a pgvector DB, an
> LLM key/endpoint, and hosting — is the client's, and each degrades honestly
> (e.g. no LLM key ⇒ `/ask` returns a clean `503`, `/search` still works).

---

## The sequence

### Step 0 — Client provisions the dependencies

| # | Dependency | For | Notes |
|---|---|---|---|
| 0.1 | **lex_db** (Postgres, reachable) | catalog + audit tables | migrations 000080-000083 run against it |
| 0.2 | **The 33 corpus PDFs** staged **either** as a mounted read-only dir (**volume** mode) **or** uploaded to the object store (**file-service** mode) | `/download` + local-corpus ingest | ~95 MB, gitignored — staged out-of-band (Runbook §2) |
| 0.3 | **Object store** (MinIO or S3) + bucket `clario360-lex` | file-service mode only | skip entirely in volume mode |
| 0.4 | **pgvector Postgres** | Second Brain `/search` `/ingest` `/ask` | bundled by `compose --profile ai` / Helm, or bring your own |
| 0.5 | **LLM access** — an `ANTHROPIC_API_KEY`, **or** an in-Kingdom Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL`) | `/ask` + `/ask/stream` | `/search` needs none; see Step 2 |
| 0.6 | **Hosting/compute** for the AI service (~2 GB embedding model + CPU) and network path lex→AI | running the RAG service | `LEX_AI_SERVICE_URL` wires it |

### Step 1 — Fill the env

```bash
cd deploy/reference-library
cp .env.example .env
# edit .env — every var is marked REQUIRED / OPTIONAL / DEFAULT with a one-liner
```

Minimum **REQUIRED** to fill: `LEX_DB_URL`; **volume mode** →
`LEX_REFERENCE_LIBRARY_DIR`; **file-service mode** → `LEX_FILE_SERVICE_URL`,
`LEX_REFERENCE_LIBRARY_TENANT_ID`, `AUTH_RSA_PRIVATE_KEY_PEM`, and the
`FILE_MINIO_*` object-store creds; for `/ask` → `ANTHROPIC_API_KEY` (or
`ANTHROPIC_BASE_URL`); for the smoke → `LEX_BASE_URL` + `LEX_JWT`.

### Step 2 — Choose storage mode + LLM provider

**Storage mode** (`STORAGE_MODE` in `.env`):

| | `volume` (default) | `file-service` (production) |
|---|---|---|
| Bytes served from | mounted read-only corpus dir | platform file-service / MinIO |
| Needs an object store | no | yes (bucket `clario360-lex`) |
| Extra REQUIRED vars | `LEX_REFERENCE_LIBRARY_DIR` | `LEX_FILE_SERVICE_URL`, `LEX_REFERENCE_LIBRARY_TENANT_ID`, `AUTH_RSA_PRIVATE_KEY_PEM`, `FILE_MINIO_*` |

**LLM provider:**

| Option | How | Sovereign? | Works today |
|---|---|---|---|
| **Cloud Anthropic** (default) | `ANTHROPIC_API_KEY` + `AI_LLM_MODEL` | no | yes |
| **In-Kingdom Anthropic-compatible endpoint** | `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` (the SDK reads `ANTHROPIC_BASE_URL` natively) | **yes** | yes — no code change |
| **Fully self-hosted OpenAI-compatible** (in-Kingdom vLLM / TGI / Ollama / llama.cpp serving **ALLaM / Jais / Falcon**) | `AI_LLM_PROVIDER=openai_compatible` + `AI_LLM_BASE_URL` (+ optional `AI_LLM_API_KEY`) | **yes — fully in-Kingdom** | yes — wired; streaming supported. With staged models (`make prefetch-models` + `HF_HUB_OFFLINE=1`) there is zero runtime egress |

For a sovereign go-live **today**, use either bottom option — an in-Kingdom
Anthropic-compatible gateway (`ANTHROPIC_BASE_URL`) **or** a self-hosted Arabic
model (`AI_LLM_PROVIDER=openai_compatible` + `AI_LLM_BASE_URL`). Both are wired and
stream; pair with staged models (`make prefetch-models` + `HF_HUB_OFFLINE=1`) for
zero-egress operation. Embeddings + reranker are already local.

### Step 3 — Bring it up (one command)

```bash
./up.sh
```

Idempotent. It: applies lex_db migrations **000080-000083**; seeds the **33**
catalog rows; brings up the Second Brain + pgvector (`docker compose --profile
ai`); waits for `/health`; triggers `POST /ingest` (first run pulls the ~2 GB
model). Knobs: `SKIP_AI=1`, `INGEST_TIMEOUT`, `HEALTH_TIMEOUT`.

> **Kubernetes/Helm** takes the place of Steps 3-4 (`aiSecondBrain.enabled=true`,
> `storageMode`, migration Job) — see Runbook §5.2. `up.sh` targets the
> compose/pm2 path.

### Step 4 — Smoke it (go / no-go)

```bash
./smoke.sh
```

Asserts, with PASS/FAIL per check (non-zero exit on any fail): lex
`GET /api/v1/lex/reference-library`, `/facets`, `/{id}/download` (200 +
`application/pdf`); AI `/health`, `/search`, `POST /ask`, and `/ask/stream`
(checks `event: token`). **All PASS = go-live is green.**

### Step 5 — Point the frontend nav live

Set `LEX_AI_SERVICE_URL` on lex-service and restart it so the `/search` + `/ask`
proxies resolve (local: `pm2 restart clario360-lex-service --update-env`), then
enable the Reference Library nav entry so users can reach it.

---

## Responsibility split — client provides vs. we operate

| Area | Client provides | We operate (shipped in-repo) |
|---|---|---|
| Database | lex_db + pgvector instances (reachable, credentialed) | schema (migrations 000080-083), the seeder, the RAG schema/bootstrap |
| Corpus bytes | the 33 PDFs staged (dir **or** object store) | the catalog + manifest, byte-source discriminator, streaming download handler |
| Object store | MinIO/S3 + bucket `clario360-lex` + creds (file-service mode) | the file-service, upload-on-seed, library-tenant JWT minting |
| LLM | an `ANTHROPIC_API_KEY` **or** an in-Kingdom Anthropic-compatible endpoint | grounded generation, guardrails, citations, streaming, cost caps |
| Models/compute | hosting for the AI service (~2 GB model, CPU) | embeddings, hybrid retrieval, reranking, OCR (baked into the image) |
| Secrets/keys | RS256 key pair (file-service mode), object-store + LLM creds | key handling, `503`-when-absent honest degradation |
| Config | fill `.env`, choose modes | `.env.example`, `up.sh`, `smoke.sh`, Helm values (both modes) |
| Frontend | flip the nav entry live | the library + search/ask UI |

---

## Rollback

Low-risk and reversible — no destructive DDL to undo, no external state mutated
beyond what you provisioned.

1. **Hide it from users:** turn off the frontend nav entry (Step 5) — the fastest
   revert; the backend can stay up.
2. **Disable the AI path:** unset `LEX_AI_SERVICE_URL` on lex-service and restart.
   `/search` + `/ask` then return a clean `503`; browse + download still work.
3. **Tear down the AI service:** `docker compose --profile ai down`
   (add `-v` to also drop the pgvector + model volumes). lex-service is
   unaffected.
4. **Roll back the schema (rarely needed):** the migrations ship reversible
   `down` files —
   `go run ./backend/cmd/migrator -direction down -db lex_db -lex-db-url "$LEX_DB_URL"`
   steps back 000083→000080. Do this only in a controlled window; **never force a
   dirty migration in production** (Runbook §3).

The seeder and `up.sh` are idempotent, so re-running after a fix is always safe.

---

_Detail, prod/Helm specifics, the corpus-staging procedure, and the git-history
scrub live in the [Ops Runbook](./WatheeqTech_Library_Runbook.md)._
