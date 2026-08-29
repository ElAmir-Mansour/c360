-- Revert WTQ-SEC-03 tenant residency binding.
DROP INDEX IF EXISTS idx_tenants_residency_region;
ALTER TABLE tenants DROP COLUMN IF EXISTS residency_region;
