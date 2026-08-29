-- Investigation terminal attribution. The lifecycle UI needs an authoritative
-- actor/time/reason instead of inferring closure from updated_at or audit ordering.
ALTER TABLE legal_investigations
    ADD COLUMN IF NOT EXISTS closed_by UUID,
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closure_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE legal_investigations
    DROP CONSTRAINT IF EXISTS ck_legal_investigations_terminal_closed_at;

ALTER TABLE legal_investigations
    ADD CONSTRAINT ck_legal_investigations_terminal_closed_at CHECK (
        (status IN ('closed', 'cancelled') AND closed_at IS NOT NULL AND closed_by IS NOT NULL)
        OR
        (status NOT IN ('closed', 'cancelled') AND closed_at IS NULL AND closed_by IS NULL)
    ) NOT VALID;

-- Existing terminal rows predate actor attribution, so validate only after the
-- application has written metadata for new transitions and operators backfill
-- legacy rows with a real actor. NOT VALID still enforces all new writes.
