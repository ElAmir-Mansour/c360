-- CAP-006, CAP-007: subject-agnostic request-approval policy stack.
--
-- Lifts the contract approval-policy schema (000009 + 000016) onto legal
-- *requests*: the scope dimension is request_type (plus an optional service_id,
-- a requester|provider stage, an optional department + priority_tier, and an
-- optional numeric value range) instead of contract_type. The routing surface
-- and the governance trio (immutable versions, append-only audit, reusable
-- templates) mirror the contract stack. All tables are tenant-scoped (the live
-- control is the explicit WHERE tenant_id filter in the repositories) and soft-
-- deletable where mutable. The RLS policies on app.current_tenant_id added
-- below are currently inert under the superuser lex pool (see 000002).

-- 1. Core policy table ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_request_approval_policies (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                  UUID        NOT NULL,
    name                       TEXT        NOT NULL,
    description                TEXT        NOT NULL DEFAULT '',
    status                     TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'archived')),
    priority                   INT         NOT NULL DEFAULT 0,
    request_type               TEXT,
    service_id                 UUID,
    stage                      TEXT
        CHECK (stage IS NULL OR stage IN ('requester', 'provider')),
    department                 TEXT,
    priority_tier              TEXT,
    min_value                  DECIMAL(18,2),
    max_value                  DECIMAL(18,2),
    currency                   TEXT        NOT NULL DEFAULT 'SAR',
    mode                       TEXT        NOT NULL DEFAULT 'parallel'
        CHECK (mode IN ('sequential', 'parallel')),
    quorum                     TEXT        NOT NULL DEFAULT 'all'
        CHECK (quorum IN ('all', 'any', 'n_of_m')),
    quorum_n                   INT,
    approvers                  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    form_fields                JSONB       NOT NULL DEFAULT '[]'::jsonb,
    require_authority_evidence BOOLEAN     NOT NULL DEFAULT true,
    required_role              TEXT,
    required_authority_amount  DECIMAL(18,2),
    metadata                   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    version                    INT         NOT NULL DEFAULT 1,
    valid_from                 TIMESTAMPTZ,
    valid_until                TIMESTAMPTZ,
    template_id                UUID,
    created_by                 UUID        NOT NULL,
    updated_by                 UUID,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at                 TIMESTAMPTZ,
    CHECK (btrim(name) <> ''),
    CHECK (version >= 1),
    CHECK (min_value IS NULL OR min_value >= 0),
    CHECK (max_value IS NULL OR max_value >= 0),
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value),
    CHECK (required_authority_amount IS NULL OR required_authority_amount >= 0),
    CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until),
    CHECK ((quorum = 'n_of_m' AND quorum_n IS NOT NULL AND quorum_n > 0) OR (quorum <> 'n_of_m' AND quorum_n IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_request_approval_policies_name
    ON legal_request_approval_policies (tenant_id, lower(name))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_legal_request_approval_policies_match
    ON legal_request_approval_policies (tenant_id, status, priority DESC, request_type, service_id, stage, currency)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_legal_request_approval_policies_window
    ON legal_request_approval_policies (tenant_id, status, valid_from, valid_until)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_request_approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_approval_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_approval_policies
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_approval_policies
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_request_approval_policies
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_request_approval_policies
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- 2. Immutable version history --------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_request_approval_policy_versions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id     UUID        NOT NULL,
    tenant_id     UUID        NOT NULL,
    version       INT         NOT NULL CHECK (version >= 1),
    snapshot      JSONB       NOT NULL,
    change_reason TEXT        NOT NULL DEFAULT '',
    created_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_legal_request_approval_policy_versions_policy
        FOREIGN KEY (policy_id) REFERENCES legal_request_approval_policies (id) ON DELETE CASCADE,
    CONSTRAINT uq_legal_request_approval_policy_versions_policy_version UNIQUE (policy_id, version)
);

CREATE INDEX IF NOT EXISTS idx_legal_request_approval_policy_versions_policy
    ON legal_request_approval_policy_versions (policy_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_legal_request_approval_policy_versions_tenant
    ON legal_request_approval_policy_versions (tenant_id, created_at DESC);

ALTER TABLE legal_request_approval_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_approval_policy_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_approval_policy_versions
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_approval_policy_versions
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
-- No UPDATE/DELETE policies: version rows are immutable history.

-- 3. Append-only audit log ------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_request_approval_policy_audit_log (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL,
    policy_id  UUID        NOT NULL,
    action     TEXT        NOT NULL,
    actor_id   UUID,
    before     JSONB,
    after      JSONB,
    request_id TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_request_approval_policy_audit_policy
    ON legal_request_approval_policy_audit_log (policy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_request_approval_policy_audit_tenant
    ON legal_request_approval_policy_audit_log (tenant_id, created_at DESC);

ALTER TABLE legal_request_approval_policy_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_approval_policy_audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_approval_policy_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_approval_policy_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
-- No UPDATE/DELETE policies: the audit log is append-only.

-- 4. Reusable templates ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_request_approval_policy_templates (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    category    TEXT        NOT NULL DEFAULT '',
    definition  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by  UUID,
    updated_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CONSTRAINT uq_legal_request_approval_policy_templates_name UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_legal_request_approval_policy_templates_tenant
    ON legal_request_approval_policy_templates (tenant_id, category, name);

ALTER TABLE legal_request_approval_policy_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_approval_policy_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_approval_policy_templates
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_approval_policy_templates
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_request_approval_policy_templates
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_request_approval_policy_templates
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Link policies back to the template they were materialised from (nullable;
-- SET NULL on template deletion).
ALTER TABLE legal_request_approval_policies
    DROP CONSTRAINT IF EXISTS fk_legal_request_approval_policies_template;
ALTER TABLE legal_request_approval_policies
    ADD CONSTRAINT fk_legal_request_approval_policies_template
        FOREIGN KEY (template_id) REFERENCES legal_request_approval_policy_templates (id) ON DELETE SET NULL;
