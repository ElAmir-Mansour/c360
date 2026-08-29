-- =============================================================================
-- BPMN COMPOSITION — call-activity / sub-process + multi-instance (for-each).
--
-- Two new step types compose workflows out of workflows on the EXISTING durable
-- park/resume engine (no durable-execution rewrite):
--
--   * call_activity   — a step starts a CHILD instance from another definition,
--                       maps input variables in, PARKS the parent, and resumes it
--                       (mapping the child's outputs back) when the child COMPLETES;
--                       a child FAIL/incident propagates to the parent step.
--   * multi_instance  — a step resolves a COLLECTION and fans out N inner
--                       activities (child call-activities or inline sync sub-steps)
--                       under an all / any / n_of_m completion policy, aggregating
--                       child outputs into a result collection.
--
-- This migration is ADDITIVE, REVERSIBLE and IDEMPOTENT:
--   1. two nullable columns on workflow_instances (parent_instance_id /
--      parent_step_id) linking a CHILD instance back to the parent instance+step
--      that spawned it. NULL for every existing instance and every top-level
--      start, so legacy rows/paths are byte-for-byte unchanged.
--   2. a NEW workflow_mi_children table — the completion-counter fan-in ledger for
--      a multi_instance step: one row per fan-out child, recording its terminal
--      state so the parent step resumes exactly once when its policy is satisfied.
--
-- workflow_mi_children is a NEW table with no embedding-suite direct-SQL callers,
-- so RLS is FORCED here (exactly like workflow_substitutions in 000009). The
-- parent-link columns on workflow_instances add NO new policy — that table's RLS
-- is governed by 000008.
--
-- The migration role must have BYPASSRLS. Requires no data migration.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Parent -> child link on workflow_instances (additive, nullable).
-- ---------------------------------------------------------------------------
ALTER TABLE workflow_instances
    ADD COLUMN IF NOT EXISTS parent_instance_id UUID REFERENCES workflow_instances(id);
ALTER TABLE workflow_instances
    ADD COLUMN IF NOT EXISTS parent_step_id TEXT;

-- Resolve "children of this parent instance + step" (the fan-in lookup on a
-- child's completion) without a full scan. Partial: only parented children.
CREATE INDEX IF NOT EXISTS idx_workflow_instances_parent
    ON workflow_instances (parent_instance_id, parent_step_id)
    WHERE parent_instance_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Multi-instance fan-in ledger (completion counter).
--
-- One row per fan-out child of a multi_instance parent step. The parent step
-- parks; each child completion marks its row terminal and the engine re-checks
-- the policy. The UNIQUE (parent_instance_id, parent_step_id, child_index) key
-- makes fan-out idempotent (a recovered/replayed fan-out cannot double-insert).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_mi_children (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL,
    -- The multi_instance parent instance + step this child belongs to.
    parent_instance_id UUID        NOT NULL REFERENCES workflow_instances(id),
    parent_step_id     TEXT        NOT NULL,
    -- Deterministic 0-based index of this child within the resolved collection.
    child_index        INT         NOT NULL,
    -- The spawned child workflow instance (NULL for an inline sync sub-step child,
    -- which never becomes its own instance).
    child_instance_id  UUID        REFERENCES workflow_instances(id),
    -- Terminal state of this child from the parent's point of view.
    status             TEXT        NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'completed', 'failed')),
    -- The child's mapped output (aggregated into the parent result collection).
    output             JSONB,
    error_message      TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_workflow_mi_children_slot
        UNIQUE (parent_instance_id, parent_step_id, child_index)
);

CREATE INDEX IF NOT EXISTS idx_workflow_mi_children_parent
    ON workflow_mi_children (parent_instance_id, parent_step_id);

-- The child's completion looks the ledger up BY the child instance id.
CREATE INDEX IF NOT EXISTS idx_workflow_mi_children_child
    ON workflow_mi_children (child_instance_id)
    WHERE child_instance_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- FORCE RLS (new table, no embedding-suite direct-SQL callers). Mirrors the
-- exact per-operation policy shape workflow_substitutions (000009) uses: each
-- policy admits a row iff app.current_tenant_id matches OR app.bypass_rls='on'.
-- ---------------------------------------------------------------------------
ALTER TABLE workflow_mi_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_mi_children FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON workflow_mi_children;
CREATE POLICY tenant_isolation ON workflow_mi_children
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_insert ON workflow_mi_children;
CREATE POLICY tenant_insert ON workflow_mi_children
    FOR INSERT
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_update ON workflow_mi_children;
CREATE POLICY tenant_update ON workflow_mi_children
    FOR UPDATE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_delete ON workflow_mi_children;
CREATE POLICY tenant_delete ON workflow_mi_children
    FOR DELETE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
