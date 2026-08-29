-- Reverse of 000014_siem_permissions.up.sql.
--
-- Removes every SIEM permission string from the JSONB arrays on the
-- four system roles. Custom tenant-defined roles are not touched.
-- Re-running is a no-op.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.siem_remove_perm(p_slug TEXT, p_perm TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE roles
    SET    permissions = COALESCE(
              (
                  SELECT jsonb_agg(elem)
                  FROM   jsonb_array_elements_text(permissions) elem
                  WHERE  elem <> p_perm
              ),
              '[]'::jsonb
           ),
           updated_at  = now()
    WHERE  slug = p_slug
      AND  is_system_role = true
      AND  permissions ? p_perm;
END;
$$ LANGUAGE plpgsql;

SELECT pg_temp.siem_remove_perm('super-admin', 'siem:supervisory_view');

SELECT pg_temp.siem_remove_perm('tenant-admin', 'siem:read');
SELECT pg_temp.siem_remove_perm('tenant-admin', 'siem:write');
SELECT pg_temp.siem_remove_perm('tenant-admin', 'siem:hunt');
SELECT pg_temp.siem_remove_perm('tenant-admin', 'siem:respond');
SELECT pg_temp.siem_remove_perm('tenant-admin', 'siem:content_author');
SELECT pg_temp.siem_remove_perm('tenant-admin', 'siem:compliance_attest');
SELECT pg_temp.siem_remove_perm('tenant-admin', 'siem:admin');

SELECT pg_temp.siem_remove_perm('analyst', 'siem:read');
SELECT pg_temp.siem_remove_perm('analyst', 'siem:hunt');

SELECT pg_temp.siem_remove_perm('viewer', 'siem:read');

COMMIT;
