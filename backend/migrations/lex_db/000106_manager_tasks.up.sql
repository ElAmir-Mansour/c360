CREATE TABLE IF NOT EXISTS legal_manager_tasks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    title             TEXT NOT NULL CHECK (length(btrim(title)) > 0 AND length(title) <= 200),
    description       TEXT NOT NULL CHECK (length(btrim(description)) > 0 AND length(description) <= 10000),
    assignee_id       UUID NOT NULL,
    status            TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','submitted','correction_required','accepted','cancelled')),
    attachment_file_id UUID,
    attachment_name   TEXT,
    attachment_content_type TEXT,
    attachment_size_bytes BIGINT CHECK (attachment_size_bytes IS NULL OR attachment_size_bytes >= 0),
    attachment_checksum_sha256 TEXT,
    attachment_file_version INTEGER CHECK (attachment_file_version IS NULL OR attachment_file_version >= 1),
    attachment_virus_scan_status TEXT,
    attachment_uploaded_by UUID,
    result            TEXT,
    correction_note   TEXT,
    created_by        UUID NOT NULL,
    submitted_at      TIMESTAMPTZ,
    reviewed_by       UUID,
    reviewed_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT manager_task_attachment_complete CHECK (
      (attachment_file_id IS NULL AND attachment_name IS NULL AND attachment_content_type IS NULL AND
       attachment_size_bytes IS NULL AND attachment_checksum_sha256 IS NULL AND attachment_file_version IS NULL AND
       attachment_virus_scan_status IS NULL AND attachment_uploaded_by IS NULL)
      OR
      (attachment_file_id IS NOT NULL AND attachment_name IS NOT NULL AND attachment_content_type IS NOT NULL AND
       attachment_size_bytes IS NOT NULL AND attachment_checksum_sha256 IS NOT NULL AND attachment_file_version IS NOT NULL AND
       attachment_virus_scan_status IS NOT NULL AND attachment_uploaded_by IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_legal_manager_tasks_tenant_updated
    ON legal_manager_tasks (tenant_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_manager_tasks_tenant_assignee
    ON legal_manager_tasks (tenant_id, assignee_id, status, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS legal_manager_task_audit (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    task_id     UUID NOT NULL REFERENCES legal_manager_tasks(id) ON DELETE CASCADE,
    action      TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    note        TEXT NOT NULL DEFAULT '',
    actor_user_id UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legal_manager_task_audit_tenant_task
    ON legal_manager_task_audit (tenant_id, task_id, created_at ASC);

ALTER TABLE legal_manager_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_manager_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_manager_tasks
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_insert ON legal_manager_tasks
    FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_update ON legal_manager_tasks
    FOR UPDATE USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_delete ON legal_manager_tasks
    FOR DELETE USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE legal_manager_task_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_manager_task_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_manager_task_audit
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_insert ON legal_manager_task_audit
    FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
