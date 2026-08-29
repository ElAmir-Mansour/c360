ALTER TABLE tenant_onboarding
    DROP CONSTRAINT IF EXISTS tenant_onboarding_plan_key_not_empty,
    DROP CONSTRAINT IF EXISTS tenant_onboarding_seats_positive,
    DROP COLUMN IF EXISTS seats,
    DROP COLUMN IF EXISTS plan_key;
