-- =============================================================================
-- WS3 (Round 2): self-contained SLA ack + response clock for legal consultations.
--
-- The shared request-keyed SLA clock (legal_sla_clocks) is keyed by a NOT NULL,
-- UNIQUE legal_request_id, so it cannot model a STANDALONE consultation
-- (legal_request_id NULL) and would collide with the request's own clock when the
-- consultation IS request-linked. Consultations therefore carry their OWN ack +
-- response deadline set directly on the aggregate row, materialised from the same
-- frozen working-calendar Calculator (contract C-1) the request SLA uses, so the
-- CAP working-day basis is identical across both verticals.
--
-- Columns (all nullable / defaulted so the migration is back-compatible and the
-- seed rows in 000029 remain valid):
--   sla_started_at        clock start instant (stamped on submit, or route if the
--                         consultation was submitted before this migration)
--   sla_ack_due_at        acknowledgement deadline (advisor must be routed by this)
--   sla_response_due_at   response (turnaround) deadline
--   sla_ack_done          whether the routing/ack rung was satisfied in time
--   sla_ack_done_at       when the ack rung was satisfied (route instant)
--   sla_escalation_level  highest escalation rung reached (0..3); advisory only,
--                         the SLA monitor for consultations is out of scope here
--   sla_breached          whether the response deadline lapsed before answer
--   sla_breached_at       first breach instant
--   sla_outcome           terminal verdict: pending | on_time | breached, resolved
--                         on response approval (CAP-131) or archive (CAP-132)
--   sla_resolved_at       when sla_outcome left 'pending'
--   sla_target_minutes    working-minute budget between start and response due, for
--                         the duration-fact SLA dimension (consultation_answer KPI)
--
-- Staged migration: the human renumbers/moves it into migrations/lex_db/ on merge.
-- Highest committed sequence at authoring time is 000037; a sibling Round-2 unit
-- stages 000038, so consultations take 000039.
-- =============================================================================

ALTER TABLE legal_consultations
    ADD COLUMN IF NOT EXISTS sla_started_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sla_ack_due_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sla_response_due_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sla_ack_done         BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS sla_ack_done_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sla_escalation_level INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sla_breached         BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS sla_breached_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sla_outcome          TEXT        NOT NULL DEFAULT 'pending'
        CHECK (sla_outcome IN ('pending', 'on_time', 'breached')),
    ADD COLUMN IF NOT EXISTS sla_resolved_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sla_target_minutes   INTEGER;

-- Open (unresolved) consultation clocks the SLA monitor / KPI rollups scan.
CREATE INDEX IF NOT EXISTS idx_legal_consultations_sla_open
    ON legal_consultations (tenant_id, sla_response_due_at)
    WHERE deleted_at IS NULL AND sla_outcome = 'pending' AND sla_started_at IS NOT NULL;

-- A new consultation-SLA audit action vocabulary is written into the EXISTING
-- append-only legal_consultation_audit_log (000029); no new table is required.
-- Documented actions:
--   consultation.sla_clock_started   ack + response deadlines materialised
--   consultation.sla_acknowledged    ack rung satisfied (advisor routed in time)
--   consultation.sla_breached        response deadline lapsed before answer
--   consultation.sla_resolved        terminal on_time/breached verdict stamped
