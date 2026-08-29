-- Round 2 LegalCase depth (WS3/WS4/C-2): optimistic-concurrency on legal_cases,
-- the SLA-clock-on-open stamp, the FSM on_hold/delayed state with a classified
-- delay category + reason, and the sub-resource append-only audit log.
--
-- Numbered 000038 (000037_case_hold_history was the prior highest in lex_db).
-- Idempotent (IF NOT EXISTS / guarded DO blocks) so a re-run is a no-op.
--
-- Verified against migrations 000026 (legal_cases base) and 000036 (which added
-- lock_version to legal_requests but NOT to legal_cases) and 000037.

-- =============================================================================
-- (1) legal_cases: optimistic-concurrency counter + SLA-clock stamp + hold facts.
-- =============================================================================

-- Optimistic-concurrency column. Default 0 backfills existing rows; NOT NULL so
-- the guarded UpdateStatus always reads/writes it. UpdateStatus guards on
-- status = expectedFrom and bumps lock_version on every transition.
ALTER TABLE legal_cases
    ADD COLUMN IF NOT EXISTS lock_version INTEGER NOT NULL DEFAULT 0;

-- clock_started_at records the instant the SLA clock was materialised on case
-- open (WS3 / C-2). Nullable: a case that never reached 'open' has no clock.
ALTER TABLE legal_cases
    ADD COLUMN IF NOT EXISTS clock_started_at TIMESTAMPTZ;

-- Classified delay facts for the on_hold/delayed FSM state (WS3, CAP-088). The
-- category reuses the case_delay DelayCategory domain (court|government|
-- department|expert); hold_reason is the mandatory free-text justification.
-- Both are cleared when the case leaves on_hold. CAP-085: no forced closure date.
ALTER TABLE legal_cases
    ADD COLUMN IF NOT EXISTS hold_category TEXT
        CHECK (hold_category IS NULL OR hold_category IN ('court', 'government', 'department', 'expert'));
ALTER TABLE legal_cases
    ADD COLUMN IF NOT EXISTS hold_reason TEXT;

-- =============================================================================
-- (2) legal_cases.status: add the on_hold/delayed FSM state to the CHECK.
-- =============================================================================
-- Drop the existing status CHECK (named by the 000026 inline definition) and
-- recreate it including 'on_hold'. The constraint name Postgres auto-assigned to
-- the inline CHECK is legal_cases_status_check.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'legal_cases_status_check'
          AND conrelid = 'legal_cases'::regclass
    ) THEN
        ALTER TABLE legal_cases DROP CONSTRAINT legal_cases_status_check;
    END IF;
END$$;

ALTER TABLE legal_cases
    ADD CONSTRAINT legal_cases_status_check CHECK (status IN (
        'intake', 'phase1', 'phase2', 'open', 'under_procedure', 'on_hold', 'closed', 'cancelled'
    ));

-- Partial index for the on-hold worklist (tenant-leading, only live held cases).
CREATE INDEX IF NOT EXISTS idx_legal_cases_tenant_on_hold
    ON legal_cases (tenant_id, hold_category, updated_at DESC)
    WHERE status = 'on_hold' AND deleted_at IS NULL;

-- =============================================================================
-- (3) legal_case_sub_audit_log — append-only audit trail for the case
--     sub-resources (parties / hearings / tasks) with a real before/after diff
--     (WS4). Separate from legal_case_audit_log (which keys the case-level FSM /
--     management actions) so the sub-resource id + type are first-class columns.
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_case_sub_audit_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    case_id         UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    -- 'party' | 'hearing' | 'task'
    resource_type   TEXT        NOT NULL CHECK (resource_type IN ('party', 'hearing', 'task')),
    resource_id     UUID        NOT NULL,
    -- 'created' | 'updated' | 'deleted'
    action          TEXT        NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
    before_state    JSONB,
    after_state     JSONB,
    reason          TEXT,
    actor_user_id   UUID        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_case_sub_audit_log_case
    ON legal_case_sub_audit_log (tenant_id, case_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_legal_case_sub_audit_log_resource
    ON legal_case_sub_audit_log (tenant_id, resource_type, resource_id, created_at ASC);

ALTER TABLE legal_case_sub_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_sub_audit_log FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation + insert ONLY. No UPDATE/DELETE policies so the
-- sub-resource audit trail is immutable (WS4 / CAP-051).
CREATE POLICY tenant_isolation ON legal_case_sub_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_sub_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
