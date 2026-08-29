-- Remove the dr / siem grants added in the up migration.
UPDATE roles
SET permissions = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(permissions)
                            WHERE value NOT IN ('"dr:*"'::jsonb, '"siem:*"'::jsonb)), '[]'::jsonb),
    updated_at = now()
WHERE slug = 'tenant-admin';

UPDATE roles
SET permissions = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(permissions)
                            WHERE value NOT IN ('"dr:read"'::jsonb, '"siem:read"'::jsonb)), '[]'::jsonb),
    updated_at = now()
WHERE slug = 'executive';
