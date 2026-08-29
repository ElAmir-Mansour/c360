-- Reverse the manager-approval gate.
--
-- Rows sitting in the two new states cannot simply be left where they are: the
-- restored CHECK would reject them and the migration would fail half-applied.
-- They are collapsed back into the pre-gate vocabulary first, preserving the
-- decision text so nothing is silently discarded.

DROP INDEX IF EXISTS idx_lex_support_pending_approval;

DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'lex_support_requests'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%''resolved''::text%'
    LOOP
        EXECUTE format('ALTER TABLE lex_support_requests DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE lex_support_requests
    DROP CONSTRAINT IF EXISTS ck_lex_support_pending_no_expiry,
    DROP CONSTRAINT IF EXISTS ck_lex_support_pending_has_approver,
    DROP CONSTRAINT IF EXISTS ck_lex_support_approval_route,
    DROP CONSTRAINT IF EXISTS ck_lex_support_approval_note_length,
    DROP CONSTRAINT IF EXISTS ck_lex_support_business_days;

-- Never approved, never routed: the closest pre-gate meaning is "routed".
UPDATE lex_support_requests
SET status = 'open'
WHERE status = 'pending_manager_approval';

-- Rejected by the approver: the closest pre-gate terminal state is `declined`.
UPDATE lex_support_requests
SET status = 'declined',
    closed_at = COALESCE(closed_at, approval_decided_at, now()),
    resolution_note = CASE
        WHEN resolution_note = '' THEN approval_note
        ELSE resolution_note
    END
WHERE status = 'rejected';

ALTER TABLE lex_support_requests
    ADD CONSTRAINT lex_support_requests_status_check CHECK (status IN (
        'open', 'accepted', 'resolved', 'declined', 'expired', 'cancelled'
    ));

ALTER TABLE lex_support_requests
    ADD CONSTRAINT ck_lex_support_terminal_closed_at CHECK (
        (status IN ('resolved', 'declined', 'expired', 'cancelled') AND closed_at IS NOT NULL) OR
        (status IN ('open', 'accepted') AND closed_at IS NULL)
    );

ALTER TABLE lex_support_requests
    DROP COLUMN IF EXISTS business_days,
    DROP COLUMN IF EXISTS approval_route,
    DROP COLUMN IF EXISTS approval_note,
    DROP COLUMN IF EXISTS approval_decided_at,
    DROP COLUMN IF EXISTS approver_user_id;
