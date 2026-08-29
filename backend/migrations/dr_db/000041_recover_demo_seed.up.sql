-- =============================================================================
-- Clario Recover — ONBOARDING DEMO SEED LEDGER (Prompt 9).
--
-- Onboarding lets a tenant pick which Recover sub-solutions (IT DR, Cloud DR,
-- Cyber Recovery) to activate and, on activation, SEEDS realistic demo content
-- per selected sub-solution so the product lands populated and navigable (the
-- audit's P0 discoverability): >= 1 demo runbook template each plus sample
-- applications in the Application Metastore so the dashboards are non-empty.
--
-- The demo content is REAL records in the real tables (recover_metastore_*,
-- dr_studio_*) produced by the SAME real seeding paths a tenant uses by hand —
-- never hardcoded UI fixtures. This table is the LEDGER that makes that demo
-- content (a) idempotent to seed and (b) precisely and fully removable by the
-- one-click "remove demo data" action. Every demo entity created during seeding
-- records one row here keyed by (tenant_id, sub_solution, kind, ref_id); seeding
-- is a no-op when the rows already exist, and removal deletes exactly the
-- referenced entities and then these ledger rows.
--
-- `kind` distinguishes a Metastore application (deleting it cascades its owners /
-- environments / dependencies / cloud accounts / runbook links) from a Runbook
-- Studio runbook (deleting it cascades its tasks / runs / task-runs). `ref_id` is
-- a SOFT reference to the owning table's id (no cross-table FK — disjoint
-- ownership, exactly as the metastore runbook link references dr_studio_runbook).
--
-- RLS clone of the dr_db convention (migrations/dr_db/000036_recover_activation):
-- every request-path query filters by tenant AND runs under SET LOCAL
-- app.current_tenant_id, with RLS as the backstop; the app.bypass_rls escape
-- hatch is reserved for any cross-tenant system path, exactly as elsewhere in
-- dr_db.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One row per demo entity created for a tenant during sub-solution seeding.
-- sub_solution is constrained to the three stable Recover slugs; kind to the two
-- demo entity classes. The UNIQUE (tenant_id, kind, ref_id) makes the seed ledger
-- idempotent: re-seeding never duplicates a ledger row, and the seed flow skips a
-- sub-solution whose demo apps already exist.
CREATE TABLE IF NOT EXISTS recover_demo_seed_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    sub_solution TEXT NOT NULL
        CHECK (sub_solution IN ('it-dr','cloud-dr','cyber-recovery')),
    kind TEXT NOT NULL
        CHECK (kind IN ('metastore_application','runbook')),
    -- ref_id is the id of the demo entity in its owning table (a
    -- recover_metastore_application.id or a dr_studio_runbook.id). Soft reference.
    ref_id UUID NOT NULL,
    -- app_key is the demo application's stable business key (set for the
    -- metastore_application kind; the runbook kind records the app_key it was
    -- seeded for so removal and idempotency can group by application). Stored for
    -- idempotency lookups and human traceability.
    app_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, kind, ref_id)
);

-- The seed/idempotency/removal paths all read every demo row for a tenant (often
-- filtered by sub_solution); this index keeps those a single-tenant scan.
CREATE INDEX IF NOT EXISTS idx_recover_demo_seed_tenant
    ON recover_demo_seed_item (tenant_id, sub_solution);

-- Idempotency lookup: "does this tenant already have demo apps for this
-- sub-solution / app_key?" keys off (tenant_id, sub_solution, app_key).
CREATE INDEX IF NOT EXISTS idx_recover_demo_seed_app_key
    ON recover_demo_seed_item (tenant_id, sub_solution, app_key);

-- --- Row level security (clone of dr_db RLS convention) ---------------------

ALTER TABLE recover_demo_seed_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE recover_demo_seed_item FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recover_demo_seed_item;
DROP POLICY IF EXISTS tenant_insert ON recover_demo_seed_item;
DROP POLICY IF EXISTS tenant_update ON recover_demo_seed_item;
DROP POLICY IF EXISTS tenant_delete ON recover_demo_seed_item;
CREATE POLICY tenant_isolation ON recover_demo_seed_item
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON recover_demo_seed_item
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON recover_demo_seed_item
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON recover_demo_seed_item
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
