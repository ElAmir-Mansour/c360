-- 000003_dr_bridge: bind Migrate waves/cutovers to REAL DR Runbook Studio
-- objects. Wave 1 carried inert opaque UUID columns (parent_runbook_id,
-- runbook_run_id) with no service reading/writing them. Wave 2 makes them real
-- links to the DR engine's runbooks and runs and records every binding in an
-- audit table so a wave can regenerate its runbook without losing prior versions.
--
-- The IDs are opaque cross-database references (dr_db owns the runbook/run rows;
-- migrate_db only stores their UUIDs), so there are intentionally NO foreign-key
-- constraints to dr_db here. dr-service guarantees their uniqueness/existence.

-- Wave: link to the generated parent runbook + the consistency/topology group it
-- depends on. parent_runbook_id (000001) stays as the wave's authored/legacy
-- runbook pointer; dr_runbook_id is the Wave-2 GENERATED parent runbook in DR.
ALTER TABLE migrate_wave
    ADD COLUMN IF NOT EXISTS dr_runbook_id UUID,
    ADD COLUMN IF NOT EXISTS dr_topology_group_id UUID,
    ADD COLUMN IF NOT EXISTS runbook_generated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_migrate_wave_dr_runbook
    ON migrate_wave (tenant_id, dr_runbook_id)
    WHERE dr_runbook_id IS NOT NULL;

-- Cutover window: link to the DR runbook for this cutover and the live run.
-- runbook_run_id (000001) is retained for backward compatibility; dr_runbook_id
-- + dr_run_id are the explicit Wave-2 links the live tracker reads.
ALTER TABLE migrate_cutover_window
    ADD COLUMN IF NOT EXISTS dr_runbook_id UUID,
    ADD COLUMN IF NOT EXISTS dr_run_id UUID;

CREATE INDEX IF NOT EXISTS idx_migrate_window_dr_run
    ON migrate_cutover_window (tenant_id, dr_run_id)
    WHERE dr_run_id IS NOT NULL;

-- Rollback plan: reuse runbook_id (000001) as the dr_runbook_id of an isolated
-- rollback runbook. No column change required; documented here for completeness.

-- Move group: link to a DR topology consistency group so Migrate can proxy the
-- move-group dependency/failover view through the Topology API.
ALTER TABLE migrate_move_group
    ADD COLUMN IF NOT EXISTS dr_topology_group_id UUID;

-- Audit trail: every binding of a Migrate entity (wave/window/move-group) to a
-- DR runbook + run, with the generation source and a status. Replayed generation
-- inserts a new row (a new dr_runbook_id) without destroying the prior binding.
CREATE TABLE IF NOT EXISTS migrate_runbook_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL REFERENCES migrate_program(id) ON DELETE CASCADE,
    wave_id UUID REFERENCES migrate_wave(id) ON DELETE CASCADE,
    window_id UUID REFERENCES migrate_cutover_window(id) ON DELETE CASCADE,
    move_group_id UUID REFERENCES migrate_move_group(id) ON DELETE SET NULL,
    -- dr_runbook_id is the DR Studio runbook this entity binds to (opaque ref).
    dr_runbook_id UUID NOT NULL,
    -- dr_run_id is the live run started for this binding (null until started).
    dr_run_id UUID,
    -- role distinguishes a wave's parent runbook from a per-move-group child
    -- runbook so the generated structure is reconstructable from the audit trail.
    role TEXT NOT NULL DEFAULT 'parent'
        CHECK (role IN ('parent','child','rollback')),
    -- parent_binding_id links a child move-group runbook to its wave parent.
    parent_binding_id UUID REFERENCES migrate_runbook_binding(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'generated'
        CHECK (source IN ('authored','generated','imported')),
    status TEXT NOT NULL DEFAULT 'generated'
        CHECK (status IN ('generated','running','completed','failed','superseded')),
    -- ordinal is the deterministic execution order of this runbook within its
    -- wave (the topological position of the move group), 0 for the parent.
    ordinal INT NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One active run per window per runbook (allows regeneration: a superseded
    -- row keeps its dr_runbook_id, a new row gets a fresh one).
    UNIQUE (tenant_id, window_id, dr_runbook_id),
    UNIQUE (tenant_id, wave_id, dr_runbook_id)
);

CREATE INDEX IF NOT EXISTS idx_migrate_runbook_binding_wave
    ON migrate_runbook_binding (tenant_id, wave_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_migrate_runbook_binding_window
    ON migrate_runbook_binding (tenant_id, window_id);
CREATE INDEX IF NOT EXISTS idx_migrate_runbook_binding_parent
    ON migrate_runbook_binding (parent_binding_id);

ALTER TABLE migrate_runbook_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_runbook_binding FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_select ON migrate_runbook_binding FOR SELECT
    USING ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON migrate_runbook_binding FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON migrate_runbook_binding FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON migrate_runbook_binding FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
