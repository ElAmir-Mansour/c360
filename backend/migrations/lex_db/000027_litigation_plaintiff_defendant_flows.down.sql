-- Down migration for Phase 3 Plaintiff & Defendant Litigation Flows (CAP-052..073).
-- INTEGRATOR: renumber to match the .up.sql slot.

DROP TABLE IF EXISTS legal_defendant_attachments CASCADE;
DROP TABLE IF EXISTS legal_defendant_cases CASCADE;
DROP TABLE IF EXISTS legal_judgments CASCADE;
DROP TABLE IF EXISTS legal_expert_documents CASCADE;
DROP TABLE IF EXISTS legal_expert_assignments CASCADE;
DROP TABLE IF EXISTS legal_hearing_reports CASCADE;
DROP TABLE IF EXISTS legal_pleading_versions CASCADE;
DROP TABLE IF EXISTS legal_pleading_attachments CASCADE;
DROP TABLE IF EXISTS legal_pleadings CASCADE;

-- Revert the legal_obligations extension: restore the original
-- (contract_id OR matter_id) link CHECK and drop the case_id column.
ALTER TABLE legal_obligations DROP CONSTRAINT IF EXISTS chk_legal_obligations_link;
DROP INDEX IF EXISTS idx_legal_obligations_case;
ALTER TABLE legal_obligations DROP COLUMN IF EXISTS case_id;
ALTER TABLE legal_obligations
    ADD CONSTRAINT legal_obligations_check
    CHECK (contract_id IS NOT NULL OR matter_id IS NOT NULL);
