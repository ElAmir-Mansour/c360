-- Tenant Role-Matrix Import (Lex_Role_Matrix_Import_Design.md).
--
-- Governance storage for per-tenant, template-driven role→permission imports:
--   1. roles gains provenance columns so an activated import is distinguishable
--      from seeded/manual rows (the enforcement overlay loads ONLY
--      source='import' AND active rows — seeded tenants keep resolving from the
--      Go code map exactly as today).
--   2. legal_role_matrix_versions: immutable, per-tenant, reason-tagged
--      snapshots (draft → active → superseded). ONE active version per tenant.
--   3. legal_role_matrix_imports: every dry-run/commit attempt with its
--      validation errors, warnings and diff (append-only job log).
--
-- Tenant isolation: the roles table itself carries no RLS (IAM-managed); these
-- sibling tables follow the same model — every query in the service layer is
-- tenant-scoped (WHERE tenant_id = $1) and handlers derive the tenant solely
-- from the authenticated context.

ALTER TABLE roles
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'seed',
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS matrix_version INT;

COMMENT ON COLUMN roles.source IS 'Row provenance: seed (platform seeder), import (activated role-matrix import), manual (role UI).';
COMMENT ON COLUMN roles.active IS 'false parks a role without deleting it; inactive roles are never loaded into the enforcement overlay.';
COMMENT ON COLUMN roles.matrix_version IS 'legal_role_matrix_versions.version that last wrote this row (import provenance).';

-- Guard the provenance vocabulary (additive; existing rows default to seed).
ALTER TABLE roles DROP CONSTRAINT IF EXISTS chk_roles_source;
ALTER TABLE roles
    ADD CONSTRAINT chk_roles_source CHECK (source IN ('seed', 'import', 'manual'));

CREATE TABLE IF NOT EXISTS legal_role_matrix_versions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    version         INT         NOT NULL CHECK (version > 0),
    status          TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'superseded')),
    source_filename TEXT        NOT NULL DEFAULT '',
    checksum        TEXT        NOT NULL DEFAULT '',
    change_reason   TEXT        NOT NULL DEFAULT '',
    snapshot        JSONB       NOT NULL,
    created_by      UUID        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_by    UUID,
    activated_at    TIMESTAMPTZ,
    CONSTRAINT uq_role_matrix_versions_tenant_version UNIQUE (tenant_id, version)
);

-- Exactly one enforced matrix per tenant at any moment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_matrix_versions_one_active
    ON legal_role_matrix_versions (tenant_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_role_matrix_versions_tenant
    ON legal_role_matrix_versions (tenant_id, version DESC);

COMMENT ON TABLE legal_role_matrix_versions IS 'Per-tenant, immutable role-matrix snapshots (tenant role-matrix import): draft -> active -> superseded; rollback re-activates a prior version.';

CREATE TABLE IF NOT EXISTS legal_role_matrix_imports (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    version_id      UUID        REFERENCES legal_role_matrix_versions(id) ON DELETE SET NULL,
    mode            TEXT        NOT NULL DEFAULT 'merge' CHECK (mode IN ('merge', 'replace')),
    dry_run         BOOLEAN     NOT NULL DEFAULT true,
    status          TEXT        NOT NULL CHECK (status IN ('validated', 'failed', 'committed')),
    source_filename TEXT        NOT NULL DEFAULT '',
    role_count      INT         NOT NULL DEFAULT 0,
    grant_count     INT         NOT NULL DEFAULT 0,
    error_count     INT         NOT NULL DEFAULT 0,
    warning_count   INT         NOT NULL DEFAULT 0,
    errors          JSONB       NOT NULL DEFAULT '[]',
    warnings        JSONB       NOT NULL DEFAULT '[]',
    diff            JSONB       NOT NULL DEFAULT '{}',
    created_by      UUID        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_matrix_imports_tenant
    ON legal_role_matrix_imports (tenant_id, created_at DESC);

COMMENT ON TABLE legal_role_matrix_imports IS 'Append-only log of role-matrix import attempts (dry-runs and commits) with validation errors, warnings and the computed diff.';
