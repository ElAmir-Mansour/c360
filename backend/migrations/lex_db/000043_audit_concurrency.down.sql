-- =============================================================================
-- Reverse Round 2 audit-log + concurrency migration (000043).
-- Drops ONLY what this de-scoped .up created: the calendar + service-catalog
-- audit tables and the settlement/judgment lock_version columns.
--
-- NOT touched here (owned by sibling migrations, dropped by their own .down):
--   * legal_request_audit_log / legal_sla_audit_log -> 000039_spine_sla_audit_log
--   * legal_cases.lock_version                       -> 000040_legal_case_depth
--   * legal_obligations.judgment_id + guard          -> 000038_litigation_*
-- =============================================================================

-- (3) Optimistic-concurrency columns added by this migration.
ALTER TABLE legal_judgments
    DROP COLUMN IF EXISTS lock_version;
ALTER TABLE legal_settlement
    DROP COLUMN IF EXISTS lock_version;

-- (1)/(2) Append-only audit tables (policies drop with the table).
DROP TABLE IF EXISTS legal_service_catalog_audit_log;
DROP TABLE IF EXISTS legal_calendar_audit_log;
