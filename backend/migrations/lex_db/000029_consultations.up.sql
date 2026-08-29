-- Legal Consultations vertical (CAP-126..132).
--
-- legal_consultations is the consultation aggregate: an advisory request/answer
-- driven through the FSM submitted → classified → routed → responded → approved →
-- archived. It may be spawned from a legal request (legal_request_id back-links the
-- spine) or stand alone (legal_request_id NULL); the FK is ON DELETE SET NULL so
-- removing a spine row does not destroy the consultation.
--
-- legal_consultation_documents indexes Files-service objects attached to a
-- consultation (entity_type='consultation', entity_id=consultation_id, suite='lex');
-- the bytes live in the File service.
--
-- legal_consultation_audit_log is an append-only (INSERT-only RLS) governance trail
-- of every lifecycle mutation.
--
-- All tables: tenant_id FIRST, tenant-leading partial indexes, soft-delete on the
-- aggregate, ENABLE + FORCE RLS with the standard 4 (isolation/insert/update/delete)
-- policies; the audit log is append-only (isolation + insert only).

CREATE TABLE IF NOT EXISTS legal_consultations (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL,
    consultation_number  TEXT        NOT NULL,
    type                 TEXT        NOT NULL DEFAULT 'general',
    title                JSONB       NOT NULL DEFAULT '{}'::jsonb,
    status               TEXT        NOT NULL DEFAULT 'submitted' CHECK (status IN (
        'submitted', 'classified', 'routed', 'responded', 'approved', 'archived'
    )),
    priority             TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    legal_request_id     UUID        REFERENCES legal_requests(id) ON DELETE SET NULL,
    requester_user_id    UUID        NOT NULL,
    requester_name       TEXT        NOT NULL,
    department           TEXT,
    advisor_id           UUID,
    advisor_name         TEXT,
    question             TEXT        NOT NULL DEFAULT '',
    response             TEXT,
    workflow_instance_id UUID,
    responded_by         UUID,
    responded_at         TIMESTAMPTZ,
    approved_by          UUID,
    approved_at          TIMESTAMPTZ,
    archived_at          TIMESTAMPTZ,
    tags                 TEXT[]      NOT NULL DEFAULT '{}',
    metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by           UUID        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_consultations_number_unique
    ON legal_consultations (tenant_id, consultation_number)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_consultations_tenant_status
    ON legal_consultations (tenant_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_consultations_tenant_type
    ON legal_consultations (tenant_id, type, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_consultations_requester
    ON legal_consultations (tenant_id, requester_user_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_consultations_advisor
    ON legal_consultations (tenant_id, advisor_id)
    WHERE advisor_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_consultations_request
    ON legal_consultations (tenant_id, legal_request_id)
    WHERE legal_request_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_consultations_workflow
    ON legal_consultations (tenant_id, workflow_instance_id)
    WHERE workflow_instance_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_consultations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_consultations
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_consultations
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_consultations
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_consultations
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Document links (CAP-128). A given file is linked at most once per consultation.
CREATE TABLE IF NOT EXISTS legal_consultation_documents (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    consultation_id UUID        NOT NULL REFERENCES legal_consultations(id) ON DELETE CASCADE,
    file_id         UUID        NOT NULL,
    file_name       TEXT        NOT NULL,
    file_size       BIGINT      NOT NULL DEFAULT 0,
    content_type    TEXT,
    kind            TEXT        NOT NULL DEFAULT 'attachment',
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by      UUID        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (consultation_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_legal_consultation_documents_consultation
    ON legal_consultation_documents (tenant_id, consultation_id, created_at DESC);

ALTER TABLE legal_consultation_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_consultation_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_consultation_documents
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_consultation_documents
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_consultation_documents
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_consultation_documents
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Append-only governance audit log (CAP-126..132). Rows are immutable: there are
-- NO UPDATE/DELETE RLS policies, only tenant isolation + insert.
CREATE TABLE IF NOT EXISTS legal_consultation_audit_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    consultation_id UUID        NOT NULL REFERENCES legal_consultations(id) ON DELETE CASCADE,
    action          TEXT        NOT NULL,
    from_status     TEXT,
    to_status       TEXT,
    detail          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id   UUID        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_consultation_audit_consultation
    ON legal_consultation_audit_log (tenant_id, consultation_id, created_at DESC);

ALTER TABLE legal_consultation_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_consultation_audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_consultation_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_consultation_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
-- No UPDATE/DELETE policies: the consultation audit log is append-only.

-- ---------------------------------------------------------------------------
-- Seed: one demo standalone consultation per tenant so every consultation list
-- page resolves out of the box. Deterministic UUID (md5-derived per tenant) +
-- ON CONFLICT DO NOTHING keeps it idempotent. Loops over ALL tenants.
-- ---------------------------------------------------------------------------
INSERT INTO legal_consultations (
    id, tenant_id, consultation_number, type, title, status, priority,
    requester_user_id, requester_name, question, created_by
)
SELECT
    ('00000000-0000-0000-0000-' || substr(md5('lex-consultation-seed-' || t.id::text), 1, 12))::uuid,
    t.id,
    'CONS-SEED-' || upper(substr(md5(t.id::text), 1, 8)),
    'contractual',
    '{"ar":"استشارة بشأن بند عدم المنافسة","en":"Consultation on a non-compete clause"}'::jsonb,
    'submitted',
    'medium',
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Demo Requester',
    'Is the 24-month non-compete clause enforceable for a mid-level employee in our jurisdiction?',
    '00000000-0000-0000-0000-000000000001'::uuid
FROM tenants t
ON CONFLICT DO NOTHING;
