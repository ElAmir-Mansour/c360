-- Backfill the ClarioDR gateway entitlement for databases that applied the
-- original seed migration before suite.datastream was added to the plan catalog.

INSERT INTO plan_entitlements (plan_id, key, limit_value)
SELECT id, 'suite.datastream', NULL
FROM license_plans
WHERE key IN ('business-plus', 'enterprise')
ON CONFLICT (plan_id, key) DO NOTHING;
