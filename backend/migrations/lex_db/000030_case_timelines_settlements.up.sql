-- Phase 3 — Case Timelines (External Dependency/Delay) & Settlements/ADR
-- (CAP-084..093). STAGED: the integrator assigns the next sequential number
-- (000027+); do NOT hard-code a number here.
--
-- Conventions (mirroring the neighbouring lex migrations):
--   * tenant_id FIRST on every NEW table; tenant-leading partial indexes.
--   * soft-delete on the mutable register/aggregate tables.
--   * ENABLE + FORCE RLS with 4 tenant policies on current_setting('app.current_tenant_id').
--   * the settlement audit log is append-only (tenant_isolation + INSERT only, no UPDATE/DELETE).
--   * gen_random_uuid(), created_by, created_at/updated_at timestamps.
--
-- TIMELINES (CAP-084..088) extends the EXISTING legal_matters aggregate in place
-- via ALTER (the Matter model file is owned elsewhere; the timeline columns are
-- projected by a small extension model + the CaseDelayRepository). due_date is
-- ALREADY nullable = CAP-085 (no forced closure). SETTLEMENTS/ADR (CAP-089..093)
-- add the legal_settlement aggregate (FK -> legal_matters), its negotiation-round
-- register and its append-only audit log.

-- =============================================================================
-- CAP-084..088 — legal_matters timeline / external-dependency extension columns
-- =============================================================================
ALTER TABLE legal_matters
    ADD COLUMN IF NOT EXISTS estimated_duration_days   INT,
    ADD COLUMN IF NOT EXISTS estimated_completion_date DATE,
    ADD COLUMN IF NOT EXISTS external_hold             BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS external_hold_category    TEXT,
    ADD COLUMN IF NOT EXISTS external_hold_since        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closure_reason            TEXT;

-- Classified external-dependency category (CAP-088). Guarded so only the four
-- delay classes are accepted (NULL when not externally held).
ALTER TABLE legal_matters
    DROP CONSTRAINT IF EXISTS legal_matters_external_hold_category_check;
ALTER TABLE legal_matters
    ADD CONSTRAINT legal_matters_external_hold_category_check
    CHECK (external_hold_category IS NULL OR external_hold_category IN ('court', 'government', 'department', 'expert'));

-- Surface externally-pending matters quickly (CAP-087).
CREATE INDEX IF NOT EXISTS idx_legal_matters_external_hold
    ON legal_matters (tenant_id, external_hold_category, external_hold_since)
    WHERE external_hold = true AND deleted_at IS NULL;

-- =============================================================================
-- CAP-086/087/088 — legal_case_delay_events: classified delay-window register
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_case_delay_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    matter_id   UUID        NOT NULL REFERENCES legal_matters(id) ON DELETE CASCADE,
    category    TEXT        NOT NULL CHECK (category IN ('court', 'government', 'department', 'expert')),
    reason      TEXT        NOT NULL,
    opened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_case_delay_events_matter
    ON legal_case_delay_events (tenant_id, matter_id, opened_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_case_delay_events_open
    ON legal_case_delay_events (tenant_id, matter_id)
    WHERE resolved_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_case_delay_events_category
    ON legal_case_delay_events (tenant_id, category, opened_at DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_case_delay_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_delay_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_case_delay_events
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_delay_events
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_case_delay_events
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_case_delay_events
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- CAP-089..093 — legal_settlement: reconciliation / settlement aggregate
-- (FK -> legal_matters). Counterparty PII columns store field-encrypted values
-- ("enc:v1:" prefix); the service encrypts before write and decrypts on read.
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_settlement (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID        NOT NULL,
    matter_id              UUID        NOT NULL REFERENCES legal_matters(id) ON DELETE CASCADE,
    reference              TEXT        NOT NULL,
    status                 TEXT        NOT NULL DEFAULT 'proposed' CHECK (status IN (
        'proposed', 'negotiating', 'pending_approval', 'approved', 'executed', 'rejected', 'abandoned'
    )),
    method                 TEXT        NOT NULL DEFAULT 'reconciliation' CHECK (method IN (
        'reconciliation', 'mediation', 'arbitration', 'negotiation', 'other'
    )),
    title                  TEXT        NOT NULL,
    terms                  TEXT        NOT NULL DEFAULT '',
    value                  NUMERIC(18,2),
    currency               TEXT,
    -- counterparty PII (field-encrypted at rest).
    counterparty_name      TEXT,
    counterparty_contact   TEXT,
    counterparty_id_number TEXT,
    workflow_instance_id   UUID,
    approved_by            UUID,
    approved_at            TIMESTAMPTZ,
    executed_at            TIMESTAMPTZ,
    metadata               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by             UUID        NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at             TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_settlement_reference_unique
    ON legal_settlement (tenant_id, reference)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_settlement_matter
    ON legal_settlement (tenant_id, matter_id, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_settlement_status
    ON legal_settlement (tenant_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_settlement_workflow
    ON legal_settlement (tenant_id, workflow_instance_id)
    WHERE workflow_instance_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_settlement FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_settlement
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_settlement
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_settlement
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_settlement
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- CAP-091 — legal_settlement_negotiation_rounds: numbered offer/counter-offer log
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_settlement_negotiation_rounds (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID        NOT NULL,
    settlement_id  UUID        NOT NULL REFERENCES legal_settlement(id) ON DELETE CASCADE,
    round_number   INT         NOT NULL CHECK (round_number >= 1),
    proposed_by    TEXT        NOT NULL,
    proposed_value NUMERIC(18,2),
    currency       TEXT,
    terms          TEXT        NOT NULL DEFAULT '',
    outcome        TEXT        NOT NULL DEFAULT '',
    metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by     UUID        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_legal_settlement_round UNIQUE (settlement_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_legal_settlement_rounds_settlement
    ON legal_settlement_negotiation_rounds (tenant_id, settlement_id, round_number ASC);

ALTER TABLE legal_settlement_negotiation_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_settlement_negotiation_rounds FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_settlement_negotiation_rounds
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_settlement_negotiation_rounds
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_settlement_negotiation_rounds
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_settlement_negotiation_rounds
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_settlement_audit_log — append-only governance audit trail (CAP-089..093)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_settlement_audit_log (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    settlement_id UUID        NOT NULL REFERENCES legal_settlement(id) ON DELETE CASCADE,
    action        TEXT        NOT NULL,
    from_status   TEXT,
    to_status     TEXT,
    detail        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_settlement_audit_log_settlement
    ON legal_settlement_audit_log (tenant_id, settlement_id, created_at ASC);

ALTER TABLE legal_settlement_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_settlement_audit_log FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation + INSERT only. No UPDATE/DELETE policy so the
-- settlement governance audit trail is immutable.
CREATE POLICY tenant_isolation ON legal_settlement_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_settlement_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- Seeds — none required (these are operational tables, not reference data).
-- Reference-data seeds, when added, MUST loop over tenants:
--   INSERT ... SELECT id AS tenant_id, ... FROM tenants;
-- =============================================================================
