-- Replace Tenant Admin's broad Watheeq wildcard with explicit tenant
-- configuration and coarse CRUD grants. Legal operational decisions remain
-- governed by the legal role matrix (case/contract approve, close, assignment,
-- and distribution are intentionally absent).
WITH tenant_admin_lex_grants(permission) AS (
    VALUES
        ('lex:read'), ('lex:write'),
        ('lex:approval:read'), ('lex:approval:write'), ('lex:approval:admin'),
        ('lex:report:read'),
        ('lex:view'), ('lex:add'), ('lex:edit'),
        ('lex:integration:read'), ('lex:integration:manage'),
        ('lex:sla:manage'), ('lex:escalation:manage'),
        ('lex:notification:manage'), ('lex:catalog:manage'),
        ('lex:role:assign'), ('lex:role:manage'),
        ('lex:audit:read'), ('lex:security:manage'), ('lex:reference:view')
)
UPDATE roles AS r
SET permissions = (
    SELECT jsonb_agg(permission ORDER BY permission)
    FROM (
        SELECT DISTINCT value #>> '{}' AS permission
        FROM jsonb_array_elements(r.permissions) AS value
        WHERE value NOT IN (
            '"lex:*"'::jsonb,
            '"lex:approve"'::jsonb,
            '"lex:close"'::jsonb
        )
        UNION
        SELECT permission FROM tenant_admin_lex_grants
    ) AS effective_permissions
)
WHERE replace(r.slug, '_', '-') = 'tenant-admin';
