-- Reverse the plan catalog seed and the development license assignment.
-- tenant_licenses is removed first (it references license_plans without
-- cascade); plan_entitlements cascade with their plan.

BEGIN;

DELETE FROM tenant_licenses
WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND plan_id = '11111111-1111-1111-1111-111111111111';

DELETE FROM license_plans
WHERE key IN ('business-plus', 'enterprise');

COMMIT;
