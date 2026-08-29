-- Reverse 000012_seed_tier_plans: remove exactly the four seeded tier plans.
-- plan_entitlements rows cascade via the ON DELETE CASCADE FK. Tenant licenses
-- that already point at a tier plan block deletion via the tenant_licenses FK;
-- that is intentional (do not silently orphan a live license on a down migrate).
BEGIN;

DELETE FROM license_plans
WHERE id IN (
    'cccccccc-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000004'
);

COMMIT;
