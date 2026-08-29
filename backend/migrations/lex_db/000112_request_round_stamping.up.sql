-- =============================================================================
-- Review-round stamping for request notes and attachments.
--
--   "The request can be reviewed and returned many times between the business
--    entities and the corresponding department with thoughts and comments and
--    many times file uploads until they reach the file copy."
--
-- 000110 gave the SLA a cycle per submission round. The CONVERSATION had none:
-- notes and attachments were a flat list, so a request bounced three times
-- rendered as one undifferentiated pile and "what did they send back the second
-- time" was unanswerable.
--
-- The round counter lives on legal_requests, NOT derived from legal_sla_clocks:
-- notes and attachments exist while a request is still a draft, long before
-- completeness confirmation materialises any clock. Deriving from the clock would
-- leave every pre-clock note unstamped.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The authoritative round counter. Incremented on returned -> submitted.
-- ---------------------------------------------------------------------------
ALTER TABLE legal_requests
    ADD COLUMN IF NOT EXISTS cycle INT NOT NULL DEFAULT 1;

ALTER TABLE legal_requests DROP CONSTRAINT IF EXISTS ck_legal_requests_cycle;
ALTER TABLE legal_requests ADD CONSTRAINT ck_legal_requests_cycle CHECK (cycle >= 1);

-- Existing requests are backfilled from their SLA cycles where those exist, so a
-- request already bounced under 000110 keeps a truthful counter. Everything else
-- is round 1 — the honest reading for history predating this feature, since the
-- return count was never recorded and cannot be reconstructed.
UPDATE legal_requests lr
SET cycle = c.max_cycle
FROM (
    SELECT tenant_id, legal_request_id, MAX(cycle) AS max_cycle
    FROM legal_sla_clocks GROUP BY tenant_id, legal_request_id
) c
WHERE c.tenant_id = lr.tenant_id AND c.legal_request_id = lr.id AND c.max_cycle > lr.cycle;

-- ---------------------------------------------------------------------------
-- Stamp the conversation. DEFAULT 1 keeps every existing row valid and readable:
-- all prior activity belongs to the first round.
-- ---------------------------------------------------------------------------
ALTER TABLE legal_request_notes
    ADD COLUMN IF NOT EXISTS cycle INT NOT NULL DEFAULT 1;
ALTER TABLE legal_request_notes DROP CONSTRAINT IF EXISTS ck_legal_request_notes_cycle;
ALTER TABLE legal_request_notes ADD CONSTRAINT ck_legal_request_notes_cycle CHECK (cycle >= 1);

ALTER TABLE legal_request_attachments
    ADD COLUMN IF NOT EXISTS cycle INT NOT NULL DEFAULT 1;
ALTER TABLE legal_request_attachments DROP CONSTRAINT IF EXISTS ck_legal_request_attachments_cycle;
ALTER TABLE legal_request_attachments ADD CONSTRAINT ck_legal_request_attachments_cycle CHECK (cycle >= 1);

-- Round-grouped read paths: the detail page renders the thread round by round,
-- oldest first within each round.
CREATE INDEX IF NOT EXISTS idx_legal_request_notes_round
    ON legal_request_notes (tenant_id, request_id, cycle, created_at ASC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_legal_request_attachments_round
    ON legal_request_attachments (tenant_id, legal_request_id, cycle, created_at ASC)
    WHERE deleted_at IS NULL;
