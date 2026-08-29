-- =============================================================================
-- legal_matter_audit_log — append-only governance audit trail for matters.
--
-- Mirrors legal_settlement_audit_log / legal_case_audit_log: an INSERT-only,
-- tenant-isolated, tamper-evident trail of matter lifecycle events (create,
-- triage, status transitions, contract link/unlink, update). This migration
-- creates the READ-path store only; matter mutations do not yet write rows here
-- (emission is a follow-up that must hook the existing matter transactions).
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_matter_audit_log (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    matter_id     UUID        NOT NULL REFERENCES legal_matters(id) ON DELETE CASCADE,
    action        TEXT        NOT NULL,
    from_status   TEXT,
    to_status     TEXT,
    detail        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_audit_log_matter
    ON legal_matter_audit_log (tenant_id, matter_id, created_at ASC);

ALTER TABLE legal_matter_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_matter_audit_log FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation + INSERT only. No UPDATE/DELETE policy so the
-- matter governance audit trail is immutable.
CREATE POLICY tenant_isolation ON legal_matter_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_matter_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
