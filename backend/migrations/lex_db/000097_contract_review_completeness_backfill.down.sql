-- Reverse 000097.
--
-- 1. Remove the superseded draft rows this migration backfilled from contract
--    version history (the metadata marker is exclusive to this migration; the
--    000095 latest-version link uses source='contract_version_backfill').
DELETE FROM lex_contract_attachments
WHERE metadata->>'source' = 'contract_version_history_backfill';

-- 2. Restore the original four-slot CHECK constraints (000031). Rolling back the
--    widening requires no PRD §9.1 slot rows to be present, matching the pre-000097
--    state (OpenIntake seeded no PRD slots because the seed previously errored).
ALTER TABLE lex_contract_attachments
    DROP CONSTRAINT IF EXISTS lex_contract_attachments_slot_check;
ALTER TABLE lex_contract_attachments
    ADD CONSTRAINT lex_contract_attachments_slot_check
    CHECK (slot IN (
        'draft', 'quotation', 'commercial_registration', 'committee_decision'
    ));

ALTER TABLE lex_contract_attachment_requirements
    DROP CONSTRAINT IF EXISTS lex_contract_attachment_requirements_slot_check;
ALTER TABLE lex_contract_attachment_requirements
    ADD CONSTRAINT lex_contract_attachment_requirements_slot_check
    CHECK (slot IN (
        'draft', 'quotation', 'commercial_registration', 'committee_decision'
    ));
