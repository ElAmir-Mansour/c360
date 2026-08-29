-- Phase 4 — Reporting & KPIs (CAP-133..151).  [STAGED — integrator numbers 000032+]
--
-- Adds the processing-time fact store that the reporting consumer populates from
-- lex CloudEvents, plus the document full-text-search columns the spec asks the
-- reporting builder to PROPOSE on legal_documents (extended here, applied by the
-- integrator as part of this migration).
--
-- Most report queries read the Phase-0..3 source tables directly (legal_cases,
-- contracts, legal_consultations, legal_requests / legal_request_execution_state,
-- legal_sla_clocks). The flagship quarterly SLA compliance KPI intentionally
-- reads request-processing duration facts so C-2 transition coverage is visible
-- and auditable.
--
-- Conventions (mirroring the neighbouring lex migrations):
--   * tenant_id FIRST; tenant-leading partial indexes.
--   * ENABLE + FORCE RLS with 4 tenant policies on current_setting('app.current_tenant_id').
--   * gen_random_uuid(); created_at/updated_at timestamps.
--   * No reference-data seeds: this is a fact table populated at runtime by the
--     reporting consumer (cross-tenant fan-out happens implicitly per-event).

-- =============================================================================
-- lex_duration_facts — processing-time fact store (consumer-populated)
-- =============================================================================
CREATE TABLE IF NOT EXISTS lex_duration_facts (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    -- kind identifies the lifecycle window measured for one subject entity.
    kind             TEXT        NOT NULL CHECK (kind IN (
        'case_resolution', 'contract_review', 'consultation_answer', 'request_processing'
    )),
    -- subject_id is the entity the fact is about (case/contract/consultation/request id).
    subject_id       UUID        NOT NULL,
    department       TEXT,
    category         TEXT,
    started_at       TIMESTAMPTZ NOT NULL,
    ended_at         TIMESTAMPTZ NOT NULL,
    -- wall-clock minutes vs. working-calendar minutes (CAP working-day basis).
    duration_minutes INT         NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
    working_minutes  INT         NOT NULL DEFAULT 0 CHECK (working_minutes >= 0),
    -- SLA fields are populated for request_processing facts and drive CAP-151.
    sla_target_minutes INT       CHECK (sla_target_minutes IS NULL OR sla_target_minutes >= 0),
    sla_outcome      TEXT        CHECK (sla_outcome IS NULL OR sla_outcome IN ('pending', 'on_time', 'breached')),
    -- occurred_at is the terminal event instant; the upsert guard keeps the latest.
    occurred_at      TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_lex_duration_facts_window CHECK (ended_at >= started_at)
);

ALTER TABLE lex_duration_facts
    ADD COLUMN IF NOT EXISTS sla_target_minutes INT CHECK (sla_target_minutes IS NULL OR sla_target_minutes >= 0),
    ADD COLUMN IF NOT EXISTS sla_outcome TEXT CHECK (sla_outcome IS NULL OR sla_outcome IN ('pending', 'on_time', 'breached'));

-- One fact per (tenant, kind, subject): a later transition refreshes it in place
-- (idempotent ON CONFLICT in DurationFactRepository.Upsert).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_duration_facts_subject_unique
    ON lex_duration_facts (tenant_id, kind, subject_id);
-- Report scan: by-kind windowed averages ordered by occurrence.
CREATE INDEX IF NOT EXISTS idx_lex_duration_facts_kind_occurred
    ON lex_duration_facts (tenant_id, kind, occurred_at DESC);
-- Per-department rollups for the by-dept refinements.
CREATE INDEX IF NOT EXISTS idx_lex_duration_facts_department
    ON lex_duration_facts (tenant_id, kind, department)
    WHERE department IS NOT NULL;
-- Flagship SLA compliance scans request-processing fact outcomes by quarter.
CREATE INDEX IF NOT EXISTS idx_lex_duration_facts_sla_outcome
    ON lex_duration_facts (tenant_id, started_at DESC, sla_outcome)
    WHERE kind = 'request_processing' AND sla_outcome IS NOT NULL;

ALTER TABLE lex_duration_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_duration_facts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_duration_facts
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_duration_facts
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_duration_facts
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_duration_facts
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_documents full-text-search columns — REMOVED FROM THIS MIGRATION.
-- =============================================================================
-- INTEGRATOR NOTE (Phase-4 wiring): the document FTS columns the reporting
-- builder proposed here (content_text + a 'simple' tsvector) COLLIDE with the
-- canonical FTS shipped by 000032_crosscut_rbac_attachments_fts_integrations.sql
-- (extracted_text + a weighted 'english' tsvector with the GIN index that
-- repository/document_search_repo.go actually queries via websearch_to_tsquery).
-- Two ALTER TABLE ... ADD COLUMN search_vector statements cannot both apply, and
-- no lex code references content_text. The crosscut FTS is authoritative, so the
-- reporting migration now ships ONLY the lex_duration_facts table. The matching
-- DROP block has likewise been removed from 000034_reporting_kpis.down.sql.
