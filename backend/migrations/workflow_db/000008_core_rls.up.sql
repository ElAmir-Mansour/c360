-- =============================================================================
-- WAVE-2 (GOVERNANCE/TENANCY) — FORCE ROW LEVEL SECURITY on the 5 CORE tables.
--
-- The core workflow tables (000001) historically DEFERRED row-level security:
-- tenant isolation was a single app-level `WHERE tenant_id = $n` clause in every
-- repository, so one missed clause == a cross-tenant leak. This migration closes
-- that gap by mirroring EXACTLY the RLS pattern the forms/SLA tables already use
-- (migrations/workflow_db/000004_approval_sla.up.sql):
--
--   * ENABLE + FORCE ROW LEVEL SECURITY, and
--   * per-operation policies (SELECT via USING, INSERT via WITH CHECK,
--     UPDATE via USING+WITH CHECK, DELETE via USING), each keyed on
--         tenant_id = current_setting('app.current_tenant_id', true)::uuid
--     with an
--         OR current_setting('app.bypass_rls', true) = 'on'
--     backstop so the leader-elected background workers (recovery / scheduler /
--     cron / event-trigger consumer) that legitimately scan ACROSS tenants can
--     operate under SET LOCAL app.bypass_rls = 'on'.
--
-- The retrofitted core repositories now execute every statement inside a
-- transaction that SET LOCAL app.current_tenant_id = '<uuid>' (tenant-scoped
-- calls) or SET LOCAL app.bypass_rls = 'on' (system/cross-tenant calls), via the
-- proven database.RunWithTenant / RunSystemTx helpers mirrored into the workflow
-- repository layer. When neither is set, current_setting(..., true) returns NULL,
-- NULL::uuid = anything is FALSE, and the row is invisible — the correct
-- fail-closed default.
--
-- Two of the five core tables (workflow_step_executions, workflow_trigger_
-- executions) both carry a tenant lineage: step-executions inherit their tenant
-- from the owning instance (they have no tenant_id column), while trigger-
-- executions carry an explicit tenant_id. The step-execution policy therefore
-- keys off the owning instance's tenant via a correlated EXISTS, so a step-exec
-- row is visible/writable iff its instance is — no schema change (no new column)
-- and no behavioural change for the bypass path.
--
-- Every statement is idempotent (ENABLE/FORCE are no-ops when already set;
-- policies use DROP POLICY IF EXISTS then CREATE, matching the 000004
-- convention). The migration is ADDITIVE and REVERSIBLE (see .down.sql).
-- The migration role must have BYPASSRLS. Requires no data migration.
-- =============================================================================

-- ============================================================
-- workflow_definitions (explicit tenant_id)
-- ============================================================
ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_definitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON workflow_definitions;
CREATE POLICY tenant_isolation ON workflow_definitions
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_insert ON workflow_definitions;
CREATE POLICY tenant_insert ON workflow_definitions
    FOR INSERT
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_update ON workflow_definitions;
CREATE POLICY tenant_update ON workflow_definitions
    FOR UPDATE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_delete ON workflow_definitions;
CREATE POLICY tenant_delete ON workflow_definitions
    FOR DELETE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );

-- ============================================================
-- workflow_instances (explicit tenant_id)
-- ============================================================
ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_instances FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON workflow_instances;
CREATE POLICY tenant_isolation ON workflow_instances
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_insert ON workflow_instances;
CREATE POLICY tenant_insert ON workflow_instances
    FOR INSERT
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_update ON workflow_instances;
CREATE POLICY tenant_update ON workflow_instances
    FOR UPDATE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_delete ON workflow_instances;
CREATE POLICY tenant_delete ON workflow_instances
    FOR DELETE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );

-- ============================================================
-- workflow_tasks (explicit tenant_id)
-- ============================================================
ALTER TABLE workflow_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_tasks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON workflow_tasks;
CREATE POLICY tenant_isolation ON workflow_tasks
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_insert ON workflow_tasks;
CREATE POLICY tenant_insert ON workflow_tasks
    FOR INSERT
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_update ON workflow_tasks;
CREATE POLICY tenant_update ON workflow_tasks
    FOR UPDATE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_delete ON workflow_tasks;
CREATE POLICY tenant_delete ON workflow_tasks
    FOR DELETE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );

-- ============================================================
-- workflow_trigger_executions (explicit tenant_id)
-- ============================================================
ALTER TABLE workflow_trigger_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_trigger_executions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON workflow_trigger_executions;
CREATE POLICY tenant_isolation ON workflow_trigger_executions
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_insert ON workflow_trigger_executions;
CREATE POLICY tenant_insert ON workflow_trigger_executions
    FOR INSERT
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_update ON workflow_trigger_executions;
CREATE POLICY tenant_update ON workflow_trigger_executions
    FOR UPDATE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_delete ON workflow_trigger_executions;
CREATE POLICY tenant_delete ON workflow_trigger_executions
    FOR DELETE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );

-- ============================================================
-- workflow_step_executions (NO tenant_id column — tenant is inherited from the
-- owning instance). The policy keys off the parent instance's tenant via a
-- correlated EXISTS so a step-exec row is visible/writable iff its instance is.
-- The bypass backstop keeps the cross-tenant worker/recovery paths intact.
-- ============================================================
ALTER TABLE workflow_step_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_executions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON workflow_step_executions;
CREATE POLICY tenant_isolation ON workflow_step_executions
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM workflow_instances i
            WHERE i.id = workflow_step_executions.instance_id
              AND i.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    );
DROP POLICY IF EXISTS tenant_insert ON workflow_step_executions;
CREATE POLICY tenant_insert ON workflow_step_executions
    FOR INSERT
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM workflow_instances i
            WHERE i.id = workflow_step_executions.instance_id
              AND i.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    );
DROP POLICY IF EXISTS tenant_update ON workflow_step_executions;
CREATE POLICY tenant_update ON workflow_step_executions
    FOR UPDATE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM workflow_instances i
            WHERE i.id = workflow_step_executions.instance_id
              AND i.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM workflow_instances i
            WHERE i.id = workflow_step_executions.instance_id
              AND i.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    );
DROP POLICY IF EXISTS tenant_delete ON workflow_step_executions;
CREATE POLICY tenant_delete ON workflow_step_executions
    FOR DELETE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM workflow_instances i
            WHERE i.id = workflow_step_executions.instance_id
              AND i.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    );
