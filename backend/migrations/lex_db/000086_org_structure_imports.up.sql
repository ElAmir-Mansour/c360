-- Production-grade organizational-structure onboarding jobs.
-- The submitted normalized rows and row-level validation report are retained so
-- operators can review/re-download exactly what was evaluated.

CREATE TABLE IF NOT EXISTS legal_org_memberships (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    entity_id   UUID        NOT NULL REFERENCES legal_org_entities(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL,
    employee_code TEXT      NOT NULL DEFAULT '',
    title       JSONB       NOT NULL DEFAULT '{}',
    manager_user_id UUID,
    active      BOOLEAN     NOT NULL DEFAULT true,
    metadata    JSONB       NOT NULL DEFAULT '{}',
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_org_memberships_entity_user
    ON legal_org_memberships (tenant_id, entity_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_org_memberships_user
    ON legal_org_memberships (tenant_id, user_id) WHERE deleted_at IS NULL;

ALTER TABLE legal_org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_org_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_org_memberships
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_org_memberships
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_org_memberships
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS legal_org_import_jobs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    mode            TEXT        NOT NULL CHECK (mode IN ('create', 'update', 'merge', 'replace')),
    dry_run         BOOLEAN     NOT NULL DEFAULT true,
    status          TEXT        NOT NULL CHECK (status IN ('validated', 'failed', 'completed')),
    source_filename TEXT        NOT NULL DEFAULT '',
    rows            JSONB       NOT NULL DEFAULT '[]',
    errors          JSONB       NOT NULL DEFAULT '[]',
    total_rows      INTEGER     NOT NULL DEFAULT 0,
    create_count    INTEGER     NOT NULL DEFAULT 0,
    update_count    INTEGER     NOT NULL DEFAULT 0,
    deactivate_count INTEGER    NOT NULL DEFAULT 0,
    role_count      INTEGER     NOT NULL DEFAULT 0,
    employee_count  INTEGER     NOT NULL DEFAULT 0,
    created_by      UUID        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_org_import_jobs_tenant_created
    ON legal_org_import_jobs (tenant_id, created_at DESC);

ALTER TABLE legal_org_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_org_import_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_org_import_jobs
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_org_import_jobs
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_org_import_jobs
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
