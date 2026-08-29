-- Revert the tenant role-matrix import storage. NOTE: dropping roles.source /
-- roles.active / roles.matrix_version loses import provenance; any tenant whose
-- enforcement relied on an activated overlay falls back to the Go code-map
-- defaults (the platform-safe floor).

DROP TABLE IF EXISTS legal_role_matrix_imports;
DROP TABLE IF EXISTS legal_role_matrix_versions;

ALTER TABLE roles DROP CONSTRAINT IF EXISTS chk_roles_source;
ALTER TABLE roles
    DROP COLUMN IF EXISTS matrix_version,
    DROP COLUMN IF EXISTS active,
    DROP COLUMN IF EXISTS source;
