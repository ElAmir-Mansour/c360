-- Manager-approval gate in front of internal peer support requests
-- (LEX-SUPPORT-CONTEXT-AND-APPROVAL section 4).
--
-- `open` keeps its meaning -- "routed to the colleague" -- and gains a gate in
-- front of it. `rejected` is a new terminal state. Nothing downstream of `open`
-- changes:
--
--   pending_manager_approval --approve--> open --> accepted --> resolved
--                            --reject---> rejected (terminal)
--
-- The approver is resolved and FROZEN at creation. Resolving it lazily at
-- approval time would let an org-chart edit silently reassign in-flight
-- requests.
--
-- business_days is retained on the row because the validity window is
-- materialised at APPROVAL, not at creation (section 4.3). Otherwise a slow
-- manager consumes the colleague's entire window and a 2-day request approved on
-- day 2 arrives already expired. A pending request has no expiry clock at all,
-- which ck_lex_support_pending_no_expiry enforces at the storage layer.

ALTER TABLE lex_support_requests
    ADD COLUMN IF NOT EXISTS approver_user_id    UUID,
    ADD COLUMN IF NOT EXISTS approval_decided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approval_note       TEXT NOT NULL DEFAULT '',
    -- The design sketch defaulted this to 'manager'. A stored default that
    -- claims a human manager approved a row nobody approved is a lie in the
    -- audit trail, so the column defaults to the honest value instead; the
    -- service always writes the route it actually took.
    ADD COLUMN IF NOT EXISTS approval_route      TEXT NOT NULL DEFAULT 'auto_no_manager',
    ADD COLUMN IF NOT EXISTS business_days       INTEGER;

-- Drop every legacy CHECK that encodes the old status vocabulary. Named drops
-- first for the constraints 000109 actually created, then a catalog sweep by
-- definition: 000102/000117 showed that selecting an anonymous CHECK by guessed
-- name silently drops the wrong constraint and leaves the intended one in place.
ALTER TABLE lex_support_requests
    DROP CONSTRAINT IF EXISTS lex_support_requests_status_check,
    DROP CONSTRAINT IF EXISTS ck_lex_support_terminal_closed_at;

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

-- Rows created before the gate existed were routed straight to the colleague
-- with no approval step. Record that truthfully rather than retroactively
-- demanding an approval that never happened -- they stay `open`.
UPDATE lex_support_requests
SET approval_route = 'auto_no_manager'
WHERE approval_route <> 'auto_no_manager'
  AND approval_decided_at IS NULL
  AND approver_user_id IS NULL;

ALTER TABLE lex_support_requests
    ADD CONSTRAINT ck_lex_support_status CHECK (status IN (
        'pending_manager_approval', 'open', 'accepted',
        'resolved', 'declined', 'expired', 'cancelled', 'rejected'
    ));

ALTER TABLE lex_support_requests
    ADD CONSTRAINT ck_lex_support_approval_route CHECK (approval_route IN (
        'manager', 'unit_head', 'auto_no_manager', 'auto_self'
    ));

ALTER TABLE lex_support_requests
    ADD CONSTRAINT ck_lex_support_approval_note_length
    CHECK (length(approval_note) <= 10000);

ALTER TABLE lex_support_requests
    ADD CONSTRAINT ck_lex_support_business_days
    CHECK (business_days IS NULL OR business_days BETWEEN 1 AND 366);

-- `rejected` is terminal exactly like the other closed states; the new gate
-- state is open-ended exactly like `open`.
ALTER TABLE lex_support_requests
    ADD CONSTRAINT ck_lex_support_terminal_closed_at CHECK (
        (status IN ('resolved', 'declined', 'expired', 'cancelled', 'rejected') AND closed_at IS NOT NULL) OR
        (status IN ('pending_manager_approval', 'open', 'accepted') AND closed_at IS NULL)
    );

-- Section 4.3: while pending there is no expiry clock.
ALTER TABLE lex_support_requests
    ADD CONSTRAINT ck_lex_support_pending_no_expiry CHECK (
        status <> 'pending_manager_approval' OR expires_at IS NULL
    );

-- A pending request without an approver is the silent dead end the design calls
-- out (3 of 19 demo memberships have no manager). The resolver auto-approves
-- instead; this makes the dead end unrepresentable rather than merely unlikely.
ALTER TABLE lex_support_requests
    ADD CONSTRAINT ck_lex_support_pending_has_approver CHECK (
        status <> 'pending_manager_approval' OR approver_user_id IS NOT NULL
    );

-- Approver inbox: "pending my approval", tenant- and approver-scoped.
CREATE INDEX IF NOT EXISTS idx_lex_support_pending_approval ON lex_support_requests
    (tenant_id, approver_user_id, created_at DESC)
    WHERE status = 'pending_manager_approval' AND deleted_at IS NULL;
