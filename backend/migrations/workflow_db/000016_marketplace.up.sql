-- =============================================================================
-- Phase 5 (moat) — Governed template/connector MARKETPLACE (CTO H3 ask + the
-- sovereign wedge). Until now the engine had a data-driven template CATALOG
-- (workflow_templates, migration 000005) but NO marketplace lifecycle: no
-- versioned/provenance-bearing catalog, no publish→review→install governance, no
-- gallery. This migration introduces the marketplace CATALOG and the INSTALL
-- ledger.
--
-- Decision (storage): two engine-owned tables in workflow_db, reusable by every
-- suite (matching the 000005 workflow_templates convention):
--
--   workflow_marketplace_items    — the versioned gallery. A row with
--     tenant_id IS NULL is a GLOBAL, platform-published item (e.g. the ~76
--     seeded legal/DR packs) visible to every tenant; a non-null tenant_id is a
--     tenant-published private item. MANY versions per (tenant, kind, key):
--     uniqueness is on (COALESCE(tenant,''), kind, key, version). semver is
--     stored decomposed (major/minor/patch) so ORDER BY is a plain integer sort,
--     with the raw string kept for display/round-trip.
--
--   workflow_marketplace_installs — the install PROVENANCE ledger: which
--     marketplace item+version a tenant installed, and (for a template) the
--     workflow_definition it instantiated. Idempotent install is enforced by a
--     UNIQUE (tenant, item_id) — re-installing the same item+version is a no-op
--     upsert, a different version is an explicit upgrade (same row, new version).
--
-- RLS NOTE: like workflow_templates (000005) and for the SAME reason — a tenant's
-- browse must read BOTH the global (tenant_id IS NULL) rows and its own rows in
-- one query, which a FORCE-RLS USING (tenant_id = current_setting) policy cannot
-- express without a bypass — these two tables are INTENTIONALLY NOT FORCE-RLS'd.
-- The repository filters by tenant_id in SQL (globals ∪ own) exactly as the
-- template repository does. Every statement is idempotent + reversible.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Marketplace items (versioned gallery)
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_marketplace_items (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- tenant_id NULL == a GLOBAL, platform-published item visible to every
    -- tenant; a non-null value scopes it to one tenant's private marketplace.
    tenant_id        UUID,
    -- kind: 'template' (payload is a WorkflowDefinition blueprint the installer
    -- instantiates) or 'connector' (payload is a connector manifest the installer
    -- registers/records).
    kind             TEXT        NOT NULL DEFAULT 'template'
                     CHECK (kind IN ('template', 'connector')),
    -- key is the stable, human-readable identity of the item across versions
    -- (e.g. "tmpl-regulatory-change-monitoring"). (tenant, kind, key) groups all
    -- versions of one logical item.
    key              TEXT        NOT NULL,
    -- bilingual display strings: {"ar": "...", "en": "..."}.
    title_i18n       JSONB       NOT NULL DEFAULT '{}',
    description_i18n JSONB       NOT NULL DEFAULT '{}',
    category         TEXT        NOT NULL DEFAULT '',
    -- tags: JSON array of free-form labels (e.g. ["legal","ksa","compliance"]).
    tags             JSONB       NOT NULL DEFAULT '[]',
    -- semver, stored decomposed for a cheap integer ORDER BY plus the raw string
    -- for display / round-trip. version_major/minor/patch drive version ordering.
    version          TEXT        NOT NULL DEFAULT '1.0.0',
    version_major    INT         NOT NULL DEFAULT 1,
    version_minor    INT         NOT NULL DEFAULT 0,
    version_patch    INT         NOT NULL DEFAULT 0,
    -- maturity lifecycle label (independent of the publish/install status).
    maturity         TEXT        NOT NULL DEFAULT 'ga'
                     CHECK (maturity IN ('draft', 'beta', 'ga', 'deprecated')),
    publisher        TEXT        NOT NULL DEFAULT '',
    -- payload: the WorkflowDefinition JSON (kind=template) or the connector
    -- manifest JSON (kind=connector) the installer acts on.
    payload          JSONB       NOT NULL DEFAULT '{}',
    -- provenance: where the item came from and the tamper-evidence hash of the
    -- payload at publish time.
    source           TEXT        NOT NULL DEFAULT '',
    checksum         TEXT        NOT NULL DEFAULT '',
    published_by     TEXT        NOT NULL DEFAULT '',
    published_at     TIMESTAMPTZ,
    -- status: the publish/review lifecycle of THIS version. 'draft' -> a
    -- published-but-unreviewed version; 'published' -> reviewed & installable;
    -- 'installed' is tracked per-tenant on the installs ledger, not here.
    status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published', 'deprecated')),
    -- four-eyes review stamps: the distinct approver who cleared the version.
    reviewed_by      TEXT,
    reviewed_at      TIMESTAMPTZ,
    review_reason    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A logical item (tenant scope + kind + key) may hold MANY versions, but each
-- exact version is unique. COALESCE the NULL global tenant to '' so two global
-- versions of the same key collide (as intended) while different tenants may
-- publish the same key independently.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_marketplace_items_version
    ON workflow_marketplace_items (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, key, version);

-- Browse patterns: by kind, by category, and the "list globals" fast path.
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_items_kind
    ON workflow_marketplace_items (kind);
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_items_category
    ON workflow_marketplace_items (category);
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_items_tenant
    ON workflow_marketplace_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_items_global
    ON workflow_marketplace_items (kind, category)
    WHERE tenant_id IS NULL;
-- Version ordering per logical item (newest first).
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_items_key_semver
    ON workflow_marketplace_items (kind, key, version_major DESC, version_minor DESC, version_patch DESC);

-- ============================================================
-- Marketplace installs (install provenance ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_marketplace_installs (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- the tenant that installed the item. NOT NULL (installs are always tenant
    -- scoped, even when the source item is global).
    tenant_id          UUID        NOT NULL,
    -- the marketplace item VERSION that was installed (FK to items). ON DELETE
    -- RESTRICT is intentionally NOT set (items table has no cascade), the id link
    -- is the provenance record even if the source version is later deprecated.
    marketplace_item_id UUID       NOT NULL,
    kind               TEXT        NOT NULL DEFAULT 'template'
                       CHECK (kind IN ('template', 'connector')),
    -- item identity snapshot at install time (so provenance survives even if the
    -- source item row is later changed).
    item_key           TEXT        NOT NULL DEFAULT '',
    item_version       TEXT        NOT NULL DEFAULT '',
    -- for kind=template: the workflow_definition this install instantiated.
    definition_id      UUID,
    -- for kind=connector: the recorded connector manifest key.
    connector_key      TEXT,
    installed_by       TEXT        NOT NULL DEFAULT '',
    installed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent install: one install row per (tenant, marketplace item version).
-- Re-installing the same item+version is a no-op upsert; upgrading to another
-- version is a separate install row referencing the new item version. The
-- (tenant, kind, item_key) upgrade path is resolved in the service.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_marketplace_installs_item
    ON workflow_marketplace_installs (tenant_id, marketplace_item_id);

CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_installs_tenant_key
    ON workflow_marketplace_installs (tenant_id, kind, item_key);
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_installs_definition
    ON workflow_marketplace_installs (definition_id)
    WHERE definition_id IS NOT NULL;

-- Install provenance also stamped ON the created definition so a definition row
-- self-describes its marketplace origin (additive, nullable — legacy rows and
-- hand-authored definitions leave these NULL).
ALTER TABLE workflow_definitions
    ADD COLUMN IF NOT EXISTS marketplace_item_id UUID;
ALTER TABLE workflow_definitions
    ADD COLUMN IF NOT EXISTS marketplace_item_version TEXT;
