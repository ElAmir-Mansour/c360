-- Roll back the SLA From–To working-day window. The upper bound (deadline) is
-- untouched; only the lower-bound columns and the restored catalogue `from` key
-- are removed, reverting the SLA metadata window to the {to:N} shape 000089 left.

-- Revert catalogue SLA metadata window to {to:N} (drop the `from` key) for the
-- seed-owned / PRD baseline rows.
UPDATE legal_service_catalog s
SET metadata = jsonb_set(
        jsonb_set(
            s.metadata,
            '{sla,urgent}',
            jsonb_build_object('to', (s.metadata->'sla'->'urgent'->>'to')::int)
        ),
        '{sla,normal}',
        jsonb_build_object('to', (s.metadata->'sla'->'normal'->>'to')::int)
    ),
    updated_at = now()
WHERE s.deleted_at IS NULL
  AND s.metadata ? 'sla'
  AND s.metadata->'sla' ? 'urgent'
  AND s.metadata->'sla' ? 'normal'
  AND (s.metadata->'sla'->'urgent') ? 'to'
  AND (s.metadata->'sla'->'normal') ? 'to'
  AND (
      s.created_by = '00000000-0000-0000-0000-000000000001'::uuid
      OR s.metadata->>'prd_baseline' = 'othaim-2026-07-14'
  );

ALTER TABLE legal_sla_clocks
    DROP COLUMN IF EXISTS turnaround_from_due_at;

ALTER TABLE legal_sla_targets
    DROP CONSTRAINT IF EXISTS chk_legal_sla_targets_from_le_to;

ALTER TABLE legal_sla_targets
    DROP COLUMN IF EXISTS turnaround_working_days_from;
