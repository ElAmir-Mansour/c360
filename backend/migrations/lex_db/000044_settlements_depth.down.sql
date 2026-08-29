-- =============================================================================
-- Down — Round 2 Settlements depth
-- =============================================================================
ALTER TABLE legal_settlement DROP CONSTRAINT IF EXISTS chk_legal_settlement_status;
DROP INDEX IF EXISTS idx_legal_settlement_matter_status;
DROP INDEX IF EXISTS idx_legal_settlement_executed_per_matter;
