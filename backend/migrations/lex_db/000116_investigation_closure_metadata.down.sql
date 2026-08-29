ALTER TABLE legal_investigations
    DROP CONSTRAINT IF EXISTS ck_legal_investigations_terminal_closed_at;

ALTER TABLE legal_investigations
    DROP COLUMN IF EXISTS closure_reason,
    DROP COLUMN IF EXISTS closed_at,
    DROP COLUMN IF EXISTS closed_by;
