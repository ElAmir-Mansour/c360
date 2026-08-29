-- =============================================================================
-- Lex Integration Platform — admit the 'preview' (dry-run) sync mode.
--
--   Feature 3 (dry-run preview) records a sync-run ledger row with mode='preview'
--   that computes would-be counts but COMMITS NOTHING. The 000058 CHECK only
--   admitted ('full','delta'); widen it to add 'preview'. Drop-if-exists guards
--   re-runs. No data is touched; this is a constraint-only change.
--
--   No other schema is required for the remaining integration-console UX features:
--   secret-rotation timestamps (last_rotated.<field>) and the last-received-event
--   marker (last_received_event_at) live in lex_integration_endpoints.metadata
--   (JSONB); health-check history is its own staged table.
--
-- Integrator: number this AFTER the health-checks staged migration (000064);
-- i.e. 000065 (verified next free at implement time; prior max = 000063, with
-- 000064 reserved by integration_health_checks).
-- =============================================================================

ALTER TABLE lex_integration_sync_runs
    DROP CONSTRAINT IF EXISTS lex_integration_sync_runs_mode_check;
ALTER TABLE lex_integration_sync_runs
    ADD CONSTRAINT lex_integration_sync_runs_mode_check
    CHECK (mode IN ('full', 'delta', 'preview'));
