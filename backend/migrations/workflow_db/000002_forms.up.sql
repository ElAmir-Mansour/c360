-- =============================================================================
-- Forms engine — workflow_db (DESIGN_Workflow_Forms_Automation.md §3.2, WP-3).
--
-- workflow_forms is the canonical, bilingual, validated, conditional
-- form-definition store that the workflow human-task step and the FE dynamic
-- renderer consume. A row carries the audit/version columns in their own
-- columns; the bilingual content (locales, default_locale, fields) lives in the
-- `fields` JSONB body, matching internal/forms.FormDefinition. UNIQUE
-- (tenant_id, name, version) versions a form by name within a tenant.
--
-- RLS: this is a NEW, RLS-aware table (the forms store runs every request under
-- database.RunWithTenant / a tenant transaction), so it carries FULL
-- per-operation tenant RLS — the standard 4-policy set (SELECT via the default
-- USING policy, plus FOR INSERT / FOR UPDATE / FOR DELETE) each backstopped by
-- the app.bypass_rls escape hatch for system/migration paths. This mirrors the
-- house convention used by migrations/dr_db/000016_runbook_studio and
-- platform_core/000002_rls. The pre-existing workflow_* tables from
-- 000001_init_schema intentionally remain NON-forced (their repositories are not
-- yet RunWithTenant-aware); that retrofit is deferred and is unaffected here.
-- =============================================================================

-- gen_random_uuid() requires pgcrypto; idempotent no-op so apply-from-scratch
-- (the migration idempotency test) succeeds on a bare database.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS workflow_forms (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    name          TEXT        NOT NULL,
    version       INT         NOT NULL DEFAULT 1,
    -- The bilingual FormDefinition body: {locales, default_locale, fields[]}.
    fields        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name, version)
);

CREATE INDEX IF NOT EXISTS idx_workflow_forms_tenant
    ON workflow_forms (tenant_id);

CREATE INDEX IF NOT EXISTS idx_workflow_forms_tenant_name
    ON workflow_forms (tenant_id, name);

-- Full per-operation tenant RLS with the app.bypass_rls backstop.
ALTER TABLE workflow_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_forms FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON workflow_forms;
DROP POLICY IF EXISTS tenant_insert ON workflow_forms;
DROP POLICY IF EXISTS tenant_update ON workflow_forms;
DROP POLICY IF EXISTS tenant_delete ON workflow_forms;

CREATE POLICY tenant_isolation ON workflow_forms
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON workflow_forms
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON workflow_forms
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON workflow_forms
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
