-- SIEM-01 — extend the platform RBAC catalogue with siem:* permissions.
--
-- The platform stores permissions as a JSONB array on the `roles` table.
-- This migration appends the SIEM strings to every system role that
-- already exists, for every tenant. It does not create new roles.
-- Custom tenant-defined roles are not touched.
--
-- The migration is idempotent: each insertion uses a NOT-IN guard, so
-- re-running yields a no-op.
--
-- Affected roles (by slug):
--   - super-admin     → siem:supervisory_view (admin:* wildcard
--                       already covers every siem:* via
--                       backend/internal/auth/rbac.go HasPermission).
--   - tenant-admin    → all eight siem:* permissions.
--   - analyst         → siem:read, siem:hunt.
--   - viewer          → siem:read.
--
-- The `responder`, `content_author` and `compliance` roles called out
-- in PROMPT 01 do not exist in the seeded role set and are NOT created.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.siem_add_perm(p_slug TEXT, p_perm TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE roles
    SET    permissions = permissions || to_jsonb(p_perm),
           updated_at  = now()
    WHERE  slug = p_slug
      AND  is_system_role = true
      AND  NOT (permissions ? p_perm);
END;
$$ LANGUAGE plpgsql;

-- super-admin: explicit cross-tenant capability.
SELECT pg_temp.siem_add_perm('super-admin', 'siem:supervisory_view');

-- tenant-admin: full SIEM permission set within a tenant.
SELECT pg_temp.siem_add_perm('tenant-admin', 'siem:read');
SELECT pg_temp.siem_add_perm('tenant-admin', 'siem:write');
SELECT pg_temp.siem_add_perm('tenant-admin', 'siem:hunt');
SELECT pg_temp.siem_add_perm('tenant-admin', 'siem:respond');
SELECT pg_temp.siem_add_perm('tenant-admin', 'siem:content_author');
SELECT pg_temp.siem_add_perm('tenant-admin', 'siem:compliance_attest');
SELECT pg_temp.siem_add_perm('tenant-admin', 'siem:admin');

-- analyst: read + hunt.
SELECT pg_temp.siem_add_perm('analyst', 'siem:read');
SELECT pg_temp.siem_add_perm('analyst', 'siem:hunt');

-- viewer: read.
SELECT pg_temp.siem_add_perm('viewer', 'siem:read');

COMMIT;
