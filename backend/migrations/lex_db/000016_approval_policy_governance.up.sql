-- Feature 1 (approval-policy governance) data foundations.
--
-- Adds versioning + an immutable version-history table, an append-only audit log,
-- an effective-window (valid_from / valid_until) for policy expiry, a template
-- linkage, and a reusable templates table. All tables are tenant-scoped (the
-- live control is the explicit WHERE tenant_id filter in the repositories). The
-- RLS policies added below are consistent with the neighbouring lex migrations
-- but are currently inert under the superuser lex pool (see 000002).

-- 1. Extend the existing approval-policy table -----------------------------------
ALTER TABLE lex_approval_policies
    ADD COLUMN IF NOT EXISTS version     INT          NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS valid_from  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS template_id UUID;

-- version must be a positive, monotonically issued counter.
ALTER TABLE lex_approval_policies
    DROP CONSTRAINT IF EXISTS chk_lex_approval_policies_version;
ALTER TABLE lex_approval_policies
    ADD CONSTRAINT chk_lex_approval_policies_version CHECK (version >= 1);

-- effective window must be coherent when both bounds are set.
ALTER TABLE lex_approval_policies
    DROP CONSTRAINT IF EXISTS chk_lex_approval_policies_window;
ALTER TABLE lex_approval_policies
    ADD CONSTRAINT chk_lex_approval_policies_window
        CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until);

-- Active-policy selection filters on the effective window; index it to keep the
-- now() BETWEEN [valid_from, valid_until] probe cheap.
CREATE INDEX IF NOT EXISTS idx_lex_approval_policies_window
    ON lex_approval_policies (tenant_id, status, valid_from, valid_until)
    WHERE deleted_at IS NULL;

-- 2. Immutable version history --------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_approval_policy_versions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id     UUID        NOT NULL,
    tenant_id     UUID        NOT NULL,
    version       INT         NOT NULL CHECK (version >= 1),
    snapshot      JSONB       NOT NULL,
    change_reason TEXT        NOT NULL DEFAULT '',
    created_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_lex_approval_policy_versions_policy
        FOREIGN KEY (policy_id) REFERENCES lex_approval_policies (id) ON DELETE CASCADE,
    CONSTRAINT uq_lex_approval_policy_versions_policy_version UNIQUE (policy_id, version)
);

CREATE INDEX IF NOT EXISTS idx_lex_approval_policy_versions_policy
    ON lex_approval_policy_versions (policy_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_lex_approval_policy_versions_tenant
    ON lex_approval_policy_versions (tenant_id, created_at DESC);

ALTER TABLE lex_approval_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_approval_policy_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_approval_policy_versions
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_approval_policy_versions
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
-- No UPDATE/DELETE policies: version rows are immutable history.

-- 3. Append-only audit log ------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_approval_policy_audit_log (
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

CREATE INDEX IF NOT EXISTS idx_lex_approval_policy_audit_policy
    ON lex_approval_policy_audit_log (policy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lex_approval_policy_audit_tenant
    ON lex_approval_policy_audit_log (tenant_id, created_at DESC);

ALTER TABLE lex_approval_policy_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_approval_policy_audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_approval_policy_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_approval_policy_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
-- No UPDATE/DELETE policies: the audit log is append-only.

-- 4. Reusable templates ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_approval_policy_templates (
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
    CONSTRAINT uq_lex_approval_policy_templates_name UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_lex_approval_policy_templates_tenant
    ON lex_approval_policy_templates (tenant_id, category, name);

ALTER TABLE lex_approval_policy_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_approval_policy_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_approval_policy_templates
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_approval_policy_templates
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_approval_policy_templates
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_approval_policy_templates
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Now that the templates table exists, link policies back to the template they
-- were materialised from (nullable; SET NULL on template deletion).
ALTER TABLE lex_approval_policies
    DROP CONSTRAINT IF EXISTS fk_lex_approval_policies_template;
ALTER TABLE lex_approval_policies
    ADD CONSTRAINT fk_lex_approval_policies_template
        FOREIGN KEY (template_id) REFERENCES lex_approval_policy_templates (id) ON DELETE SET NULL;
