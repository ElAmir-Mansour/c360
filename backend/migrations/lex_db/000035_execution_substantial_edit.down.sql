-- Down: drop the CAP-024 substantial-edit denormalisation (see .up.sql).
DROP INDEX IF EXISTS idx_lex_exec_state_substantial_edit;

ALTER TABLE legal_request_execution_state
    DROP COLUMN IF EXISTS last_substantial_edit_at;
