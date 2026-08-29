-- Down: reverse 000038_litigation_audit_and_judgment_idempotency.

DROP INDEX IF EXISTS uq_legal_obligations_judgment_live;

-- Restore the legacy metadata association before dropping the link column so the
-- objection obligations remain correlatable to their judgment.
UPDATE legal_obligations o
SET metadata = COALESCE(o.metadata, '{}'::jsonb) || jsonb_build_object('judgment_id', o.judgment_id::text)
WHERE o.judgment_id IS NOT NULL
  AND NOT (o.metadata ? 'judgment_id');

ALTER TABLE legal_obligations DROP COLUMN IF EXISTS judgment_id;

-- The lex_duration_facts kind CHECK is owned/restored by the later sibling
-- migration 000042_investigation_sla_audit_facts.down (which runs first on a
-- reverse migration and restores the canonical 4-kind 000034 CHECK). Nothing to
-- do here for the kind constraint.

DROP TABLE IF EXISTS legal_litigation_audit_log;
