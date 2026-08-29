-- =============================================================================
-- Clario Recover — SUB-SOLUTION ACTIVATION.
--
-- Clario Recover is one product with three sub-solutions (IT DR, Cloud DR,
-- Cyber Recovery). Licensing ENTITLEMENT (whether a tenant MAY use a
-- sub-solution) lives in the licensing engine and is resolved at request time —
-- this table never duplicates it. What this table persists is the tenant's own
-- ACTIVATION choice: which sub-solutions they have explicitly turned on so they
-- surface in navigation and dashboards. A sub-solution can be entitled but not
-- yet activated (offered to enable) or activated. Onboarding (Prompt 9) writes
-- these rows; the products endpoint merges them with the live entitlement state.
--
-- This table carries the dr_db RLS clone (migrations/dr_db/000035_dr_integrations):
-- every request-path query filters by tenant AND runs under SET LOCAL
-- app.current_tenant_id, with RLS as the backstop; the app.bypass_rls escape
-- hatch is reserved for any cross-tenant system path, exactly as elsewhere in
-- dr_db.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One row per (tenant, sub-solution) recording the tenant's activation choice.
-- sub_solution is constrained to the three stable Recover slugs so a typo can
-- never create an orphan surface.
CREATE TABLE IF NOT EXISTS recover_sub_solution_activation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    sub_solution TEXT NOT NULL
        CHECK (sub_solution IN ('it-dr','cloud-dr','cyber-recovery')),
    activated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, sub_solution)
);

-- The products endpoint reads every activation row for a tenant; this index
-- keeps that lookup a single-tenant scan.
CREATE INDEX IF NOT EXISTS idx_recover_activation_tenant
    ON recover_sub_solution_activation (tenant_id);

-- --- Row level security (clone of dr_db RLS convention) ---------------------

ALTER TABLE recover_sub_solution_activation ENABLE ROW LEVEL SECURITY;
ALTER TABLE recover_sub_solution_activation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recover_sub_solution_activation;
DROP POLICY IF EXISTS tenant_insert ON recover_sub_solution_activation;
DROP POLICY IF EXISTS tenant_update ON recover_sub_solution_activation;
DROP POLICY IF EXISTS tenant_delete ON recover_sub_solution_activation;
CREATE POLICY tenant_isolation ON recover_sub_solution_activation
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON recover_sub_solution_activation
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON recover_sub_solution_activation
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON recover_sub_solution_activation
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
