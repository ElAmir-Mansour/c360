-- =============================================================================
-- Clario 360 — Attribute-Based Access Control (ABAC) policies  [WTQ-SEC-01]
-- Database: platform_core
-- Adds a tenant-scoped attribute-policy layer that is ADDITIVE to the existing
-- role-based permission system. With no rows present, ABAC is a no-op and the
-- platform behaves exactly as it did under pure RBAC.
-- =============================================================================

CREATE TABLE IF NOT EXISTS abac_policies (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT         NOT NULL,
    description   TEXT,
    effect        TEXT         NOT NULL DEFAULT 'allow'
                               CHECK (effect IN ('allow', 'deny')),
    action        TEXT         NOT NULL DEFAULT '*',  -- permission/action selector, '*' or 'resource:*' wildcards
    resource_type TEXT         NOT NULL DEFAULT '*',  -- resource type selector, '*' = any
    conditions    JSONB        NOT NULL DEFAULT '[]', -- array of {attribute, operator, value}
    priority      INT          NOT NULL DEFAULT 0,
    enabled       BOOLEAN      NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE abac_policies IS 'Tenant-scoped attribute-based access control policies (WTQ-SEC-01); additive to RBAC';
COMMENT ON COLUMN abac_policies.effect IS 'allow|deny — deny always overrides allow during evaluation';
COMMENT ON COLUMN abac_policies.action IS 'Action/permission selector this policy concerns; supports exact, "*" and "prefix:*" wildcards';
COMMENT ON COLUMN abac_policies.resource_type IS 'Resource type selector; "*" matches any resource type';
COMMENT ON COLUMN abac_policies.conditions IS 'JSON array of attribute conditions evaluated with logical AND';

CREATE INDEX IF NOT EXISTS idx_abac_policies_tenant
    ON abac_policies (tenant_id) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_abac_policies_lookup
    ON abac_policies (tenant_id, action, resource_type) WHERE enabled = true;

CREATE TRIGGER trg_abac_policies_updated_at
    BEFORE UPDATE ON abac_policies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row-Level Security: tenant isolation, mirroring the platform convention.
ALTER TABLE abac_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE abac_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON abac_policies
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON abac_policies
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON abac_policies
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON abac_policies
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
