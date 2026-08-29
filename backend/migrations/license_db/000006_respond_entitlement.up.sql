INSERT INTO plan_entitlements (plan_id, key, limit_value)
SELECT id, 'respond.major_incident', NULL
FROM license_plans
WHERE key IN ('business-plus', 'enterprise', 'trial')
ON CONFLICT (plan_id, key) DO NOTHING;
