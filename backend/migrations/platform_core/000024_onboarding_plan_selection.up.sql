ALTER TABLE tenant_onboarding
    ADD COLUMN IF NOT EXISTS plan_key TEXT NOT NULL DEFAULT 'trial',
    ADD COLUMN IF NOT EXISTS seats INT NOT NULL DEFAULT 5;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tenant_onboarding_plan_key_not_empty'
    ) THEN
        ALTER TABLE tenant_onboarding
            ADD CONSTRAINT tenant_onboarding_plan_key_not_empty CHECK (length(trim(plan_key)) > 0);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tenant_onboarding_seats_positive'
    ) THEN
        ALTER TABLE tenant_onboarding
            ADD CONSTRAINT tenant_onboarding_seats_positive CHECK (seats > 0);
    END IF;
END $$;

UPDATE tenant_onboarding
SET plan_key = COALESCE(NULLIF(trim(plan_key), ''), 'trial'),
    seats = CASE WHEN seats > 0 THEN seats ELSE 5 END;
