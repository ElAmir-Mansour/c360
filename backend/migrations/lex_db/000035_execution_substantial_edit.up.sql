-- CAP-024 — Substantial-edit re-evaluation marker.  [STAGED — integrator renumbers from 000035+]
--
-- Purely ADDITIVE and OPTIONAL. The substantial-edit re-evaluation (CAP-024) is
-- already fully recorded WITHOUT this column:
--   * each re-evaluation appends an immutable `execution.substantial_edit` row to
--     legal_request_execution_audit_log (action + from/to status + reasons +
--     changes), and
--   * the running counter + last reasons are written to
--     legal_request_execution_state.metadata (jsonb): substantial_edit_count,
--     last_substantial_edit_reasons.
--
-- This migration only DENORMALISES a queryable timestamp so dashboards/reports
-- can filter "requests re-opened by a substantial edit" without scanning the
-- audit log or unpacking jsonb. The Go service does NOT depend on it (it writes
-- the metadata keys above); apply it only if you want the indexed column, and
-- have the request-update path set it (or backfill from the audit log).
--
-- Conventions (mirroring 000024_execution_rules.up.sql): tenant_id-leading
-- partial index; column is nullable so the table stays valid when empty.

ALTER TABLE legal_request_execution_state
    ADD COLUMN IF NOT EXISTS last_substantial_edit_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_lex_exec_state_substantial_edit
    ON legal_request_execution_state (tenant_id, last_substantial_edit_at)
    WHERE last_substantial_edit_at IS NOT NULL;
