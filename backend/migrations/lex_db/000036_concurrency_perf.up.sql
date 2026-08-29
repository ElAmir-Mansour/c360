-- Round 1 maturation: optimistic-concurrency column + performance indexes.
-- Numbered 000036 (000035 was the prior highest in lex_db).
--
-- Verified against migrations 000018-000035:
--   * legal_requests                  : has created_at/updated_at/deleted_at (000020)
--   * legal_cases                     : has created_at/updated_at/deleted_at, hearings child (000026)
--   * contracts                       : has created_at/updated_at/deleted_at (000001)
--   * legal_consultations             : has created_at/updated_at/deleted_at (000029)
--   * legal_request_execution_state   : has clock_started_at, NO deleted_at (000024)
--   * legal_sla_clocks                : has clock_started_at/outcome/breached, NO deleted_at (000023)
--   * legal_case_hearings             : has hearing_date, deleted_at (000026)

-- (1) Optimistic-concurrency column on legal_requests.
--     Default 0 backfills existing rows; NOT NULL so callers always read/write it.
ALTER TABLE legal_requests
    ADD COLUMN IF NOT EXISTS lock_version INTEGER NOT NULL DEFAULT 0;

-- (2) Performance indexes. Tenant-leading; partial WHERE deleted_at IS NULL
--     only on tables that actually have a deleted_at column.

-- Listing / chronological scans on the major aggregates (have deleted_at).
CREATE INDEX IF NOT EXISTS idx_legal_cases_tenant_created
    ON legal_cases (tenant_id, created_at)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_tenant_created
    ON contracts (tenant_id, created_at)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_legal_consultations_tenant_created
    ON legal_consultations (tenant_id, created_at)
    WHERE deleted_at IS NULL;

-- Execution clock lookups (no deleted_at column -> no partial predicate).
CREATE INDEX IF NOT EXISTS idx_lex_exec_state_tenant_clock_started
    ON legal_request_execution_state (tenant_id, clock_started_at);

-- SLA KPI roll-ups: drives the quarterly >=90% on-time KPI and breach scans
-- (no deleted_at column -> no partial predicate).
CREATE INDEX IF NOT EXISTS idx_legal_sla_clocks_tenant_clock_outcome
    ON legal_sla_clocks (tenant_id, clock_started_at, outcome, breached);

-- Upcoming-hearing calendar queries (has deleted_at).
CREATE INDEX IF NOT EXISTS idx_legal_case_hearings_tenant_hearing_date
    ON legal_case_hearings (tenant_id, hearing_date)
    WHERE deleted_at IS NULL;

-- Recently-updated feeds (have deleted_at).
CREATE INDEX IF NOT EXISTS idx_legal_cases_tenant_updated
    ON legal_cases (tenant_id, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_legal_requests_tenant_updated
    ON legal_requests (tenant_id, updated_at DESC)
    WHERE deleted_at IS NULL;
