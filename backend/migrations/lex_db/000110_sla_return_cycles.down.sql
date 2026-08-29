-- Reverse 000110. Collapses a request's clock sequence back to a single clock.
--
-- LOSSY BY NECESSITY: the pre-110 schema cannot represent more than one clock
-- per request, so superseded cycles must go. We keep the LAST cycle (the one
-- whose outcome reflects the request's current standing) and delete the earlier
-- ones, rather than keeping cycle 1, which would resurrect the stale deadlines
-- this migration was written to retire.

DROP INDEX IF EXISTS idx_legal_sla_clocks_pending_due;
DROP INDEX IF EXISTS idx_legal_sla_clocks_active_unique;
DROP INDEX IF EXISTS idx_legal_sla_clocks_request_cycle_unique;

-- Keep only the highest cycle per (tenant, request).
DELETE FROM legal_sla_clocks c
USING legal_sla_clocks keep
WHERE c.tenant_id = keep.tenant_id
  AND c.legal_request_id = keep.legal_request_id
  AND c.cycle < keep.cycle;

-- 'stopped' has no pre-110 representation. A cycle the department handed back
-- is not a breach, so it maps to the neutral terminal the old schema had.
UPDATE legal_sla_clocks
SET outcome = 'on_time', resolved_at = COALESCE(resolved_at, stopped_at)
WHERE outcome = 'stopped';

ALTER TABLE legal_sla_clocks DROP CONSTRAINT IF EXISTS ck_legal_sla_clocks_stopped_at;
ALTER TABLE legal_sla_clocks DROP CONSTRAINT IF EXISTS ck_legal_sla_clocks_cycle;

ALTER TABLE legal_sla_clocks DROP CONSTRAINT IF EXISTS legal_sla_clocks_outcome_check;
ALTER TABLE legal_sla_clocks
    ADD CONSTRAINT legal_sla_clocks_outcome_check
    CHECK (outcome IN ('pending', 'on_time', 'breached'));

ALTER TABLE legal_sla_clocks DROP COLUMN IF EXISTS stopped_at;
ALTER TABLE legal_sla_clocks DROP COLUMN IF EXISTS cycle;

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_sla_clocks_request_unique
    ON legal_sla_clocks (tenant_id, legal_request_id);
