DROP INDEX IF EXISTS idx_legal_judgments_next_expected_ruling;
ALTER TABLE legal_judgments
    DROP CONSTRAINT IF EXISTS legal_judgments_impact_check,
    DROP CONSTRAINT IF EXISTS legal_judgments_decision_type_check,
    DROP COLUMN IF EXISTS next_expected_ruling,
    DROP COLUMN IF EXISTS next_expected_ruling_at,
    DROP COLUMN IF EXISTS document_reference,
    DROP COLUMN IF EXISTS implications,
    DROP COLUMN IF EXISTS court_name,
    DROP COLUMN IF EXISTS judge_name,
    DROP COLUMN IF EXISTS impact,
    DROP COLUMN IF EXISTS decision_type;

DROP INDEX IF EXISTS idx_legal_pleadings_response_deadline;
ALTER TABLE legal_pleadings
    DROP CONSTRAINT IF EXISTS legal_pleadings_direction_check,
    DROP COLUMN IF EXISTS response_owner_id,
    DROP COLUMN IF EXISTS response_deadline,
    DROP COLUMN IF EXISTS court_reference,
    DROP COLUMN IF EXISTS recipient,
    DROP COLUMN IF EXISTS direction;
ALTER TABLE legal_pleadings
    DROP CONSTRAINT IF EXISTS legal_pleadings_type_check;
ALTER TABLE legal_pleadings
    ADD CONSTRAINT legal_pleadings_type_check CHECK (type IN (
        'statement_of_claim', 'reply', 'brief', 'other'
    ));

DROP INDEX IF EXISTS idx_legal_case_documents_evidence_status;
ALTER TABLE legal_case_documents
    DROP CONSTRAINT IF EXISTS legal_case_documents_evidence_status_check,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS updated_by,
    DROP COLUMN IF EXISTS submitted_at,
    DROP COLUMN IF EXISTS submitted_by,
    DROP COLUMN IF EXISTS court_reference,
    DROP COLUMN IF EXISTS evidence_status;

ALTER TABLE legal_case_sub_audit_log
    DROP CONSTRAINT IF EXISTS legal_case_sub_audit_log_resource_type_check;
ALTER TABLE legal_case_sub_audit_log
    ADD CONSTRAINT legal_case_sub_audit_log_resource_type_check
    CHECK (resource_type IN ('party', 'hearing', 'task', 'comment', 'document_link'));

DROP TABLE IF EXISTS legal_case_milestones;

DROP INDEX IF EXISTS idx_legal_cases_expected_resolution;
ALTER TABLE legal_cases
    DROP CONSTRAINT IF EXISTS legal_cases_currency_format,
    DROP CONSTRAINT IF EXISTS legal_cases_legal_fees_nonnegative,
    DROP CONSTRAINT IF EXISTS legal_cases_court_fees_nonnegative,
    DROP CONSTRAINT IF EXISTS legal_cases_claim_amount_nonnegative,
    DROP COLUMN IF EXISTS expected_resolution_date,
    DROP COLUMN IF EXISTS currency,
    DROP COLUMN IF EXISTS legal_fees,
    DROP COLUMN IF EXISTS court_fees,
    DROP COLUMN IF EXISTS claim_amount,
    DROP COLUMN IF EXISTS filing_date,
    DROP COLUMN IF EXISTS chamber;
