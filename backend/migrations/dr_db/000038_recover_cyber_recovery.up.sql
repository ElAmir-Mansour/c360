-- =============================================================================
-- Clario Recover — CYBER RECOVERY clean-room recovery flow.
--
-- The Cyber Recovery sub-solution composes the existing dr/* services (clean
-- room, cyber vault, ransomware detection, clean points, immutable proof). What
-- this migration adds is the persistent state of the DISTINGUISHING clean-room
-- RECOVERY FLOW that those services do not themselves own:
--
--   select last-known-good clean point
--     -> provision to a clean / bare-metal target
--     -> run runbook recovery
--     -> MANDATORY integrity-check gate (clean-room scan must pass)
--     -> explicit approval before "return to production network".
--
-- The integrity gate is a HARD, SERVER-SIDE blocker: a flow can only reach
-- `returned_to_production` once (a) its latest clean-room scan verdict is CLEAN
-- AND (b) an authorized approver has signed off. The approval sign-off is
-- recorded here with full provenance (who, when, against which clean-room scan)
-- so the return-to-production decision is auditable for regulators.
--
-- Recovery LOGIC is NOT duplicated: the clean-room scan that gates the flow is
-- produced by internal/dr/cleanroom (dr_cleanroom_scan); ransomware signals come
-- from internal/dr/ransomware (dr_ransomware_signals); the clean point is a row
-- in the shared recovery_point table. This table only persists the flow's own
-- orchestration state and links to those rows by id.
--
-- RLS clone of the dr_db convention (migrations/dr_db/000036_recover_activation):
-- every request-path query filters by tenant AND runs under SET LOCAL
-- app.current_tenant_id; the app.bypass_rls escape hatch is reserved for any
-- system path, exactly as elsewhere in dr_db.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One row per clean-room recovery flow. `phase` is the flow's state-machine
-- position; the CHECK constraint makes an out-of-band phase impossible. The
-- integrity-gate columns (integrity_scan_id, integrity_verdict) and the
-- approval columns (approved_by, approved_at, ...) are NULL until those steps
-- complete; the service enforces that BOTH are populated and consistent before
-- a flow may advance to `returned_to_production`.
CREATE TABLE IF NOT EXISTS recover_cyber_recovery_flow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Selected last-known-good clean point (a recovery_point row) and its group.
    clean_point_id UUID NOT NULL,
    group_id UUID NOT NULL,

    -- Target the clean point is provisioned to (clean room / bare-metal host).
    target_label TEXT NOT NULL CHECK (length(btrim(target_label)) > 0),
    target_kind  TEXT NOT NULL DEFAULT 'clean_room'
        CHECK (target_kind IN ('clean_room','bare_metal','isolated_vpc')),

    -- State-machine position. Phases are linear with two terminal failure exits
    -- (integrity_failed re-runnable, aborted terminal).
    phase TEXT NOT NULL DEFAULT 'clean_point_selected'
        CHECK (phase IN (
            'clean_point_selected',
            'provisioning',
            'provisioned',
            'recovering',
            'recovered',
            'integrity_checking',
            'integrity_passed',
            'integrity_failed',
            'awaiting_approval',
            'approved',
            'returned_to_production',
            'aborted'
        )),

    -- Optional runbook executed during the recovery step (composed runbookstudio
    -- run); kept as a free link so the flow does not fork runbook logic.
    runbook_run_id TEXT,

    -- MANDATORY integrity gate: the clean-room scan that gates this flow and its
    -- terminal verdict. NULL until the gate has been run at least once.
    integrity_scan_id   UUID,
    integrity_verdict   TEXT
        CHECK (integrity_verdict IS NULL OR integrity_verdict IN ('clean','malware','integrity_failed','error')),
    integrity_checked_at TIMESTAMPTZ,
    integrity_detail    TEXT NOT NULL DEFAULT '',

    -- Approval sign-off provenance for return-to-production. NULL until an
    -- authorized approver signs off. approved_for_scan_id pins the approval to a
    -- specific integrity scan so a stale approval cannot be replayed against a
    -- newer, dirtier scan.
    approved_by          UUID,
    approved_by_email    TEXT,
    approved_at          TIMESTAMPTZ,
    approval_note        TEXT NOT NULL DEFAULT '',
    approved_for_scan_id UUID,

    -- Who returned the flow to production, and when (set only on success).
    returned_by UUID,
    returned_at TIMESTAMPTZ,

    -- Free-text reason captured when a flow is aborted.
    abort_reason TEXT NOT NULL DEFAULT '',

    -- Optimistic-concurrency guard: a phase transition checks and bumps this so
    -- two operators acting on the same flow cannot lose-update each other.
    version BIGINT NOT NULL DEFAULT 1,

    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant-scoped list (newest first) — the dashboard's flow inventory.
CREATE INDEX IF NOT EXISTS idx_recover_cyber_flow_tenant_created
    ON recover_cyber_recovery_flow (tenant_id, created_at DESC);

-- Active-flow lookup by clean point (one in-flight flow surfaced per point).
CREATE INDEX IF NOT EXISTS idx_recover_cyber_flow_clean_point
    ON recover_cyber_recovery_flow (tenant_id, clean_point_id);

-- --- Append-only phase transition log (provenance / audit) ------------------
-- Every phase transition writes one immutable row here: who moved the flow from
-- which phase to which, when, and a structured detail blob (e.g. the integrity
-- verdict or the approval note). There is intentionally no UPDATE/DELETE path —
-- the service only ever INSERTs — so the recovery decision trail is tamper
-- evident for audit. Enforced at the service layer and proven by test.
CREATE TABLE IF NOT EXISTS recover_cyber_recovery_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    flow_id UUID NOT NULL
        REFERENCES recover_cyber_recovery_flow (id) ON DELETE CASCADE,
    from_phase TEXT NOT NULL,
    to_phase   TEXT NOT NULL,
    actor_id    UUID,
    actor_email TEXT,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recover_cyber_event_flow
    ON recover_cyber_recovery_event (tenant_id, flow_id, created_at);

-- --- Row level security (clone of dr_db RLS convention) ---------------------

ALTER TABLE recover_cyber_recovery_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE recover_cyber_recovery_flow FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recover_cyber_recovery_flow;
DROP POLICY IF EXISTS tenant_insert ON recover_cyber_recovery_flow;
DROP POLICY IF EXISTS tenant_update ON recover_cyber_recovery_flow;
DROP POLICY IF EXISTS tenant_delete ON recover_cyber_recovery_flow;
CREATE POLICY tenant_isolation ON recover_cyber_recovery_flow
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON recover_cyber_recovery_flow
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON recover_cyber_recovery_flow
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON recover_cyber_recovery_flow
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE recover_cyber_recovery_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE recover_cyber_recovery_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recover_cyber_recovery_event;
DROP POLICY IF EXISTS tenant_insert ON recover_cyber_recovery_event;
-- No UPDATE or DELETE policy is created for the event log: it is append-only.
CREATE POLICY tenant_isolation ON recover_cyber_recovery_event
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON recover_cyber_recovery_event
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
