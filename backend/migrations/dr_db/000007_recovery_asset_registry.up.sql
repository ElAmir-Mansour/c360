-- Recovery Asset Registry (D-10, the Cutover-Metastore analogue,
-- DESIGN_DataStream_DR.md §14.3). A versioned, structured recovery RUNBOOK is
-- generated from a consistency group's real assets — members (boot_order),
-- network mappings, the latest validated recovery point, and the group's
-- RPO/RTO objectives — by applying a template. The runbook self-maintains:
-- when group/site/mapping/recovery-point assets change, the generator
-- regenerates it and stores a new immutable version with a content hash and a
-- step-level diff against its predecessor.
--
-- dr_recovery_runbook        : one current runbook per consistency group.
-- dr_recovery_runbook_version: the immutable, append-only version history; each
--                              row is a full materialized step set + the diff
--                              (added/removed/reordered) from the prior version.

CREATE TABLE IF NOT EXISTS dr_recovery_runbook (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    -- current_version points at the newest dr_recovery_runbook_version.version.
    current_version INT NOT NULL DEFAULT 0,
    -- template_id records which template materialized the current version, so a
    -- template change is itself a regeneration trigger.
    template_id TEXT NOT NULL DEFAULT 'dr.standard.v1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- exactly one runbook per group (the asset registry is group-scoped).
    UNIQUE (group_id)
);

CREATE INDEX IF NOT EXISTS idx_dr_recovery_runbook_tenant
    ON dr_recovery_runbook (tenant_id, group_id);

CREATE TABLE IF NOT EXISTS dr_recovery_runbook_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    runbook_id UUID NOT NULL REFERENCES dr_recovery_runbook(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL,
    -- monotonic per runbook; version 1 is the first generation.
    version INT NOT NULL,
    template_id TEXT NOT NULL,
    -- the fully materialized, ordered runbook steps for this version.
    steps JSONB NOT NULL,
    -- the asset snapshot the steps were generated from (members, mappings, the
    -- pinned recovery point, objectives) — so a version is auditable and a diff
    -- can be recomputed deterministically.
    asset_snapshot JSONB NOT NULL,
    -- content hash over (template_id, steps): two versions with identical hashes
    -- are byte-identical runbooks, so a no-op regeneration is detectable.
    content_hash TEXT NOT NULL,
    -- the step-level diff from the immediately prior version (null for v1):
    -- {"added":[...],"removed":[...],"reordered":[...]}.
    diff JSONB,
    -- the asset change that triggered this regeneration (e.g. "membership",
    -- "recovery_point", "network_mapping", "manual"), for the audit trail.
    trigger TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (runbook_id, version)
);

CREATE INDEX IF NOT EXISTS idx_dr_recovery_runbook_version_runbook
    ON dr_recovery_runbook_version (runbook_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_dr_recovery_runbook_version_group
    ON dr_recovery_runbook_version (tenant_id, group_id, version DESC);

-- Tenant isolation: both tables are request-path readable and carry RLS, with
-- the app.bypass_rls backstop for the reconcile background loop (which consumes
-- datastream.dr.events across tenants), mirroring the §7 system-path rule.
ALTER TABLE dr_recovery_runbook ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_recovery_runbook FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_recovery_runbook_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_recovery_runbook_version FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_recovery_runbook;
DROP POLICY IF EXISTS tenant_insert ON dr_recovery_runbook;
DROP POLICY IF EXISTS tenant_update ON dr_recovery_runbook;
DROP POLICY IF EXISTS tenant_delete ON dr_recovery_runbook;

DROP POLICY IF EXISTS tenant_isolation ON dr_recovery_runbook_version;
DROP POLICY IF EXISTS tenant_insert ON dr_recovery_runbook_version;
DROP POLICY IF EXISTS tenant_update ON dr_recovery_runbook_version;
DROP POLICY IF EXISTS tenant_delete ON dr_recovery_runbook_version;

CREATE POLICY tenant_isolation ON dr_recovery_runbook
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_recovery_runbook
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_recovery_runbook
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_recovery_runbook
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON dr_recovery_runbook_version
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_recovery_runbook_version
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_recovery_runbook_version
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_recovery_runbook_version
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
