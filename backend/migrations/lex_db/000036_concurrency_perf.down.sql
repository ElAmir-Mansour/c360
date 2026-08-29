-- Down: reverse Round 1 maturation (concurrency column + performance indexes).
-- Numbered 000036 (paired with 000036_concurrency_perf.up.sql).

-- Drop indexes first, then the column.
DROP INDEX IF EXISTS idx_legal_requests_tenant_updated;
DROP INDEX IF EXISTS idx_legal_cases_tenant_updated;
DROP INDEX IF EXISTS idx_legal_case_hearings_tenant_hearing_date;
DROP INDEX IF EXISTS idx_legal_sla_clocks_tenant_clock_outcome;
DROP INDEX IF EXISTS idx_lex_exec_state_tenant_clock_started;
DROP INDEX IF EXISTS idx_legal_consultations_tenant_created;
DROP INDEX IF EXISTS idx_contracts_tenant_created;
DROP INDEX IF EXISTS idx_legal_cases_tenant_created;

ALTER TABLE legal_requests
    DROP COLUMN IF EXISTS lock_version;
