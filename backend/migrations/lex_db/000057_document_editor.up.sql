-- Document editor backend foundation.
--
-- Provider-agnostic editor sessions with OnlyOffice-ready callback metadata,
-- explicit check-out locks, append-only audit, and preflight payload storage.

CREATE TABLE IF NOT EXISTS lex_document_editor_sessions (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    document_id           UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    provider              TEXT        NOT NULL DEFAULT 'onlyoffice',
    requested_mode        TEXT        NOT NULL CHECK (requested_mode IN ('edit', 'comment', 'view')),
    permission_mode       TEXT        NOT NULL CHECK (permission_mode IN ('edit', 'comment', 'view')),
    status                TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'expired')),
    provider_document_key TEXT        NOT NULL,
    document_version      INT         NOT NULL DEFAULT 0,
    callback_url          TEXT,
    callback_token_hash   TEXT,
    autosave_metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    last_callback         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    preflight_result      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    snapshot_metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by            UUID        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at            TIMESTAMPTZ,
    closed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lex_document_editor_sessions_document
    ON lex_document_editor_sessions (tenant_id, document_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lex_document_editor_sessions_provider_key
    ON lex_document_editor_sessions (tenant_id, provider, provider_document_key)
    WHERE status = 'active';

ALTER TABLE lex_document_editor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_document_editor_sessions
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_sessions
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_sessions
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_sessions
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_locks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    document_id UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    session_id  UUID        REFERENCES lex_document_editor_sessions(id) ON DELETE SET NULL,
    lock_type   TEXT        NOT NULL DEFAULT 'checkout' CHECK (lock_type IN ('checkout', 'edit')),
    status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'expired')),
    reason      TEXT        NOT NULL DEFAULT '',
    locked_by   UUID        NOT NULL,
    locked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ,
    released_by UUID,
    released_at TIMESTAMPTZ,
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_document_editor_locks_active_document
    ON lex_document_editor_locks (tenant_id, document_id)
    WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lex_document_editor_locks_actor
    ON lex_document_editor_locks (tenant_id, locked_by, locked_at DESC)
    WHERE released_at IS NULL;

ALTER TABLE lex_document_editor_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_locks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_document_editor_locks
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_locks
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_locks
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_locks
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_audit (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    document_id   UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    session_id    UUID        REFERENCES lex_document_editor_sessions(id) ON DELETE SET NULL,
    lock_id       UUID        REFERENCES lex_document_editor_locks(id) ON DELETE SET NULL,
    action        TEXT        NOT NULL,
    provider      TEXT,
    actor_user_id UUID,
    detail        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_document_editor_audit_document
    ON lex_document_editor_audit (tenant_id, document_id, created_at ASC);

ALTER TABLE lex_document_editor_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_audit FORCE ROW LEVEL SECURITY;

-- Append-only: no UPDATE/DELETE policies.
CREATE POLICY tenant_isolation ON lex_document_editor_audit
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_audit
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
