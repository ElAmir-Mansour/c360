-- Org & Entity Master-Data Registry (CAP-008, CAP-017, CAP-018, CAP-019, CAP-106, CAP-153).
-- The unowned blocker behind ~8 Watheeq Musts: SLA escalation ladder, eligibility,
-- and distribution all read this hierarchy. platform_org_unit_id is a soft (NULL)
-- projection onto platform_core org-units; no cross-DB FK is declared because
-- lex_db and platform_core are independent databases.

CREATE TABLE IF NOT EXISTS legal_org_entities (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL,
    parent_id            UUID        REFERENCES legal_org_entities(id) ON DELETE RESTRICT,
    entity_type          TEXT        NOT NULL DEFAULT 'department' CHECK (entity_type IN (
        'business_unit', 'company', 'department', 'section', 'shared_services_unit'
    )),
    code                 TEXT        NOT NULL,
    name                 JSONB       NOT NULL DEFAULT '{}',
    platform_org_unit_id UUID,
    path                 TEXT[]      NOT NULL DEFAULT '{}',
    active               BOOLEAN     NOT NULL DEFAULT true,
    metadata             JSONB       NOT NULL DEFAULT '{}',
    created_by           UUID        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_org_entities_code_unique
    ON legal_org_entities (tenant_id, code)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_org_entities_tenant_type
    ON legal_org_entities (tenant_id, entity_type, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_org_entities_parent
    ON legal_org_entities (tenant_id, parent_id)
    WHERE parent_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_org_entities_platform_unit
    ON legal_org_entities (tenant_id, platform_org_unit_id)
    WHERE platform_org_unit_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS legal_org_roles (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    entity_id   UUID        NOT NULL REFERENCES legal_org_entities(id) ON DELETE CASCADE,
    role_key    TEXT        NOT NULL CHECK (role_key IN (
        'section_supervisor', 'department_manager', 'shared_services_manager',
        'legal_director', 'contracts_manager', 'compliance_officer', 'general_counsel'
    )),
    user_id     UUID        NOT NULL,
    label       JSONB       NOT NULL DEFAULT '{}',
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

-- One active binding per (entity, role_key); supports UpsertRole's ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_org_roles_entity_role_unique
    ON legal_org_roles (tenant_id, entity_id, role_key)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_org_roles_entity
    ON legal_org_roles (tenant_id, entity_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_org_roles_user
    ON legal_org_roles (tenant_id, user_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_org_roles_role_key
    ON legal_org_roles (tenant_id, role_key)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_org_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_org_entities FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_org_entities
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_org_entities
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_org_entities
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_org_entities
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE legal_org_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_org_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_org_roles
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_org_roles
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_org_roles
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_org_roles
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
