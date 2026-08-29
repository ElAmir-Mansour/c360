-- Restore the pre-000028 broad grant. Explicit grants may remain because lex:*
-- subsumes them and retaining them avoids deleting any independently assigned
-- tenant configuration permission during rollback.
UPDATE roles AS r
SET permissions = permissions || '["lex:*"]'::jsonb
WHERE replace(r.slug, '_', '-') = 'tenant-admin'
  AND NOT permissions @> '["lex:*"]'::jsonb;
