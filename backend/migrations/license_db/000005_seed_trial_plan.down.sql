-- Remove the trial plan. plan_entitlements cascade on plan delete. Any tenant
-- still on the trial plan blocks deletion (FK), which is intentional — reassign
-- those tenants before rolling back.
BEGIN;
DELETE FROM license_plans WHERE key = 'trial';
COMMIT;
