DROP INDEX IF EXISTS idx_legal_cases_court;
DROP INDEX IF EXISTS idx_legal_cases_contract;

ALTER TABLE legal_cases
    DROP CONSTRAINT IF EXISTS legal_cases_request_tenant_fk,
    DROP CONSTRAINT IF EXISTS legal_cases_court_tenant_fk,
    DROP CONSTRAINT IF EXISTS legal_cases_contract_tenant_fk,
    DROP CONSTRAINT IF EXISTS legal_cases_single_source_link,
    DROP COLUMN IF EXISTS other_case_type,
    DROP COLUMN IF EXISTS court_id,
    DROP COLUMN IF EXISTS contract_id;

DROP INDEX IF EXISTS idx_legal_requests_tenant_id_unique;
DROP INDEX IF EXISTS idx_contracts_tenant_id_unique;
DROP TABLE IF EXISTS legal_courts;
