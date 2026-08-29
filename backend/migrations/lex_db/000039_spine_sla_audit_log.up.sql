-- =============================================================================
-- WS4 (Round 2): append-only audit trails for the LegalRequest spine and the SLA
-- clock state machine. Every material status transition / SLA mutation appends an
-- immutable row INSIDE the same transaction as the mutation it records, mirroring
-- legal_case_audit_log (CAP-051): tenant isolation + INSERT only, NO update/delete
-- policy, so the trail is tamper-evident.
--
-- Staged migration: the human renumbers/moves it into migrations/lex_db/ on merge.
-- The next free sequence at authoring time is 000038 (highest committed is 000037).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- legal_request_audit_log — spine status-transition audit trail
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_request_audit_log (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    request_id    UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    action        TEXT        NOT NULL,
    from_status   TEXT,
    to_status     TEXT,
    reason        TEXT,
    detail        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_request_audit_log_request
    ON legal_request_audit_log (tenant_id, request_id, created_at ASC);

ALTER TABLE legal_request_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_audit_log FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation + insert ONLY. No UPDATE/DELETE policies so the
-- spine governance audit trail is immutable.
CREATE POLICY tenant_isolation ON legal_request_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- legal_sla_audit_log — SLA clock lifecycle audit trail
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_sla_audit_log (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    sla_clock_id     UUID        NOT NULL REFERENCES legal_sla_clocks(id) ON DELETE CASCADE,
    legal_request_id UUID        NOT NULL,
    action           TEXT        NOT NULL,
    from_status      TEXT,
    to_status        TEXT,
    reason           TEXT,
    escalation_level INTEGER     NOT NULL DEFAULT 0,
    detail           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id    UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_sla_audit_log_clock
    ON legal_sla_audit_log (tenant_id, sla_clock_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_legal_sla_audit_log_request
    ON legal_sla_audit_log (tenant_id, legal_request_id, created_at ASC);

ALTER TABLE legal_sla_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_sla_audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_sla_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_sla_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
