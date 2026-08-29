# WatheeqTech Reference Library — Implementation Design

**Status:** Design / ready-to-build
**Author:** Architecture (Watheeq / Lex)
**Date:** 2026-07-11
**Scope:** Ship the 33 Saudi legal reference PDFs (95 MB, currently at `docs/ClarioWatheeq/WatheeqTech Library/`) as a **read-only reference library** available to **every authenticated user across every tenant** on WatheeqTech (Watheeq), reusing the existing lex + file-service + frontend primitives rather than building new infrastructure.

This document is grounded in four verified subsystem studies (file-service, cross-tenant content pattern, frontend library/PDF UX, and lex-domain anatomy). Every mechanism cited below was checked against source; file:symbol references are load-bearing.

---

## 0. TL;DR — the three decisions the build hinges on

| # | Decision | Recommendation | Why |
|---|----------|----------------|-----|
| **D-1 Storage** | Where the 95 MB of bytes live | **Object store via the existing platform `file-service`** (MinIO in prod / `local` backend in dev), uploaded once under a canonical *library tenant*. NOT git, NOT `lex_db` bytea, NOT a naive static mount. | Reuses streaming, SHA-256 integrity, ClamAV scan, per-access audit log, presigned URLs, and the finished frontend blob client — zero of that is rebuilt (`file_service.go:Upload/Download`). Fallback (§2.4) if the platform team won't touch file-service in P0: lex streams from a read-only mounted volume via `http.ServeContent`. The catalog schema makes that swap invisible to the frontend. |
| **D-2 Cross-tenant** | One global copy vs. seed-per-tenant | **Single GLOBAL catalog table, no `tenant_id`, read by all.** | Content is identical public Saudi law for every tenant and is read-only. A global table is one `UPSERT` on updates; per-tenant seeding duplicates 33×N rows (and, worse, blobs), must re-run on every tenant onboard, and risks tenants soft-deleting shared law. The cross-tenant study found **no** existing global primitive — it must be built, and global is the correct shape. |
| **D-3 Viewer** | Native iframe vs. add pdf.js | **P0: reuse the existing native-`<iframe>` `DocumentViewer`** (`document-viewer.tsx:88`) — zero new dependencies, renders born-digital Arabic PDFs correctly today. **P2 (optional): add `pdfjs-dist`** only if in-PDF search / thumbnails / article deep-links / reliable rendering of scanned مجلة قضاء issues are required, backed by an OCR `extracted_text` sidecar. | `package.json` today has `mammoth` + `monaco` but **no** `react-pdf`/`pdfjs-dist`. The native viewer is the shipped, tested path. Adding pdf.js is a real dependency + bundle cost — defer until product proves the need. |

Net new work is small and contained: a global `reference_library_documents` table + a 6-file lex slice (model/repo/service/handler/dto/routes) + a one-time ingestion job + a read-only `/lex/library` frontend page. Everything else is reused.

---

## 1. Corpus — the 33 PDFs

Titles are **Arabic** (filenames carry a `_copy.pdf` suffix from the working copy). Three corpus classes, with a bilingual two-level taxonomy: a top-level `category` bucket and a finer `doc_type`.

| `category` (bilingual) | `doc_type` values | Count |
|---|---|---|
| `systems-regulations` — الأنظمة واللوائح | `system`, `regulation` | 10 |
| `judicial-journal` — مجلة قضاء | `judicial-journal` | 5 |
| `research` — البحوث والدراسات | `research` | 18 |

### 1.a Systems & Regulations (نظام / لائحة) — 10
Each is a law (**نظام**) usually bundled with its executive regulation (**لائحة**); the two `أنظمة…` items are multi-law compendia.

| # | title_ar | title_en (working) |
|---|----------|--------------------|
| 1 | نظام الاستثمار ولائحته التنفيذية | Investment Law & its Executive Regulation |
| 2 | نظام المحاماة ولوائحه التنفيذية | Code of Law Practice & its Regulations |
| 3 | نظام المرافعات أمام ديوان المظالم ولائحته التنفيذية | Law of Procedure before the Board of Grievances & its Regulation |
| 4 | نظام المنافسة ولائحته التنفيذية | Competition Law & its Executive Regulation |
| 5 | نظام الهيئة العامة للولاية على أموال القاصرين ومن في حكمهم | Law of the General Authority for Guardianship of Minors' Funds |
| 6 | نظام رسوم الأراضي البيضاء والعقارات الشاغرة | White Land & Vacant Property Fees Law |
| 7 | نظام ملكية الوحدات العقارية وفرزها وإدارتها | Law of Ownership, Partition & Management of Real-estate Units |
| 8 | نظام هيئة الرقابة ومكافحة الفساد | Law of the Oversight & Anti-Corruption Authority (Nazaha) |
| 9 | أنظمة الزكاة وضريبة القيمة المضافة والتصرفات العقارية | Zakat, VAT & Real-estate Transactions — statutes (compendium) |
| 10 | أنظمة جرائم الوظيفة العامة والأموال | Public-office & Public-funds Crimes — statutes (compendium) |

### 1.b Judicial Journal (مجلة قضاء) — 5
Ministry of Justice quarterly. Issues **38, 39, 40, 41, 43** (note: 42 absent). Older issues may be **scanned/image-only** → flag for the P2 OCR sidecar.

| # | title_ar | title_en | `metadata.issue` |
|---|---|---|---|
| 11 | مجلة قضاء العدد 38 | Qadaa Journal, Issue 38 | 38 |
| 12 | مجلة قضاء العدد 39 | Qadaa Journal, Issue 39 | 39 |
| 13 | مجلة قضاء العدد 40 | Qadaa Journal, Issue 40 | 40 |
| 14 | مجلة قضاء العدد 41 | Qadaa Journal, Issue 41 | 41 |
| 15 | مجلة قضاء العدد 43 | Qadaa Journal, Issue 43 | 43 |

### 1.c Research & Studies (بحوث ودراسات) — 18
Academic/practitioner legal research papers.

| # | title_ar | title_en (working) |
|---|---|---|
| 16 | أحكام رجوع الكفيل على المدين | Rules of the Guarantor's Recourse against the Debtor |
| 17 | أثر القرائن الفقهية في ترجيح الدعوى المالية | Effect of Jurisprudential Presumptions on Weighing Financial Claims |
| 18 | التوقيع على بياض | Signing on Blank |
| 19 | الحماية القانونية لحق المساهم في الإعلام | Legal Protection of the Shareholder's Right to Information |
| 20 | الحماية القضائية للمتضرر في القضاء الإداري السعودي | Judicial Protection of the Aggrieved in Saudi Administrative Justice |
| 21 | الدفوع الموضوعية في دعاوى الأحوال الشخصية غير الزوجية | Substantive Defenses in Non-marital Personal-status Suits |
| 22 | الطعن في الأحكام القضائية | Appeal against Judicial Rulings |
| 23 | المسؤولية الطبية في ضوء النظام السعودي | Medical Liability under the Saudi System |
| 24 | الميثاق العائلي في نظام الشركات | The Family Charter under the Companies Law |
| 25 | أحكام العزل من نظارة الوقف | Rules of Dismissal from Waqf Custodianship |
| 26 | تمويل التقاضي | Litigation Funding |
| 27 | جدلية الاستقالة في عقود العمل | The Resignation Dialectic in Labour Contracts |
| 28 | حالة التشريعات في المملكة العربية السعودية | The State of Legislation in the Kingdom |
| 29 | دعوى عدم استحقاق السند التنفيذي | Claim of Non-entitlement of an Enforcement Instrument |
| 30 | ضمانات أطراف الدعوى | Guarantees of the Parties to a Suit |
| 31 | ما يلزم التسبيب له من وسائل الإثبات وإجراءاته | Means & Procedures of Evidence Requiring Reasoning |
| 32 | مسالك تسبيب الأحكام القضائية | Approaches to Reasoning Judicial Rulings |
| 33 | معايير حماية العلامة التجارية وإجراءات تسجيلها | Standards of Trademark Protection & Registration |

The authoritative machine-readable manifest (Appendix A) carries `title_ar`, `title_en`, `category`, `doc_type`, `authority`, `tags`, and the source filename for each of the 33 — it is the single source the ingestion job iterates.

---

## 2. Storage — where the bytes live (D-1)

### 2.1 Not git
The 95 MB working copy at `docs/ClarioWatheeq/WatheeqTech Library/` must **not** be committed. It ships into the object store once (ingestion), then is `.gitignore`d (§8.4). Rationale: binary bloat in history, and the bytes are deploy-artifacts, not source.

### 2.2 Recommended: the platform file-service object store
Physical bytes belong in the existing **`file-service`** (`cmd/file-service`, HTTP `:8091`, gateway route `/api/v1/files` → `GW_SVC_URL_FILE`), which already owns *all* lex document/contract/attachment bytes. It stores objects in MinIO bucket `clario360-lex` under key `{tenant_id}/{suite}/{YYYY}/{MM}/{uuid}.{ext}` (`pkg/storage/key_generator.go:GenerateStorageKey` — verified: `{tenant}/{suite}/%04d/%02d/{uuid}{ext}`, original filename never in key). Only metadata lands in the `files` table in **platform_core** (`migration 000010`). A `local` filesystem backend (`pkg/storage/local_storage.go`) means dev works without MinIO.

**Upload path (reused verbatim):** `POST /api/v1/files/upload` multipart field `file` → `FileService.Upload` does magic-byte validation (PDF is allow-listed for `suite=lex`), SHA-256 checksum, optional dedup-by-checksum, optional AES envelope encryption, `GenerateStorageKey`, `ensureBucket`, `store.Upload`, persists the `FileRecord` (status `pending`), emits `com.clario360.file.uploaded` for the async ClamAV consumer, and returns the record with its `id`. The 33 PDFs pass validation and dedup for free.

**Why this over lex-local storage:** everything the study calls "free" — streaming in 32 KB chunks, `X-Checksum-SHA256`, virus-scan status gating, `file_access_log` per-access audit, presigned URLs, and the finished frontend `enterpriseApi.files.download()` blob client — is reused. No byte plumbing is rebuilt.

### 2.3 Cross-tenant read (the one real gap in file-service)
File-service is **tenant-scoped end-to-end**: `FileRepository.GetByID` runs `WHERE id=$1 AND tenant_id=$2` inside `database.RunReadWithTenant` (RLS `SET LOCAL app.current_tenant_id`). A file uploaded under one tenant is invisible to all others. There is **no** public/anonymous path. The `is_public` column exists everywhere (`model/file.go:32`, dto, repo) but is **dead** — verified written `false` at `file_service.go:232` and never read/branched on. Two ways to bridge to an all-tenant library:

- **Option A — lex reference-library `Download` proxies file-service (recommended for P0, zero platform blast radius).** The global catalog (below) holds the `file_id` + the canonical *library tenant* id. The lex `ReferenceLibraryHandler.Download` (gated on `lex:read`) resolves the row, then makes a **server-to-server** call to file-service *as the library tenant* (service token + `X-Tenant-ID` of the library tenant), streaming the bytes back to the caller. File-service is untouched; the only tenant that "owns" the bytes is the library tenant; every user reads through the lex endpoint. Cross-tenant policy lives entirely in lex.
- **Option B — activate the dead `is_public` flag as a platform primitive (cleaner long-term, wider blast radius).** Add a public-read branch to `FileRepository.GetByID`/`FileService.Download`: when `is_public=true`, resolve **without** the `tenant_id` predicate (bypass RLS via the existing `app.bypass_rls` path in `tenant_context.go`), gated behind a new perm. Changes only the authz predicate; upload/stream/checksum/scan and the frontend client are reused verbatim. Prefer this once the platform team can own a shared-service change; it revives an intended-but-inert column.

**Recommendation:** ship **Option A** in P0 (lex owns the cross-tenant decision, no shared-service edit), and migrate to **Option B** in P1/P2 if other suites want public files too. Both leave the catalog and frontend identical.

### 2.4 Fallback: lex-local mounted volume
If file-service is off the table for P0, the lex-anatomy path applies: mount the corpus read-only at a deploy volume keyed by `storage_key`; `ReferenceLibraryHandler.Download` streams via `http.ServeContent` with `Content-Type: application/pdf`. This is fully self-contained in lex-service but loses checksum/scan/audit/dedup and reinvents streaming. The catalog's `byte_source` discriminator (§3) makes A ↔ fallback a config swap, invisible to the frontend.

### 2.5 Ingestion path (one-time, per environment)
A one-time idempotent job (`cmd/reference-library-seed` or `make seed-reference-library`) — **not** run on every boot — does, for each of the 33 manifest rows:
1. Upload the PDF to file-service under the **library tenant**, `suite=lex` (dedup-by-checksum makes re-runs no-ops); capture the returned `file_id` + `checksum_sha256` + `size_bytes`.
2. `UPSERT` the catalog row (by `content_hash`) with the metadata from the manifest + the captured `file_id`.

Bytes are never re-uploaded per service boot (you don't want a 95 MB dependency to make the FATAL startup path flaky — `cmd/lex-service/main.go:221` `logger.Fatal` on seed error). See §5.4 for why this is a dedicated job, not the per-tenant demo seeder.

---

## 3. Data model — the global catalog (D-2)

### 3.1 Why a new global table, not the existing lex library
The cross-tenant study is decisive: `ClauseLibraryItem`/`RegulationLibraryItem` (`model/library.go`) both carry `TenantID`, every `library_repo.go` query filters `WHERE tenant_id=$1`, and migration `000003` keys them `UNIQUE(tenant_id,code,version)` under `FORCE ROW LEVEL SECURITY tenant_isolation`. They are **mutable** (POST/PUT/DELETE + governance) and start **empty per tenant**. Reusing them for shared law would (a) duplicate rows 33×N, (b) let a tenant soft-delete or edit shared law, and (c) pollute the tenant-scoped uniqueness key. So: a **separate, read-only, global** table.

`RegulationLibraryItem`'s *field shape* is nonetheless near-perfect and is copied (verified: `TitleEN/TitleAR`, `DescriptionEN/AR`, `Jurisdiction`, `Authority`, `Source`, `SourceURL`, `RegulationType`, `Tags`, `Metadata`, audit cols).

### 3.2 Table: `reference_library_documents` (lex_db, migration `000080`)
Global — **no `tenant_id`**. Lives in `lex_db` (the catalog); byte metadata (`file_id`) points cross-DB by UUID into file-service's `platform_core.files` (no FK — consistent with how lex already stores `file_id` opaquely, `model.LegalDocument.FileID`).

```sql
CREATE TABLE reference_library_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_ar      TEXT NOT NULL,
  title_en      TEXT NOT NULL DEFAULT '',
  description_ar TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL,            -- systems-regulations | judicial-journal | research
  doc_type      TEXT NOT NULL,            -- system | regulation | judicial-journal | research
  jurisdiction  TEXT NOT NULL DEFAULT 'SA',
  authority     TEXT NOT NULL DEFAULT '', -- e.g. وزارة العدل, هيئة المنافسة
  source        TEXT NOT NULL DEFAULT '',
  source_url    TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  -- byte binding
  byte_source   TEXT NOT NULL DEFAULT 'file-service', -- file-service | volume
  file_id       UUID,          -- file-service files.id (Option A/B)
  storage_key   TEXT,          -- volume key (fallback §2.4)
  library_tenant_id UUID,      -- canonical owner tenant for Option A proxy
  file_size_bytes BIGINT,
  content_hash  TEXT,          -- SHA-256, dedup + integrity display
  -- lifecycle
  published     BOOLEAN NOT NULL DEFAULT true,
  version       INT NOT NULL DEFAULT 1,
  hijri_date    TEXT,          -- optional issuance date (Hijri), free text
  gregorian_date DATE,         -- optional
  metadata      JSONB NOT NULL DEFAULT '{}', -- e.g. {"issue":"39"} for مجلة قضاء
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- bilingual full-text (mirrors idx_regulation_library_search; 'simple' config,
-- consistent with existing lex FTS — no Arabic stemming, adequate for 33 docs)
CREATE INDEX idx_reference_library_search ON reference_library_documents
  USING GIN (to_tsvector('simple',
    coalesce(title_ar,'')||' '||coalesce(title_en,'')||' '||
    coalesce(description_ar,'')||' '||coalesce(description_en,'')||' '||
    array_to_string(tags,' ')));
CREATE INDEX idx_reference_library_category ON reference_library_documents(category, doc_type);
CREATE UNIQUE INDEX uq_reference_library_hash ON reference_library_documents(content_hash)
  WHERE content_hash IS NOT NULL;   -- makes the ingestion UPSERT idempotent

-- RLS defensive posture: enable but keep a permissive read policy so the table
-- is safe if RLS is ever activated platform-wide (today RLS is inert on the
-- owner/superuser lex pool — app-layer SQL is the real control).
ALTER TABLE reference_library_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY reference_library_read ON reference_library_documents FOR SELECT USING (true);
-- NO insert/update/delete policy for tenant roles → writes only via owner/ingest.
```

**Down migration** drops the table (both `.up.sql` and `.down.sql` are required — golang-migrate refuses otherwise and a bad migration is FATAL on lex-service boot, `main.go:71-72`).

> **⚠️ Migration number:** next free is **`000080`** (highest today is `000079_contract_org_entity`, verified). `ui_revamp` has a concurrent auto-committer/pusher (project memory) — **re-check the highest `NNNNNN` at authoring time** and bump if 000080 was taken.

### 3.3 Title / date mapping
- `title_ar` = the Arabic title (primary; corpus is Arabic-first). `title_en` = working English (Appendix A) — optional, improves EN-locale browse.
- `authority` = issuing body (e.g. `وزارة العدل` for مجلة قضاء, `الهيئة العامة للمنافسة` for نظام المنافسة).
- `hijri_date`/`gregorian_date` = optional issuance/effective date; free-text Hijri accommodates law datelines.
- `metadata.issue` carries the مجلة قضاء issue number (`38…43`) for sort/filter.
- `tags` = topical (e.g. `["عقاري","ملكية"]`, `["تحكيم","إثبات"]`) driving faceted browse.

---

## 4. Access & RBAC

### 4.1 Read = every authenticated Watheeq user
Backend reads gate on **`auth.PermLexRead` = `lex:read`** (`rbac.go:24`, verified), via `read := r.With(sharedmw.RequirePermission(auth.PermLexRead))` (`routes.go:274`). Per the cross-tenant study, **13 of 14** `LegalAffairsRoleDefs` carry `lex:read` (plus viewer/analyst/tenant_admin) — so a route on `lex:read` is instantly visible to nearly all personas with **zero RBAC work**.

**Gap to flag:** the config-only `legal-system-admin` role lacks `lex:read`. If the product wants *literally every* role (and non-legal users on non-Watheeq tenants) to see the library, add a dedicated slug **`lex:reference:view`**:
- add const `PermLexLibraryView = "lex:reference:view"` in `rbac.go`, register `lexDomainVerbs["reference"] = {"view"}` (line 434) so `lex:*` / `admin:*` wildcards keep resolving (`HasPermission`, line 544),
- gate routes `RequireAnyPermission(PermLexLibraryView, PermLexRead)` so existing roles never regress,
- grant `lex:reference:view` to all 14 `LegalAffairsRoleDefs` (`legal_roles.go`).

**Recommendation:** P0 gate on `lex:read` (ship instantly); add `lex:reference:view` in P1 only if universal-including-`legal-system-admin` access is a requirement.

### 4.2 Manage / upload = admins only, out-of-band
There is **no** tenant-facing write surface. The 33 rows and their bytes are provisioned by the ingestion job (§2.5) run by an operator. No POST/PUT/DELETE routes are exposed for the reference library — the read-only guarantee is structural (no write handlers, no tenant write RLS policy), not merely convention.

---

## 5. Backend — the lex reference-library slice

Follows the verified 6-file lex-domain anatomy: `model/` + `repository/` + `service/` + `handler/` + `dto/` + `routes.go`, wired centrally in `app.go`, running under `cmd/lex-service`. Copy the library slice and **strip all write/governance methods and every `tenant_id` predicate**.

### 5.1 Routes (`handler/routes.go`, inside `registerLexHandlers`)
Add `ReferenceLibrary *ReferenceLibraryHandler` to `RouteDependencies`, then under the `read` tier (line 274):
```go
read.Get("/reference-library",              deps.ReferenceLibrary.List)     // list + facets
read.Get("/reference-library/search",       deps.ReferenceLibrary.Search)   // FTS (title/desc/tags)
read.Get("/reference-library/{id}",         deps.ReferenceLibrary.Get)      // single row
read.Get("/reference-library/{id}/download", deps.ReferenceLibrary.Download) // stream bytes
```
`registerLexHandlers` is mounted under **both** `/api/v1/lex` and `/api/v1/watheeq` (verified `routes.go:196-245`), so every route is dual-prefixed for free. No write routes exist.

### 5.2 Files to add
| File | Contents |
|---|---|
| `backend/internal/lex/model/reference_library.go` | `ReferenceLibraryDocument` struct + `ReferenceLibraryListFilters{Search, Category, DocType, Tag, Page, PerPage}` — copy `library.go` shapes, drop `TenantID`, governance, `SupersedesID`. |
| `backend/internal/lex/repository/reference_library_repo.go` | `NewReferenceLibraryRepository(db, logger)`; `List`/`Get`/`Search` using the existing `queryListJSON[T]`/`queryRowJSON[T]` + `COUNT`+GIN/ILIKE+LIMIT/OFFSET pattern. **No `tenant_id` predicate** — filter `deleted_at IS NULL AND published`. Raw pool (mirrors `library_repo.go`). |
| `backend/internal/lex/service/reference_library_service.go` | `NewReferenceLibraryService(repo, logger)`; `List`/`Get`/`Search`/`GetForDownload`. **No publisher** (read-only). `pgx.ErrNoRows → notFoundError`. |
| `backend/internal/lex/handler/reference_library_handler.go` | Embeds `baseHandler`. `List`/`Search`/`Get` via `suiteapi.ParsePagination`+`WritePaginated`/`WriteData`. `Download` resolves the row then streams — Option A: server-to-server file-service call under `library_tenant_id`; fallback: `http.ServeContent` from the volume. Reads never touch `userID`. |
| `backend/internal/lex/dto/reference_library_dto.go` | List/search filter DTO with `Normalize()`; a small `ReferenceLibraryDocumentDTO` response shape. |

### 5.3 `app.go` wiring — 4 edits (anchors verified)
1. Struct field on `Application` (near `LibraryHandler`, ~line 168).
2. Construct service (near `service.NewLibraryService`, **line 396**): `refLibSvc := service.NewReferenceLibraryService(store.ReferenceLibraries, deps.Logger)`.
3. Construct handler (near `NewLibraryHandler`, **line 1414**): `app.ReferenceLibraryHandler = handler.NewReferenceLibraryHandler(refLibSvc, deps.Logger)`.
4. Populate the `RouteDependencies` literal (near line 1528): `ReferenceLibrary: a.ReferenceLibraryHandler`.
Add the repo to the store aggregate alongside `store.Libraries`.

### 5.4 Migration + ingestion seeder (the 33 docs)
- **Migration** `000080_reference_library.(up|down).sql` per §3.2. Runs on lex-service startup (`runMigrations`, `main.go:71`, FATAL on error).
- **Ingestion is a dedicated one-shot job, NOT the per-tenant demo seeder.** The per-tenant `seedDataset.run` (`seed.go:114`) defaults to a single `seedTenantID`/`apexLegalTenantID` (`seed.go:24/27`) and is gated on `SeedDemoData` — wrong for a **global, run-once** dataset. Instead add `cmd/reference-library-seed` (or a lex Makefile target) that:
  1. count-guards: `SELECT count(*) FROM reference_library_documents` — if already 33, no-op (idempotent, safe to re-run);
  2. for each manifest row, uploads the PDF to file-service (dedup-by-checksum) and `UPSERT`s the catalog row by `content_hash`.
  The 33 rows' metadata (`title_ar/en`, `category`, `doc_type`, `authority`, `tags`) is hard-coded from Appendix A, exactly like `seedRegulations` builds a `[]dto.Create…Request` slice (`seed.go:926`). Because the table is global, seed **once**, not per tenant — this eliminates the tenants-shim dependency (`migrations/lex_db/000001:9`) and the new-tenant re-seed hook entirely.
- **Idempotency is mandatory:** every row must satisfy the NOT NULL/CHECK constraints, and re-runs must be no-ops, or the operator step fails loudly (but never the FATAL boot path, since ingestion is decoupled from startup).

---

## 6. Frontend — `/lex/library`

### 6.1 Page: a read-only twin of `documents/page.tsx`
Assemble from existing primitives with **zero new rendering tech** (per the frontend study):
- **Chrome:** `LexListShell` (`components/lex/list-shell.tsx:89`) — PageHeader + KPI slot + filter container + framed body, RTL/locale-driven — plus `LexKpiStrip` (`kpi-strip.tsx:104`) with Arabic-Indic number formatting (tiles: total docs, per-category counts).
- **Listing/search/filter:** `DataTable` + `useDataTable` (server pagination, column filters, CSV, density/column toggles) with a `searchSlot`; a **table/cards ViewToggle**; a **category/doc_type facet tree** (reuse the `RepositoryFolderTree` pattern for the three corpus classes); a **metadata-vs-contents search-mode toggle** (contents mode is dark until P2 FTS lands).
- **Saved views:** the server-backed `SavedViewsBar` (`lib/lex/saved-views.ts` → `/api/v1/lex/saved-views`) with a new namespace `'lex-library'` — reuse as-is. (Do **not** copy clause-library's legacy localStorage saved-views.)
- **Data source:** new `enterpriseApi.lex.listReferenceLibrary()` / `searchReferenceLibrary()` / `getReferenceLibraryDownload()` in `lib/enterprise/api.ts`, mirroring `lex.listRegulations` (`api.ts:2179`).

Bilingual/RTL side-sheet flipping, KPI localization, and empty/loading states all come for free.

### 6.2 Viewer (D-3)
**P0 — reuse the shared `DocumentViewer`** (`components/shared/document-viewer.tsx`): its PDF branch is a native browser `<iframe src={url}>` (`:88`; comment `:44` "browsers render PDFs natively — no pdfjs"). Wrap it in a **stripped read-only variant of `LexDocumentPreviewSheet`**: keep download / open-in-new-tab / copy-link / find-in-document / integrity strip; **drop** check-out/snapshot/editor/version-write actions.

**Byte feeding for a global corpus:** the existing preview uses a *presigned* URL (`files.getPresignedDownload`), but presigned is tenant-scoped and blocked for encrypted files — wrong for the global library. Instead the library viewer fetches the stream from `GET /api/v1/lex/reference-library/{id}/download` as a **Blob** and feeds `URL.createObjectURL(blob)` to the `DocumentViewer` `url` prop (same blob technique `enterpriseApi.files.download()` already uses). This sidesteps file-service's forced `Content-Disposition: attachment` (`file_handler.go:118`) — the blob object-URL renders inline in the iframe regardless.

**P2 (optional) — add `pdfjs-dist`** as a new `DocumentViewer` `pdfjs` branch behind the same props, only if in-PDF text search, page thumbnails, article→page deep-links, or reliable rendering of **scanned** مجلة قضاء issues is required. Pair with an OCR-derived `extracted_text` sidecar (mirrors how DOCX already uses `mammoth`, `lib/documents/word.ts:28`). Ship an Arabic webfont for the extracted-text `<pre>` fallback (project memory: app shell lacks one; the native iframe is unaffected).

### 6.3 Nav entry
Add to the `lex-knowledge-group` section (`config/navigation.ts:903`, next to `lex-documents`):
```ts
{ id: 'lex-library', label: 'Reference Library', href: '/lex/library',
  icon: Library, permission: LEX_ROUTE_PERMISSIONS['/lex/library'] }
```
and register the route permission in `lib/permissions.ts:99` (`LEX_ROUTE_PERMISSIONS`), mirroring the catalog entries (`'/lex/clause-library': { anyOf: ['lex:catalog:view','lex:contract:view'] }`, `'/lex/regulations': { anyOf: ['lex:catalog:view','lex:audit:read'] }`):
```ts
'/lex/library': { anyOf: ['lex:reference:view', 'lex:read'] },
```
Using `anyOf` with `lex:read` as fallback keeps it visible to all personas today; the `lex:reference:view` first element lights up if/when §4.1's dedicated slug is added. `tier: 'business-plus'`.

---

## 7. Search phasing

| Phase | Capability | Mechanism |
|---|---|---|
| **P0 — metadata search** | Search/filter by `title_ar/en`, `category`, `doc_type`, `tags`, `authority`; facet tree by corpus class. | The `idx_reference_library_search` GIN (`to_tsvector('simple', …)`) + ILIKE + tag filters — the exact `library_repo.go` search pattern. Adequate for 33 docs. |
| **P1 — filters + saved views** | Advanced facets (issue number, authority, year), server-backed `SavedViewsBar('lex-library')`, CSV export, quick filters. | Reuse `useDataTable` filters + `/api/v1/lex/saved-views`. Optional `lex:reference:view` slug rollout. |
| **P2 — full-text + AI Q&A ("Second Brain")** | Extract per-PDF body text → FTS over content; then RAG Q&A over the corpus. | **Later phase.** Requires an OCR/extraction step storing an `extracted_text` sidecar per doc (scanned مجلة قضاء issues need OCR). Q&A ties to the **FastAPI AI runtime** (AI suite) — embed the corpus, expose a "ask the library" endpoint. Note: `'simple'` FTS does no Arabic stemming; P2 should evaluate an Arabic analyzer or embedding-based retrieval. This is a distinct workstream, not blocking P0/P1. |

---

## 8. Implementation plan

### 8.1 P0 — shippable read-only library (smallest slice)
**Backend:** `000080_reference_library.(up|down).sql`; `model/reference_library.go`; `repository/reference_library_repo.go` (List/Get/Search); `service/reference_library_service.go`; `handler/reference_library_handler.go` (List/Search/Get/Download); 4 `app.go` edits; 4 `read.Get` routes in `routes.go`. Gate on `lex:read`. Byte path = Option A (lex proxies file-service under the library tenant) **or** fallback volume.
**Ingestion:** `cmd/reference-library-seed` — upload 33 PDFs + UPSERT 33 catalog rows (count-guarded, idempotent). Manifest = Appendix A.
**Frontend:** `/lex/library/page.tsx` (LexListShell + LexKpiStrip + DataTable + facet tree + SearchInput metadata-mode); read-only `DocumentViewer` sheet fed by blob object-URL; nav entry + `LEX_ROUTE_PERMISSIONS['/lex/library']`; `enterpriseApi.lex.*ReferenceLibrary*`.
**Verify:** every legal persona sees `/lex/library`; a user on tenant B streams a PDF uploaded under the library tenant (proves cross-tenant read); Arabic titles render RTL; download works.

### 8.2 P1 — polish
Facets (issue/authority/year), server `SavedViewsBar('lex-library')`, cards/board toggle, CSV export; optional `lex:reference:view` slug + grant to all 14 roles + `legal-system-admin`; optionally migrate byte path to Option B (`is_public` platform primitive).

### 8.3 P2 — Second Brain
OCR/extraction sidecar; content FTS; `pdfjs-dist` viewer branch (thumbnails/in-PDF search/deep-links); AI Q&A over the corpus on the FastAPI AI runtime; Arabic webfont for extracted-text surfaces.

### 8.4 Git hygiene (do this the moment bytes are in the object store)
- Add to `.gitignore`: `docs/ClarioWatheeq/WatheeqTech Library/` (and any `*_copy.pdf`).
- Confirm no PDF was ever staged: `git ls-files 'docs/ClarioWatheeq/WatheeqTech Library/'` must be empty; if the 95 MB was accidentally committed, scrub from history before merge.
- Keep in git: the tiny **manifest** (Appendix A as `reference_library_manifest.json`) and the ingestion job source — **never** the bytes.

### 8.5 Risks / honest gaps
- **RLS is inert on the live box** (owner/superuser connection, project memory) — the global table's real isolation is that it has *no secrets* and app SQL never filters tenant; the `USING(true)` policy is defensive only. Documented so a future RLS activation doesn't zero-out the library.
- **Scanned مجلة قضاء issues** may have no text layer → unsearchable and (rarely) poorly rendered until the P2 OCR sidecar. Born-digital Arabic PDFs render fine in the native iframe today.
- **Migration-number collision** with the ui_revamp auto-committer — re-verify `NNNNNN` at authoring time.
- **Cross-DB `file_id`** (lex_db catalog → platform_core `files`) has no FK by design; the ingestion job is the integrity owner.

---

## Appendix A — 33-document manifest (source for the ingestion job)
For each: `source_filename` (the `…_copy.pdf` under `docs/ClarioWatheeq/WatheeqTech Library/`), `title_ar`, `title_en`, `category`, `doc_type`, `authority`, `tags[]`, `metadata`. Categories: §1.a systems-regulations (10, `doc_type` system/regulation), §1.b judicial-journal (5, `metadata.issue` = 38/39/40/41/43), §1.c research (18). This manifest is the single source the §5.4 ingestion job iterates and the only corpus artifact committed to git (as `reference_library_manifest.json`) — the 95 MB of bytes are not.
