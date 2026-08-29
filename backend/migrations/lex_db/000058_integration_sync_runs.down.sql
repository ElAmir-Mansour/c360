-- Reverse 000058: drop the sync-run ledger and restore the original kind CHECK.

DROP TABLE IF EXISTS lex_integration_sync_runs;

ALTER TABLE lex_integration_endpoints
    DROP CONSTRAINT IF EXISTS lex_integration_endpoints_kind_check;
ALTER TABLE lex_integration_endpoints
    ADD CONSTRAINT lex_integration_endpoints_kind_check
    CHECK (kind IN (
        'najiz', 'hr', 'internal', 'archiving', 'email'
    ));
