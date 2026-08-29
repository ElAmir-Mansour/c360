-- =============================================================================
-- Return/resubmit SLA cycles (client feedback, Requests Page).
--
--   "The SLA stops if the request is returned to the requestor. A new SLA start
--    over when the requestor sends the request back."
--
-- Today `legal_sla_clocks` carries a UNIQUE (tenant_id, legal_request_id) index
-- — exactly one clock per request, forever — and NOTHING stops the clock when a
-- request moves to 'returned'. The department is therefore charged for the time
-- the ball sat in the REQUESTER's court, and a request bounced three times still
-- shows a single clock started at the first submission.
--
-- This migration makes a request's SLA a SEQUENCE of clocks, one per submission
-- cycle:
--
--   cycle 1  submitted ──────────────► returned   (outcome 'stopped')
--   cycle 2  resubmitted ────────────► delivered  (outcome 'on_time'|'breached')
--
-- Each cycle keeps its own deadlines, breach flag and outcome, so "did we meet
-- SLA on the round we actually controlled" is answerable, and the number of
-- round-trips is visible rather than inferred.
--
-- INVARIANT: at most ONE clock per request may be live at a time. That is now
-- enforced by a PARTIAL unique index on outcome = 'pending' rather than by a
-- total unique index, which is what allowed only one clock ever.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Cycle number + stop instant.
-- ---------------------------------------------------------------------------
ALTER TABLE legal_sla_clocks
    ADD COLUMN IF NOT EXISTS cycle INT NOT NULL DEFAULT 1;

ALTER TABLE legal_sla_clocks
    ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ;

-- Every pre-existing clock is, by definition, the first cycle of its request.
UPDATE legal_sla_clocks SET cycle = 1 WHERE cycle IS NULL OR cycle < 1;

ALTER TABLE legal_sla_clocks
    DROP CONSTRAINT IF EXISTS ck_legal_sla_clocks_cycle;
ALTER TABLE legal_sla_clocks
    ADD CONSTRAINT ck_legal_sla_clocks_cycle CHECK (cycle >= 1);

-- ---------------------------------------------------------------------------
-- 'stopped' outcome.
--
-- Deliberately NOT 'on_time' and NOT 'breached': a cycle that ended because the
-- department handed the request back is neither a success nor a failure of the
-- department's turnaround, and folding it into either would corrupt the SLA
-- compliance ratio. It is a fourth, non-judgemental terminal state.
-- ---------------------------------------------------------------------------
ALTER TABLE legal_sla_clocks
    DROP CONSTRAINT IF EXISTS legal_sla_clocks_outcome_check;
ALTER TABLE legal_sla_clocks
    ADD CONSTRAINT legal_sla_clocks_outcome_check
    CHECK (outcome IN ('pending', 'on_time', 'breached', 'stopped'));

-- A stopped clock must record WHEN it stopped; nothing else may.
ALTER TABLE legal_sla_clocks
    DROP CONSTRAINT IF EXISTS ck_legal_sla_clocks_stopped_at;
ALTER TABLE legal_sla_clocks
    ADD CONSTRAINT ck_legal_sla_clocks_stopped_at
    CHECK ((outcome = 'stopped') = (stopped_at IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Index swap: one clock per (request, cycle); at most one LIVE clock per request.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_legal_sla_clocks_request_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_sla_clocks_request_cycle_unique
    ON legal_sla_clocks (tenant_id, legal_request_id, cycle);

-- The real safety property. Replaces the total unique index: many historical
-- cycles are allowed, but two live clocks on one request are not — so
-- "the active clock" is always unambiguous and a double-restart cannot race.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_sla_clocks_active_unique
    ON legal_sla_clocks (tenant_id, legal_request_id)
    WHERE outcome = 'pending';

-- Monitor scan path: the breach/escalation sweep must consider live clocks only.
-- Without this a stopped cycle would keep breaching while the requester holds
-- the request — the precise bug this migration exists to remove.
CREATE INDEX IF NOT EXISTS idx_legal_sla_clocks_pending_due
    ON legal_sla_clocks (turnaround_due_at)
    WHERE outcome = 'pending';
