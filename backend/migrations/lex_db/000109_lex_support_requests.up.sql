-- Internal peer-to-peer support requests between legal staff.
-- Expiry is a terminal state transition; rows are retained for audit.
CREATE TABLE lex_support_requests (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    requester_id          UUID NOT NULL,
    requester_entity_id   UUID REFERENCES legal_org_entities(id),
    target_entity_id      UUID NOT NULL REFERENCES legal_org_entities(id),
    assignee_id           UUID NOT NULL,
    subject               TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
    body                  TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 10000),
    priority              TEXT NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low', 'normal', 'high')),
    subject_type          TEXT CHECK (subject_type IN
                          ('case', 'contract', 'consultation', 'matter', 'investigation', 'request')),
    subject_id            UUID,
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN
                          ('open', 'accepted', 'resolved', 'declined', 'expired', 'cancelled')),
    resolution_note       TEXT NOT NULL DEFAULT '' CHECK (length(resolution_note) <= 10000),
    expires_at            TIMESTAMPTZ,
    accepted_at           TIMESTAMPTZ,
    closed_at             TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at            TIMESTAMPTZ,
    CONSTRAINT ck_lex_support_subject_pair CHECK (
        (subject_type IS NULL AND subject_id IS NULL) OR
        (subject_type IS NOT NULL AND subject_id IS NOT NULL)
    ),
    CONSTRAINT ck_lex_support_terminal_closed_at CHECK (
        (status IN ('resolved', 'declined', 'expired', 'cancelled') AND closed_at IS NOT NULL) OR
        (status IN ('open', 'accepted') AND closed_at IS NULL)
    )
);

CREATE INDEX idx_lex_support_assignee_open ON lex_support_requests
    (tenant_id, assignee_id, status, expires_at)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_lex_support_requester ON lex_support_requests
    (tenant_id, requester_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_lex_support_due ON lex_support_requests (expires_at)
    WHERE status IN ('open', 'accepted') AND expires_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_lex_support_target_entity ON lex_support_requests
    (tenant_id, target_entity_id, created_at DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE lex_support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_support_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_support_requests
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_support_requests
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_support_requests
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_support_requests
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
