-- Reversible: drop the pricing_config table and its indexes. IF EXISTS keeps
-- the down migration idempotent. No other table is affected.
DROP INDEX IF EXISTS idx_pricing_config_effective;
DROP INDEX IF EXISTS uq_pricing_config_single_active;
DROP TABLE IF EXISTS pricing_config;
