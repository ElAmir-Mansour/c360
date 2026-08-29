-- Down migration for the consultation self-contained SLA clock (WS3, Round 2).

DROP INDEX IF EXISTS idx_legal_consultations_sla_open;

ALTER TABLE legal_consultations
    DROP COLUMN IF EXISTS sla_started_at,
    DROP COLUMN IF EXISTS sla_ack_due_at,
    DROP COLUMN IF EXISTS sla_response_due_at,
    DROP COLUMN IF EXISTS sla_ack_done,
    DROP COLUMN IF EXISTS sla_ack_done_at,
    DROP COLUMN IF EXISTS sla_escalation_level,
    DROP COLUMN IF EXISTS sla_breached,
    DROP COLUMN IF EXISTS sla_breached_at,
    DROP COLUMN IF EXISTS sla_outcome,
    DROP COLUMN IF EXISTS sla_resolved_at,
    DROP COLUMN IF EXISTS sla_target_minutes;
