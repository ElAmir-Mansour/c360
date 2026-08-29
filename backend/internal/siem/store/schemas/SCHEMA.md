# SIEM Store Schemas

This directory holds the **source of truth** for the SIEM index shape and
its PII contract. Three files matter:

| File | Purpose |
| ---- | ------- |
| `ecs-v8.11-mapping.json`     | OpenSearch index-template skeleton with the ECS 8.11 subset Clario uses. |
| `clario-ecs-extensions.json` | Clario-specific fields layered on ECS (CBN, tenant, data residency, intel matches, PII envelope). |
| `pii-fields.yaml`            | Canonical list of ECS paths considered PII under NDPA 2023 / CBN. |

## Versions

The active version is `ecs-8.11+clario-1.0`. The version string lives in
`ecs-v8.11-mapping.json._meta.schema_version` and is mirrored to every
OpenSearch index Clario creates. Phase 4 of SIEM-02 writes this string
into `siem.index_metadata.schema_version` so per-index migrations can be
gated on it.

Placeholders rewritten at template-creation time:

- `index_patterns: ["__siem_template_placeholder__"]` becomes
  `["siem-<tenant>-*"]`.
- `number_of_shards` / `number_of_replicas` are tenant-tier dependent
  (small tenants get 1/1, large tenants 3/2). The unit test for the
  store rewrite layer asserts that the literal placeholder is never
  written to OpenSearch.

## Adding a field

1. Edit `ecs-v8.11-mapping.json` (for ECS-spec fields) **or**
   `clario-ecs-extensions.json` (for Clario fields). New fields must be
   additive — type narrowing requires a separate phased migration with
   reindex.
2. Bump `_meta.schema_version` (`ecs-8.11+clario-1.0` → `ecs-8.11+clario-1.1`
   for compatible additions).
3. Open a PR. The schema-diff CI check confirms the change is additive
   and that the template still parses against an OpenSearch v2 dry-run.
4. After merge, the SIEM bootstrap calls `EnsureTemplate` on the next
   service start; existing indices remain on the old version and roll
   forward on next index rotation.

## Adding a PII path

1. Edit only `pii-fields.yaml` — never duplicate the path into the
   mapping. The mapping treats every field uniformly; encryption is
   driven solely by this manifest.
2. The PII schema hash (SHA-256 of the canonicalised YAML) is computed
   at boot and recorded in `siem.index_metadata.pii_schema_hash`. **A
   change to this file is intentionally a visible event**: every new
   index will record the new hash, regulator dashboards flag the change,
   and the SIEM audit log carries a row keyed on the new hash. Reviewers
   must confirm this is the intended outcome before merging.
3. Re-encryption of existing data is **not** automatic. Add a follow-up
   migration that issues `transit/rewrap` on affected indices if the
   regulator requires backfill.

## Versioning policy

- Additive changes (new ECS field, new PII path): minor bump
  (`clario-1.0` → `clario-1.1`).
- Type narrowing, field removal, or required-flag change: major bump
  with a paired migration that reindexes (`clario-1.x` → `clario-2.0`).
- Never rename a PII path silently — add the new name and deprecate the
  old in the same release, then remove in the following major.

## Out of scope here

- Document encryption (`crypto.EncryptDocument`) — owned by Phase 4 of
  SIEM-02 at `backend/internal/siem/store/crypto/`.
- Vault Transit client — owned by `backend/internal/vault/`. The schema
  layer is purely declarative; nothing in this directory imports Vault.
