-- =============================================================================
-- Lex document editor workspace persistence.
--
-- Durable backing store for the legal Word-editor workspace surfaces. These
-- tables move collaboration/workflow state out of audit-only metadata while
-- preserving tenant-first indexes and RLS backstops used by the rest of Lex.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lex_document_editor_clause_anchors (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    document_id       UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    session_id        UUID        REFERENCES lex_document_editor_sessions(id) ON DELETE SET NULL,
    document_version  INT         NOT NULL DEFAULT 0,
    anchor_key        TEXT        NOT NULL,
    clause_id         UUID        REFERENCES contract_clauses(id) ON DELETE SET NULL,
    section_id        TEXT        NOT NULL DEFAULT '',
    section_reference TEXT        NOT NULL DEFAULT '',
    title             TEXT        NOT NULL DEFAULT '',
    clause_type       TEXT        NOT NULL DEFAULT '',
    start_offset      INT,
    end_offset        INT,
    page_number       INT,
    docx_path         TEXT        NOT NULL DEFAULT '',
    checksum          TEXT        NOT NULL DEFAULT '',
    extracted_text    TEXT        NOT NULL DEFAULT '',
    confidence        DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
    status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'superseded', 'deleted')),
    metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by        UUID        NOT NULL,
    updated_by        UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_editor_clause_anchors_key
    ON lex_document_editor_clause_anchors (tenant_id, document_id, document_version, anchor_key)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lex_editor_clause_anchors_document
    ON lex_document_editor_clause_anchors (tenant_id, document_id, section_reference)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lex_editor_clause_anchors_clause
    ON lex_document_editor_clause_anchors (tenant_id, clause_id)
    WHERE clause_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE lex_document_editor_clause_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_clause_anchors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_clause_anchors
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_clause_anchors
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_clause_anchors
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_clause_anchors
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_guest_links (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    document_id      UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    session_id       UUID        REFERENCES lex_document_editor_sessions(id) ON DELETE SET NULL,
    token_hash       TEXT        NOT NULL,
    reviewer_name    TEXT        NOT NULL DEFAULT '',
    reviewer_email   TEXT        NOT NULL,
    organization     TEXT        NOT NULL DEFAULT '',
    access_mode      TEXT        NOT NULL CHECK (access_mode IN ('view', 'comment')),
    sections         TEXT[]      NOT NULL DEFAULT '{}',
    status           TEXT        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'active', 'revoked', 'expired')),
    message          TEXT        NOT NULL DEFAULT '',
    expires_at       TIMESTAMPTZ,
    created_by       UUID        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_by       UUID,
    revoked_at       TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ,
    metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_editor_guest_links_token
    ON lex_document_editor_guest_links (tenant_id, token_hash);
CREATE INDEX IF NOT EXISTS idx_lex_editor_guest_links_document
    ON lex_document_editor_guest_links (tenant_id, document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lex_editor_guest_links_reviewer
    ON lex_document_editor_guest_links (tenant_id, reviewer_email, status);

ALTER TABLE lex_document_editor_guest_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_guest_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_guest_links
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_guest_links
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_guest_links
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_guest_links
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_legal_issues (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    document_id       UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    session_id        UUID        REFERENCES lex_document_editor_sessions(id) ON DELETE SET NULL,
    anchor_id         UUID        REFERENCES lex_document_editor_clause_anchors(id) ON DELETE SET NULL,
    external_id       TEXT,
    title             TEXT        NOT NULL,
    description       TEXT        NOT NULL DEFAULT '',
    severity          TEXT        NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'blocked', 'resolved', 'waived', 'closed')),
    source            TEXT        NOT NULL DEFAULT 'manual',
    section_reference TEXT        NOT NULL DEFAULT '',
    owner_user_id     UUID,
    owner_name        TEXT        NOT NULL DEFAULT '',
    due_at            TIMESTAMPTZ,
    resolved_by       UUID,
    resolved_at       TIMESTAMPTZ,
    resolution_notes  TEXT        NOT NULL DEFAULT '',
    metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by        UUID        NOT NULL,
    updated_by        UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lex_editor_legal_issues_document
    ON lex_document_editor_legal_issues (tenant_id, document_id, status, severity, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_editor_legal_issues_external
    ON lex_document_editor_legal_issues (tenant_id, document_id, external_id)
    WHERE external_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE lex_document_editor_legal_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_legal_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_legal_issues
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_legal_issues
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_legal_issues
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_legal_issues
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_negotiation_messages (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    document_id       UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    session_id        UUID        REFERENCES lex_document_editor_sessions(id) ON DELETE SET NULL,
    issue_id          UUID        REFERENCES lex_document_editor_legal_issues(id) ON DELETE SET NULL,
    parent_message_id UUID        REFERENCES lex_document_editor_negotiation_messages(id) ON DELETE SET NULL,
    actor_user_id     UUID,
    participant_name  TEXT        NOT NULL DEFAULT '',
    participant_email TEXT        NOT NULL DEFAULT '',
    participant_role  TEXT        NOT NULL DEFAULT '',
    message_type      TEXT        NOT NULL DEFAULT 'message' CHECK (message_type IN ('message', 'note', 'position', 'system')),
    visibility        TEXT        NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'external', 'shared')),
    status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'archived')),
    body              TEXT        NOT NULL,
    section_reference TEXT        NOT NULL DEFAULT '',
    metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lex_editor_negotiation_messages_document
    ON lex_document_editor_negotiation_messages (tenant_id, document_id, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lex_editor_negotiation_messages_issue
    ON lex_document_editor_negotiation_messages (tenant_id, issue_id, created_at ASC)
    WHERE issue_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE lex_document_editor_negotiation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_negotiation_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_negotiation_messages
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_negotiation_messages
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_negotiation_messages
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_negotiation_messages
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_section_assignments (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    document_id       UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    session_id        UUID        REFERENCES lex_document_editor_sessions(id) ON DELETE SET NULL,
    anchor_id         UUID        REFERENCES lex_document_editor_clause_anchors(id) ON DELETE SET NULL,
    section_id        TEXT        NOT NULL DEFAULT '',
    title             TEXT        NOT NULL,
    section_reference TEXT        NOT NULL DEFAULT '',
    assignee_id       UUID,
    assignee_name     TEXT        NOT NULL DEFAULT '',
    role              TEXT        NOT NULL DEFAULT 'reviewer',
    status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'in_progress', 'blocked', 'completed', 'waived')),
    due_at            TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by        UUID        NOT NULL,
    updated_by        UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lex_editor_section_assignments_document
    ON lex_document_editor_section_assignments (tenant_id, document_id, status, due_at)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lex_editor_section_assignments_assignee
    ON lex_document_editor_section_assignments (tenant_id, assignee_id, status, due_at)
    WHERE assignee_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE lex_document_editor_section_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_section_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_section_assignments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_section_assignments
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_section_assignments
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_section_assignments
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_privileged_controls (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    document_id UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    control_key TEXT        NOT NULL,
    enabled     BOOLEAN     NOT NULL DEFAULT false,
    locked      BOOLEAN     NOT NULL DEFAULT false,
    reason      TEXT        NOT NULL DEFAULT '',
    status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'requested', 'disabled')),
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, document_id, control_key)
);

CREATE INDEX IF NOT EXISTS idx_lex_editor_privileged_controls_document
    ON lex_document_editor_privileged_controls (tenant_id, document_id);

ALTER TABLE lex_document_editor_privileged_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_privileged_controls FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_privileged_controls
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_privileged_controls
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_privileged_controls
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_privileged_controls
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_privileged_control_requests (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    document_id     UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    session_id      UUID        REFERENCES lex_document_editor_sessions(id) ON DELETE SET NULL,
    control_key     TEXT        NOT NULL,
    requested_state BOOLEAN,
    status          TEXT        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'applied', 'cancelled')),
    reason          TEXT        NOT NULL DEFAULT '',
    decision_notes  TEXT        NOT NULL DEFAULT '',
    requested_by    UUID        NOT NULL,
    decided_by      UUID,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at      TIMESTAMPTZ,
    applied_at      TIMESTAMPTZ,
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_lex_editor_privileged_requests_document
    ON lex_document_editor_privileged_control_requests (tenant_id, document_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_lex_editor_privileged_requests_status
    ON lex_document_editor_privileged_control_requests (tenant_id, status, requested_at DESC);

ALTER TABLE lex_document_editor_privileged_control_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_privileged_control_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_privileged_control_requests
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_privileged_control_requests
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_privileged_control_requests
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_privileged_control_requests
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_approval_requests (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID        NOT NULL,
    document_id    UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    session_id     UUID        REFERENCES lex_document_editor_sessions(id) ON DELETE SET NULL,
    target_type    TEXT        NOT NULL CHECK (target_type IN (
        'privileged_control', 'legal_issue', 'playbook_deviation', 'ai_change',
        'external_share', 'signature', 'final_publish', 'other'
    )),
    target_id      UUID,
    status         TEXT        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled', 'applied')),
    priority       TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    reason         TEXT        NOT NULL DEFAULT '',
    requested_by   UUID        NOT NULL,
    assigned_to    UUID,
    due_at         TIMESTAMPTZ,
    decided_by     UUID,
    decided_at     TIMESTAMPTZ,
    decision_notes TEXT        NOT NULL DEFAULT '',
    metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_editor_approval_requests_document
    ON lex_document_editor_approval_requests (tenant_id, document_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_lex_editor_approval_requests_assignee
    ON lex_document_editor_approval_requests (tenant_id, assigned_to, status, due_at)
    WHERE assigned_to IS NOT NULL;

ALTER TABLE lex_document_editor_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_approval_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_approval_requests
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_approval_requests
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_approval_requests
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_approval_requests
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_citation_bindings (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL,
    document_id        UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    anchor_id          UUID        REFERENCES lex_document_editor_clause_anchors(id) ON DELETE SET NULL,
    source_type        TEXT        NOT NULL CHECK (source_type IN ('legal_document', 'contract', 'policy', 'regulation', 'case', 'evidence', 'url', 'text', 'other')),
    source_document_id UUID        REFERENCES legal_documents(id) ON DELETE SET NULL,
    source_id          UUID,
    source_label       TEXT        NOT NULL DEFAULT '',
    source_url         TEXT        NOT NULL DEFAULT '',
    citation_text      TEXT        NOT NULL DEFAULT '',
    page_number        INT,
    confidence         DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
    status             TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'removed')),
    metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by         UUID        NOT NULL,
    updated_by         UUID,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lex_editor_citations_document
    ON lex_document_editor_citation_bindings (tenant_id, document_id, source_type)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lex_editor_citations_anchor
    ON lex_document_editor_citation_bindings (tenant_id, anchor_id)
    WHERE anchor_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE lex_document_editor_citation_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_citation_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_citation_bindings
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_citation_bindings
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_citation_bindings
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_citation_bindings
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_tasks (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    document_id   UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    source_type   TEXT        NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'legal_issue', 'comment', 'playbook_deviation', 'signature_blocker', 'approval')),
    source_id     UUID,
    title         TEXT        NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'completed', 'cancelled')),
    priority      TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    assignee_id   UUID,
    due_at        TIMESTAMPTZ,
    sla_due_at    TIMESTAMPTZ,
    escalation_at TIMESTAMPTZ,
    completed_by  UUID,
    completed_at  TIMESTAMPTZ,
    metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by    UUID        NOT NULL,
    updated_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lex_editor_tasks_document
    ON lex_document_editor_tasks (tenant_id, document_id, status, due_at)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lex_editor_tasks_assignee
    ON lex_document_editor_tasks (tenant_id, assignee_id, status, due_at)
    WHERE assignee_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE lex_document_editor_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_tasks
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_tasks
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_tasks
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_tasks
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_offline_recovery_snapshots (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL,
    document_id        UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    session_id         UUID        REFERENCES lex_document_editor_sessions(id) ON DELETE SET NULL,
    user_id            UUID        NOT NULL,
    provider           TEXT        NOT NULL DEFAULT 'onlyoffice',
    client_instance_id TEXT        NOT NULL DEFAULT '',
    snapshot_version   INT         NOT NULL DEFAULT 1,
    payload_ciphertext TEXT        NOT NULL DEFAULT '',
    payload_metadata   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    status             TEXT        NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'recovered', 'discarded', 'expired')),
    captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    recovered_at       TIMESTAMPTZ,
    discarded_at       TIMESTAMPTZ,
    expires_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_editor_recovery_document_user
    ON lex_document_editor_offline_recovery_snapshots (tenant_id, document_id, user_id, status, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_lex_editor_recovery_expiry
    ON lex_document_editor_offline_recovery_snapshots (tenant_id, expires_at)
    WHERE expires_at IS NOT NULL AND status = 'staged';

ALTER TABLE lex_document_editor_offline_recovery_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_offline_recovery_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_offline_recovery_snapshots
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_offline_recovery_snapshots
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_offline_recovery_snapshots
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_offline_recovery_snapshots
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_provider_events (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    document_id       UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    session_id        UUID        REFERENCES lex_document_editor_sessions(id) ON DELETE SET NULL,
    provider          TEXT        NOT NULL DEFAULT 'onlyoffice',
    provider_event_id TEXT,
    event_type        TEXT        NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
    payload           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    error             TEXT,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_editor_provider_events_document
    ON lex_document_editor_provider_events (tenant_id, document_id, received_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_editor_provider_events_external
    ON lex_document_editor_provider_events (tenant_id, provider, provider_event_id)
    WHERE provider_event_id IS NOT NULL;

ALTER TABLE lex_document_editor_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_provider_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_provider_events
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_provider_events
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_provider_events
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_provider_events
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS lex_document_editor_analytics_rollups (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    document_id  UUID        REFERENCES legal_documents(id) ON DELETE CASCADE,
    grain        TEXT        NOT NULL DEFAULT 'document' CHECK (grain IN ('document', 'day', 'week', 'month')),
    period_start DATE        NOT NULL,
    period_end   DATE        NOT NULL,
    metric_key   TEXT        NOT NULL,
    metric_value DECIMAL(18,4) NOT NULL DEFAULT 0,
    dimensions   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_editor_analytics_rollups_metric
    ON lex_document_editor_analytics_rollups (tenant_id, metric_key, grain, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_lex_editor_analytics_rollups_document
    ON lex_document_editor_analytics_rollups (tenant_id, document_id, period_start DESC)
    WHERE document_id IS NOT NULL;

ALTER TABLE lex_document_editor_analytics_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_editor_analytics_rollups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lex_document_editor_analytics_rollups
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_editor_analytics_rollups
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_editor_analytics_rollups
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_editor_analytics_rollups
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
