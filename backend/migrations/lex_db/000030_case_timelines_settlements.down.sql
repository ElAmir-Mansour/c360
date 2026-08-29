-- Reverse of Phase 3 — Case Timelines & Settlements/ADR (CAP-084..093). Drop the
-- settlement children before the legal_settlement parent; CASCADE removes RLS
-- policies + dependent indexes. Then drop the delay register, then strip the
-- timeline extension columns/constraint/index off legal_matters.

DROP TABLE IF EXISTS legal_settlement_audit_log CASCADE;
DROP TABLE IF EXISTS legal_settlement_negotiation_rounds CASCADE;
DROP TABLE IF EXISTS legal_settlement CASCADE;

DROP TABLE IF EXISTS legal_case_delay_events CASCADE;

DROP INDEX IF EXISTS idx_legal_matters_external_hold;
ALTER TABLE legal_matters
    DROP CONSTRAINT IF EXISTS legal_matters_external_hold_category_check;
ALTER TABLE legal_matters
    DROP COLUMN IF EXISTS estimated_duration_days,
    DROP COLUMN IF EXISTS estimated_completion_date,
    DROP COLUMN IF EXISTS external_hold,
    DROP COLUMN IF EXISTS external_hold_category,
    DROP COLUMN IF EXISTS external_hold_since,
    DROP COLUMN IF EXISTS closure_reason;
