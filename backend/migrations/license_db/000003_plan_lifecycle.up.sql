-- Add catalog lifecycle status for license plans. Retired catalog plans remain
-- readable and continue to back existing tenant licenses, but are hidden from
-- the assignable catalog and cannot receive new assignments.

ALTER TABLE license_plans
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'license_plans_status_check'
          AND conrelid = 'license_plans'::regclass
    ) THEN
        ALTER TABLE license_plans
            ADD CONSTRAINT license_plans_status_check
            CHECK (status IN ('active', 'retired'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_license_plans_catalog_active
    ON license_plans (key)
    WHERE source = 'catalog' AND status = 'active';
