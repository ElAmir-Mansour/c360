-- Revert the sync-run mode CHECK to the original ('full','delta') domain.
-- Any pre-existing mode='preview' rows would violate the narrower CHECK, so they
-- are demoted to 'full' first (preview rows committed nothing; this only affects
-- the ledger label).
UPDATE lex_integration_sync_runs SET mode = 'full' WHERE mode = 'preview';

ALTER TABLE lex_integration_sync_runs
    DROP CONSTRAINT IF EXISTS lex_integration_sync_runs_mode_check;
ALTER TABLE lex_integration_sync_runs
    ADD CONSTRAINT lex_integration_sync_runs_mode_check
    CHECK (mode IN ('full', 'delta'));
