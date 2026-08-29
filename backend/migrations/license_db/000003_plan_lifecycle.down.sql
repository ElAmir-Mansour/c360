DROP INDEX IF EXISTS idx_license_plans_catalog_active;

ALTER TABLE license_plans
    DROP CONSTRAINT IF EXISTS license_plans_status_check;

ALTER TABLE license_plans
    DROP COLUMN IF EXISTS status;
