-- FR-WATHEEQ-005 (Legal Hold). A legal hold preserves a contract, matter, or
-- legal document so it cannot be deleted, archived, or otherwise altered away
-- while the hold is active. Holds are tenant-scoped; isolation is enforced in
-- the service layer (destructive operations are refused) and by the explicit
-- WHERE tenant_id filters in the repositories. The RLS policies below are
-- defense-in-depth scaffolding and are currently inert under the superuser lex
-- pool (see 000002 for why and what enabling them requires).

CREATE TABLE IF NOT EXISTS legal_holds (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    subject_type  TEXT        NOT NULL CHECK (subject_type IN ('contract', 'matter', 'document')),
    subject_id    UUID        NOT NULL,
    reason        TEXT        NOT NULL,
    reference     TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
    custodian     TEXT        NOT NULL DEFAULT '',
    notes         TEXT        NOT NULL DEFAULT '',
    applied_by    UUID        NOT NULL,
    applied_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_by   UUID,
    released_at   TIMESTAMPTZ,
    release_note  TEXT        NOT NULL DEFAULT '',
    metadata      JSONB       NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (status = 'released' AND released_at IS NOT NULL AND released_by IS NOT NULL)
        OR (status = 'active' AND released_at IS NULL AND released_by IS NULL)
    )
);

-- At most one ACTIVE hold per (tenant, subject) at a time. Released holds remain
-- as immutable history and do not block re-application.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_holds_active_subject_unique
    ON legal_holds (tenant_id, subject_type, subject_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_legal_holds_tenant_status
    ON legal_holds (tenant_id, status, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_holds_subject
    ON legal_holds (tenant_id, subject_type, subject_id, status);
CREATE INDEX IF NOT EXISTS idx_legal_holds_reference
    ON legal_holds (tenant_id, reference)
    WHERE reference <> '';

ALTER TABLE legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_holds FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_holds
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_holds
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_holds
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_holds
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
