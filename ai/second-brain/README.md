# WatheeqTech Second Brain

A Retrieval-Augmented-Generation (RAG) service over the **WatheeqTech Saudi legal
reference corpus** (33 Arabic PDFs: الأنظمة واللوائح, مجلة قضاء, البحوث والدراسات).

This is the platform's **first FastAPI AI runtime** service — the third runtime
alongside the Go core and the NestJS Business+ tier. It is self-contained under
`ai/second-brain/` and speaks a small HTTP contract that a Go proxy
(`backend/internal/lex` — `POST /reference-library/ask`, `/search`) and a React
UI build against. Design context:
[`docs/ClarioWatheeq/WatheeqTech_Library_Design.md`](../../docs/ClarioWatheeq/WatheeqTech_Library_Design.md)
§7 (Second Brain / search phasing) and §1 (the corpus).

---

## RAG pipeline

1. **Extraction** (`app/rag/extraction.py`) — pdfplumber (pypdf fallback) per page,
   keeping 1-indexed page numbers.
2. **OCR** (`app/rag/ocr.py`) — pages whose text layer is below `OCR_MIN_CHARS`
   (scanned مجلة قضاء issues) are re-run through **pytesseract** (`lang=ara`) via
   **pdf2image**. Missing tesseract degrades gracefully (page stays unsearchable);
   pages still empty after OCR are counted as `failed_pages` per document.
3. **Article-aware chunking** (`app/rag/article_chunking.py`) — Saudi statutes are
   split on their legal structure (نظام / **المادة** / الفصل / الباب), tolerating
   Arabic-Indic and Western digits, parenthesised numbers, and Arabic ordinal
   words ("الأولى" … "الثانية والعشرون"). The **article number/label + chapter +
   part** are carried across page breaks into each chunk's metadata and into
   citations. Documents with no article markers (research papers, journals) fall
   back to per-page Arabic-aware chunking (`app/rag/chunking.py`) — safe for the
   whole corpus. `CHUNK_ARTICLE_AWARE` toggles it.
4. **Embeddings** (`app/rag/embeddings.py`) — local **sentence-transformers**
   model (default `intfloat/multilingual-e5-large`, 1024-dim, strong on Arabic).
   Model id, dimension and e5 prefixes are env vars.
   *Anthropic has no embeddings API — that is why generation and retrieval use
   different providers.*
5. **Vector store** (`app/rag/vectorstore.py`) — **pgvector** on Postgres. Tables
   `library_chunks` (embeddings + a generated `tsvector` + article metadata),
   `library_documents` (per-doc idempotency, ingest status, health counts) and
   `library_articles` (the manifest-driven article index). DDL is bootstrapped +
   migrated at startup; a documentation copy is in `app/rag/schema.sql`. Cosine
   similarity (`embedding <=> query`) with an HNSW index (IVFFlat fallback,
   seq-scan if neither), plus a GIN index for keyword search.
6. **Hybrid retrieval + rerank** (`app/rag/retriever.py`, `fusion.py`, `rerank.py`) —
   a **vector** (cosine) search and a **keyword** (`tsvector`/BM25-style) search
   run in parallel and are combined with **Reciprocal Rank Fusion** (no score
   calibration needed). The top fused candidates are then re-ordered by a
   **cross-encoder reranker** (`RERANK_MODEL`, e.g. `BAAI/bge-reranker-v2-m3`).
   Every step degrades gracefully — no keyword index → vector-only; no reranker →
   fused order. `RETRIEVAL_MODE` = `hybrid` | `vector` | `keyword`.
7. **Guardrails** (`app/rag/guardrails.py`) — grounded-only + **refuse-when-out-of-
   corpus** (a low max cosine score → "not in the library", *without* calling the
   LLM), **prompt-injection defence** (detect + neutralise embedded instructions
   in the question and retrieved text; the system prompt treats context as
   untrusted data), source-citation enforcement, and per-request question-length
   + max-token cost caps.
8. **Generation** (`app/rag/generator.py` + `app/rag/providers.py`) — a **pluggable
   LLM provider** chosen by `AI_LLM_PROVIDER`: **`anthropic`** (Claude via the
   `anthropic` SDK — default `claude-opus-4-8`, adaptive thinking) **or**
   **`openai_compatible`** (any OpenAI-format `/v1/chat/completions` endpoint —
   vLLM / TGI / Ollama / OpenAI, i.e. a **KSA-resident self-hosted Arabic model**
   such as **ALLaM / Jais / Falcon** served in-Kingdom). Both providers share the
   **same** grounded, Arabic-first, article-aware, cite-only (`[n]`, no
   fabrication) prompt AND **stream** — the non-stream JSON path and the
   token-by-token **SSE stream** work identically on either backend. Switching is
   config-only, no code change. See [Sovereign deployment](#sovereign--air-gapped-deployment).

### Choices at a glance

| Concern      | Choice                                        | Env var(s) |
|--------------|-----------------------------------------------|------------|
| Embeddings   | `intfloat/multilingual-e5-large` (local, 1024-dim) | `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_DIM`, `AI_EMBEDDING_QUERY_PREFIX`, `AI_EMBEDDING_PASSAGE_PREFIX` |
| LLM          | pluggable: Claude **or** any OpenAI-compatible (KSA-hosted ALLaM/Jais/Falcon) | `AI_LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_LLM_BASE_URL`, `AI_LLM_API_KEY`, `AI_LLM_MODEL`, `AI_LLM_MAX_TOKENS`, `AI_LLM_MAX_TOKENS_CAP`, `AI_LLM_EFFORT` |
| Retrieval    | hybrid (vector + keyword) + RRF fusion        | `RETRIEVAL_MODE`, `RETRIEVAL_CANDIDATE_K`, `HYBRID_RRF_K`, `KEYWORD_TS_CONFIG` |
| Rerank       | cross-encoder, graceful fallback              | `RERANK_ENABLED`, `RERANK_MODEL`, `RERANK_TOP_N` |
| Chunking     | article-aware (Saudi legal) + page fallback   | `CHUNK_ARTICLE_AWARE`, `CHUNK_MAX_CHARS`, `CHUNK_OVERLAP` |
| Guardrails   | refuse-out-of-corpus, injection, cost caps    | `GUARDRAIL_MIN_SCORE`, `GUARDRAIL_MAX_QUESTION_CHARS`, `GUARDRAIL_REQUIRE_CITATIONS` |
| Cache        | question-hash answer cache (TTL-LRU)          | `ANSWER_CACHE_ENABLED`, `ANSWER_CACHE_MAX_ENTRIES`, `ANSWER_CACHE_TTL_SECONDS` |
| Rate limit   | per bearer-token/IP token bucket              | `RATE_LIMIT_ENABLED`, `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_SEARCH_PER_MINUTE` |
| Observability| Prometheus `/metrics` + JSON logs             | `METRICS_ENABLED`, `LOG_JSON`, `LOG_LEVEL` |
| OCR          | pytesseract `ara` + pdf2image                 | `OCR_ENABLED`, `OCR_LANG`, `OCR_MIN_CHARS`, `OCR_DPI` |
| Vector store | pgvector / Postgres, cosine + tsvector        | `AI_DATABASE_URL`, `AI_EMBEDDING_DIM` |
| Corpus       | LEX API, else local manifest + PDFs           | `LEX_API_URL`, `LEX_API_TOKEN`, `LEX_TENANT_ID`, `LIBRARY_PATH`, `MANIFEST_PATH` |

---

## HTTP contract

| Method & path | Body / query | Response |
|---|---|---|
| `GET /health` | — | `{"status","indexed_docs","indexed_chunks","components":{db,embeddings,llm,reranker},"index":{...},"cache":{...}}` |
| `POST /ingest` | `{"force":false}` | `{"ingested_docs","chunks","skipped","failed","empty","ocr_pages","documents":[...]}` |
| `GET /search` | `?q=...&top_k=8&mode=hybrid` | `{"data":[{"doc_id","title_ar","title_en","snippet","score","page","article_no","article_label","chapter","part"}],"meta":{"count","mode"}}` |
| `POST /ask` | `{"question":"...","top_k":8,"doc_ids":[...]?,"mode":?,"no_cache":?}` | `{"answer","citations":[{...,"article_no","article_label"}],"model","latency_ms","usage","cached","grounded","refused"}` |
| `POST /ask/stream` | same as `/ask` | **SSE**: `event: token` deltas → final `event: citations` → `event: done` |
| `GET /metrics` | — | Prometheus exposition (request counts/latency, token usage, cache, refusals) |

- **The base contract is stable** (`/health`, `/ingest`, `/search`, `/ask`):
  every field added in this pass is additive; streaming is a *new* endpoint.
- **`/ask` never fabricates.** If the **selected provider is unconfigured** (no
  `ANTHROPIC_API_KEY` for `anthropic`, or no `AI_LLM_BASE_URL` for
  `openai_compatible`) → **HTTP 503** `{"error":"llm not configured"}`.
  Out-of-corpus → a 200 refusal
  (`refused:true`, "the reference library does not contain an answer…") with **no
  LLM call**. If the DB or embedding model is unavailable, endpoints return 503
  with an explanatory `{"error": ...}`.
- **Per-answer caching**: identical questions (same scope + model + corpus
  version) are served from an in-process TTL-LRU cache — `cached:true` in the
  response. A re-ingest transparently invalidates cached answers (the corpus
  version is folded into the cache key). Bypass with `"no_cache":true`.
- **Rate limiting**: per bearer-token (or client IP) token bucket; over-budget
  requests get **HTTP 429** + `Retry-After`.
- `/ingest` is **idempotent + incremental**: each document is keyed by a SHA-256
  of its bytes; unchanged docs are `skipped` unless `force=true`. Per-document
  status (`ingested` / `ocr_partial` / `empty` / `failed`) is tracked and
  surfaced in `documents[]` and `/health`.
- `citations` are the sources the answer actually references (parsed `[n]`
  markers), each carrying the Saudi-legal article locus when known.

### Streaming example

```bash
curl -N -X POST localhost:8000/ask/stream -H 'content-type: application/json' \
     -d '{"question":"ما هي الممارسات المحظورة بموجب نظام المنافسة؟"}'
# event: meta      {"cached":false,"sources":8}
# event: token     {"text":"وفقاً "}
# event: token     {"text":"للمادة ..."}
# event: citations {"citations":[...],"model":"claude-opus-4-8","usage":{...},"latency_ms":...}
# event: done      {}
```

---

## How ingestion sources the corpus

`app/rag/corpus.py::load_corpus_documents`:

- **`LEX_API_URL` set (preferred):** `GET {LEX_API_URL}/api/v1/lex/reference-library`
  for real `doc_id`s + metadata (matching the Go `ReferenceLibraryDocument`
  shape), then `GET .../{id}/download` for the bytes. Sends
  `Authorization: Bearer LEX_API_TOKEN` and `X-Tenant-ID: LEX_TENANT_ID` when set.
- **Local fallback (`LEX_API_URL` blank):** reads the manifest
  `reference_library_manifest.json` for metadata (doc_id keyed by manifest `code`
  or source filename) and the PDFs from `LIBRARY_PATH`. **If the manifest is
  absent**, it enumerates the PDF directory and infers `title_ar`/`category`/`tags`
  from filenames — so ingestion works even before the sibling manifest lands.

---

## Run it

### Option A — docker compose (one command)

```bash
cd ai/second-brain
export ANTHROPIC_API_KEY=sk-ant-...        # optional; omit and /ask returns 503
docker compose up --build                  # starts pgvector + the service on :8000

# in another shell — build the index, then query:
curl -X POST localhost:8000/ingest -H 'content-type: application/json' -d '{}'
curl 'localhost:8000/search?q=رسوم%20الأراضي%20البيضاء&top_k=5'
curl -X POST localhost:8000/ask -H 'content-type: application/json' \
     -d '{"question":"ما هي شروط تسجيل العلامة التجارية؟"}'
```

Compose bundles a `pgvector/pgvector:pg16` Postgres, mounts the local corpus
(`docs/ClarioWatheeq`) read-only, and persists the downloaded embedding model in
a volume. First `/ingest` downloads the embedding model (~2 GB incl. torch) and,
for scanned pages, uses the tesseract Arabic pack baked into the image.

### Option B — local (venv)

```bash
cd ai/second-brain
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# system deps for OCR (macOS):    brew install tesseract tesseract-lang poppler
# system deps for OCR (Debian):   apt-get install tesseract-ocr tesseract-ocr-ara poppler-utils

# a Postgres with pgvector, e.g.:
docker run -d --name sb-pg -p 5432:5432 \
  -e POSTGRES_USER=second_brain -e POSTGRES_PASSWORD=second_brain \
  -e POSTGRES_DB=second_brain pgvector/pgvector:pg16

cp .env.example .env   # then set ANTHROPIC_API_KEY (and AI_DATABASE_URL if needed)

python -m app.ingest --force              # build the index from the CLI
uvicorn app.main:app --reload --port 8000
```

### Wiring into lex-service

lex-service proxies Reference-Library **Ask/Search** here when `LEX_AI_SERVICE_URL`
is set (e.g. `http://127.0.0.1:8000`); unset ⇒ those routes return a clean 503
"second brain not configured". Local dev: set it in `.env.local` (read by
`ecosystem.local.js`); VPS: set it in `deploy/vps/clario360.env`.

---

## Sovereign / air-gapped deployment

This is a **sovereign KSA legal product**, so the data-residency of the LLM
matters. Two independent knobs make the Second Brain deployable entirely
in-Kingdom, with no runtime egress:

### 1. Pluggable LLM provider — keep inference in-Kingdom

Generation is abstracted behind a small provider interface (`app/rag/providers.py`)
so the LLM can be Anthropic **or** a self-hosted / KSA-resident model, chosen by
config with **no code change**. Embeddings + the reranker are already local
(sentence-transformers), so with an in-Kingdom LLM **every token of every
request** stays sovereign.

| `AI_LLM_PROVIDER` | Targets | Configure with |
|---|---|---|
| `anthropic` (default) | Claude via the `anthropic` SDK | `ANTHROPIC_API_KEY`, `AI_LLM_MODEL`, `AI_LLM_EFFORT` |
| `openai_compatible` | any OpenAI-format `/v1/chat/completions` server — **vLLM / TGI / Ollama / OpenAI**, i.e. a KSA-hosted **ALLaM / Jais / Falcon** | `AI_LLM_BASE_URL` (required), `AI_LLM_API_KEY` (optional for keyless local servers), `AI_LLM_MODEL` (served model name) |

Both providers use the **same** grounded/cite-only prompt and both **stream** the
SSE `/ask/stream`. If the selected provider is unconfigured, `/ask` returns the
usual **503 `llm not configured`** (never a fabricated answer); `/search` (no LLM)
works regardless. `/health` reports the active provider under `components.llm`.

**Configure a fully in-Kingdom deployment** (e.g. ALLaM served by vLLM on a
sovereign host):

```bash
AI_LLM_PROVIDER=openai_compatible
AI_LLM_BASE_URL=https://allam.gov.local/v1   # your in-Kingdom endpoint
AI_LLM_API_KEY=                              # optional; blank for keyless vLLM/Ollama
AI_LLM_MODEL=allam-2-7b                      # the served model name
# ANTHROPIC_API_KEY unset — no calls leave the Kingdom.
```

### 2. Offline / air-gapped model staging

The embedding (`AI_EMBEDDING_MODEL`) + reranker (`RERANK_MODEL`) models (~2 GB
incl. torch) are pulled from Hugging Face on first use. To need **no runtime
internet egress**, stage them ahead of time into the HF cache (`HF_HOME`) and run
with `HF_HUB_OFFLINE=1`. Three interchangeable ways:

```bash
# A. Local prefetch into HF_HOME (then ship / mount that cache):
make prefetch-models              # == python scripts/prefetch_models.py
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1   # at runtime, once staged

# B. Bake the models into the Docker image at build time:
make build-offline                # == docker build --build-arg PREFETCH_MODELS=true ...
#   then run the image with HF_HUB_OFFLINE=1 (compose passes it through).

# C. Mounted cache (no rebuild): populate a volume once, mount it read-only at
#   $HF_HOME on every replica, and set HF_HUB_OFFLINE=1. docker-compose.yml already
#   persists the model cache in the `sb_models` volume; pre-populate it with
#   `docker compose run --rm second-brain make prefetch-models`.
```

`scripts/prefetch_models.py` clears any `HF_HUB_OFFLINE` flag **for its own
download step** (staging is the one online moment), then downloads via
`huggingface_hub.snapshot_download` into `HF_HOME`. At runtime, with the cache
present and `HF_HUB_OFFLINE=1`, sentence-transformers resolves both models from
disk with zero network calls. `docker-compose.yml` exposes `PREFETCH_MODELS`
(build arg) and `HF_HUB_OFFLINE` / `TRANSFORMERS_OFFLINE` (runtime env).

## Observability

- **`GET /metrics`** — Prometheus exposition on a dedicated registry (no
  duplicate-registration panics under reload). Request counts + latency
  histograms per endpoint, Claude token usage (input/output), answer outcomes
  (`generated` / `cached` / `refused_out_of_corpus` / `refused_screen` / `error`),
  cache hit/miss/store, rate-limit rejections, retrieval mode + rerank usage,
  prompt-injection detections, and index size gauges.
- **Structured JSON logging** with a per-request id (`x-request-id`, generated or
  propagated) on every line — set `LOG_JSON=false` for human-readable dev output.
- **Rich `GET /health`** — top-level `status/indexed_docs/indexed_chunks` (stable)
  plus `components` (db / embeddings / llm[+`provider`] / reranker), `index` freshness
  (`last_ingested_at`, article/doc counts, failed-doc count), and `cache` stats.

## Evaluation

A curated Arabic Q&A eval set + scoring harness lives in [`eval/`](eval/README.md):
retrieval hit-rate, MRR, keyword coverage, citation F1, LLM-as-judge groundedness
(gated on a key), and an out-of-corpus refusal check. Run `python -m eval.run_eval`
against a live service. The scoring functions are pure and unit-tested offline.

## What is real vs what needs external resources

**Real and runnable as written** — the full pipeline is implemented (not stubs):
extraction, OCR + failure tracking, article-aware Arabic chunking, embedding,
pgvector storage + hybrid (cosine + tsvector) search, RRF fusion, the grounded
prompt with injection defence, the pluggable LLM provider (anthropic /
openai_compatible), streaming + non-stream generation, citation assembly,
guardrails (out-of-corpus refusal, cost caps), per-answer caching, rate limiting,
Prometheus metrics, JSON logging, idempotent incremental ingestion with a
manifest-driven article index, and every endpoint with correct 503 behaviour.
The pure-logic suite passes offline (`python -m pytest`); the full suite (incl.
FastAPI integration tests) passes with the runtime deps installed.

**Requires live infra to provide** (nothing is faked if absent — the service reports it):

| Dependency | Needed for | Without it |
|---|---|---|
| A configured LLM provider (`ANTHROPIC_API_KEY`, **or** `AI_LLM_BASE_URL` for `openai_compatible`) | `/ask`, `/ask/stream` (generation) + `--judge` eval | `/ask*` → 503 `{"error":"llm not configured"}`; `/search` still works |
| Embedding model download (~2 GB, first run) | `/search`, `/ask`, `/ingest` | those endpoints → 503 until the model loads |
| Reranker model (`RERANK_MODEL`, downloaded on first use) | retrieval reranking | falls back to the fused order (no crash) |
| Postgres + `vector` extension (`pgvector` image) | everything | endpoints → 503; `/health` → `degraded` |
| `tesseract` + `tesseract-ocr-ara` + `poppler` | OCR of scanned pages | scanned pages stay unsearchable + counted as `failed_pages` |
| Corpus (LEX API **or** local PDFs) | `/ingest` | 0 docs ingested |
| Prometheus scraper (optional) | `/metrics` dashboards | metrics still render; nothing scrapes them |

## Gaps / assumptions

- **Manifest not yet present** — the sibling agent writes
  `docs/ClarioWatheeq/reference_library_manifest.json`. Until then the local path
  enumerates PDFs and infers metadata from filenames (category/tags heuristics in
  `corpus.py`); once the manifest lands its richer metadata is used automatically.
- **LEX list shape** — the loader accepts both `{"data":[...]}` and a bare array,
  and keys `doc_id` off `id`/`doc_id`; verified against the Go DTO field names.
- **Embedding dimension must match the model.** `AI_EMBEDDING_DIM` (default 1024
  for e5-large) is baked into the `vector(N)` column; changing the model needs a
  matching dim and a re-ingest (the store warns on mismatch).
- **OCR is best-effort**, page-at-a-time at `OCR_DPI`; large scanned journals are
  slow. Keyword search uses the Postgres `'simple'` config (`KEYWORD_TS_CONFIG`) —
  no bundled Arabic stemmer exists, but it still gives exact-term recall that
  complements the semantic vector search; the reranker recovers ordering quality.
- **Article detection** anchors on line-start `المادة/مادة` + a number + a
  terminator, so inline references ("وفقاً للمادة الأولى…") don't create false
  boundaries. Ordinal parsing covers digits, teens, and ones+tens compounds; an
  unparsed label still keeps its raw article text in `article_label`.
- **Rate limiting** is in-process (single worker / last-line cost cap behind the
  gateway). For multi-replica enforcement, back `TokenBucketLimiter` with Redis —
  the `allow` contract is unchanged.
- The Go proxy contract also exposes `has_download` on list rows; this service
  only needs `id` + metadata for ingestion and does not depend on it.

## Tests

Pure-logic unit tests (no network, no model download, no DB) cover chunking,
article-aware chunking + ordinal parsing, RRF fusion, guardrails, the answer
cache, the rate limiter, citation assembly, eval scoring, and the **LLM provider
layer** (`tests/test_providers.py`: provider selection from config, prompt-builder
parity across anthropic vs openai_compatible, the graceful-unconfigured 503 path,
and token/usage streaming for both providers via injected fake SDKs — no server
required). Integration tests (FastAPI `TestClient`) exercise the HTTP contract,
guardrail refusals, the SSE shape, and the provider-aware `/ask` gate + `/health`
llm block — they skip automatically when FastAPI isn't installed, so a bare run of
the pure-logic suite still passes.

```bash
cd ai/second-brain
python -m pytest            # pure-logic suite (+ integration tests if deps present)
```

Self-check every module imports / byte-compiles:

```bash
python -m compileall app scripts eval
python -c "import app.main"   # needs the runtime deps installed
```
