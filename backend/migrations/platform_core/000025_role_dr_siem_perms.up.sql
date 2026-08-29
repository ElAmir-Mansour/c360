-- Grant the ClarioDR (dr) and SIEM (siem) suites to the suite-spanning system
-- roles. Both suites were added after the original role seed, so existing
-- tenant-admin / executive roles never received dr:* / siem:* — which hides the
-- "Disaster Recovery" and SIEM suites from the suite switcher (it gates on
-- hasPermission('dr:read') / hasPermission('siem:read')) even when the tenant is
-- entitled to them. Idempotent: re-applying is a no-op (the WHERE guards skip
-- roles that already carry the permissions, and jsonb_agg(DISTINCT ...) dedupes).

-- Tenant Admin → full access to both suites (mirrors its cyber:* / data:* / lex:* grants).
UPDATE roles
SET permissions = (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(permissions || '["dr:*","siem:*"]'::jsonb)),
    updated_at = now()
WHERE slug = 'tenant-admin'
  AND NOT (permissions @> '["dr:*","siem:*"]'::jsonb);

-- Executive → read visibility across both suites (mirrors its cross-suite *:read grants).
UPDATE roles
SET permissions = (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(permissions || '["dr:read","siem:read"]'::jsonb)),
    updated_at = now()
WHERE slug = 'executive'
  AND NOT (permissions @> '["dr:read","siem:read"]'::jsonb);
