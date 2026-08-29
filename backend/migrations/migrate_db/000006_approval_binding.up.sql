-- =============================================================================
-- Workflow-backed approval binding for Clario Migrate (Wave 5, H2).
--
-- Replaces Migrate's local-only DecideMoveGroup status flip (the "bypass the
-- spec forbids") with a binding into the SHARED workflow engine. When an approval
-- is REQUESTED for a migrate approval subject (a move group, a cutover go/no-go
-- gate, or a rollback plan) Migrate opens a human-task approval workflow INSTANCE
-- in the workflow engine (cmd/workflow-engine, separate service + separate
-- workflow_db) over its internal HTTP API and records the linkage here. The
-- workflow decision (task completion) then drives the local FSM through this
-- binding — Migrate never runs a second approval engine.
--
-- The workflow_instance_id / workflow_definition_id are OPAQUE references into
-- workflow_db (the workflow engine owns those rows); migrate_db only records the
-- linkage + the mirrored terminal decision so the local FSM and the audit trail
-- are reconstructable from Migrate's own database.
-- =============================================================================

CREATE TABLE IF NOT EXISTS migrate_approval_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL REFERENCES migrate_program(id) ON DELETE CASCADE,
    -- subject_type distinguishes which migrate approval gate this binding serialises.
    -- move_group is the H2 primary path; gate (window go/no-go) and rollback_plan
    -- reuse the exact same envelope so every migrate approval routes through the
    -- shared engine rather than a per-gate local flip.
    subject_type TEXT NOT NULL
        CHECK (subject_type IN ('move_group', 'gate', 'rollback_plan')),
    subject_id UUID NOT NULL,
    -- The workflow engine's instance id (a string UUID it assigns) + the definition
    -- it was started from, kept for audit/replay. These are opaque refs into
    -- workflow_db; migrate_db does not FK across the service boundary.
    workflow_instance_id TEXT NOT NULL,
    workflow_definition_id TEXT NOT NULL,
    -- The human-task step id inside the workflow whose completion carries the
    -- decision. Recorded so the callback/sync reads the right step_outputs entry.
    workflow_step_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'cancelled', 'failed')),
    -- decision mirrors the workflow's terminal outcome, normalised to migrate's
    -- vocabulary (approved | rejected). NULL until the workflow completes.
    decision TEXT
        CHECK (decision IS NULL OR decision IN ('approved', 'rejected')),
    rationale TEXT NOT NULL DEFAULT '',
    -- decided_by is the actor the workflow engine reports on task completion
    -- (the approver), NOT the migrate user who requested the approval.
    decided_by UUID,
    decided_at TIMESTAMPTZ,
    -- requested_by is the migrate user who opened the approval workflow.
    requested_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One ACTIVE (pending) binding per subject at a time is enforced by a partial
    -- unique index below; a completed/cancelled binding is retained for audit and
    -- a fresh request can supersede it.
    UNIQUE (tenant_id, workflow_instance_id)
);

-- One in-flight approval per subject: a subject can have many terminal (completed/
-- cancelled/failed) bindings in its history but only one pending at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_migrate_approval_binding_active_subject
    ON migrate_approval_binding (tenant_id, subject_type, subject_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_migrate_approval_binding_instance
    ON migrate_approval_binding (tenant_id, workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_migrate_approval_binding_subject
    ON migrate_approval_binding (tenant_id, subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_migrate_approval_binding_pending
    ON migrate_approval_binding (tenant_id, created_at)
    WHERE status = 'pending';

ALTER TABLE migrate_approval_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_approval_binding FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_select ON migrate_approval_binding FOR SELECT
    USING ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON migrate_approval_binding FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON migrate_approval_binding FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON migrate_approval_binding FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
