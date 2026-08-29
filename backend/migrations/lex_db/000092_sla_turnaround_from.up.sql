-- SLA From–To working-day window (Al Othaim PRD 6.0 / Diagram A, CAP-012).
--
-- The delivery budget is published per (service_code, priority) as a From–To
-- working-day window (e.g. Normal 5–6). Prior to this migration only the upper
-- bound (the enforced deadline) was modelled. This adds an explicit lower-bound
-- (From / earliest-promise) figure to targets and clocks, and restores the `from`
-- key on the catalogue SLA metadata that 000089 collapsed to `{to:N}`.
--
-- The upper bound (turnaround_working_days / turnaround_due_at) is UNCHANGED and
-- remains the authoritative deadline that breach/escalation key off. This work is
-- display-only and fully reversible — no lifecycle/monitor/KPI semantics change.

-- ---------------------------------------------------------------------------
-- legal_sla_targets: lower-bound working-day figure.
-- ---------------------------------------------------------------------------
ALTER TABLE legal_sla_targets
    ADD COLUMN IF NOT EXISTS turnaround_working_days_from INT NOT NULL DEFAULT 0;

-- Backfill every existing row to from == to (a single-figure window) so the CHECK
-- below holds regardless of the row's upper bound (including to = 0).
UPDATE legal_sla_targets
SET turnaround_working_days_from = turnaround_working_days
WHERE turnaround_working_days_from = 0;

-- PRD From figures for the seed-owned baseline. Mirrors ensureSLATargets +
-- 000089; every from <= its to, so the guarded UPDATE can never violate the CHECK.
CREATE TEMP TABLE othaim_prd_sla_window (
    code        TEXT PRIMARY KEY,
    urgent_from INT NOT NULL,
    urgent_to   INT NOT NULL,
    normal_from INT NOT NULL,
    normal_to   INT NOT NULL
) ON COMMIT DROP;

INSERT INTO othaim_prd_sla_window (code, urgent_from, urgent_to, normal_from, normal_to) VALUES
    ('LEGAL_CONSULTATION',  3,  4,  4,  6),
    ('CONTRACT_REVIEW',     2,  3,  3,  5),
    ('LEGAL_OPINION',       3,  5, 10, 15),
    ('LITIGATION_SUPPORT',  7, 10, 20, 30),
    ('ENFORCEMENT_REQUEST', 7, 10, 14, 20),
    ('VIOLATION_STUDY',     7, 10, 14, 20),
    ('FIELD_INSPECTION',    7, 10, 14, 20),
    ('POWER_OF_ATTORNEY',   7, 10, 14, 20);

UPDATE legal_sla_targets t
SET turnaround_working_days_from =
        CASE WHEN t.priority = 'urgent' THEN w.urgent_from ELSE w.normal_from END,
    updated_at = now()
FROM othaim_prd_sla_window w
WHERE lower(t.service_code) = lower(w.code)
  AND t.created_by = '00000000-0000-0000-0000-000000000001'::uuid
  AND t.deleted_at IS NULL
  AND (CASE WHEN t.priority = 'urgent' THEN w.urgent_from ELSE w.normal_from END)
      <= t.turnaround_working_days;

-- Enforce the window invariant once all rows carry a valid lower bound.
ALTER TABLE legal_sla_targets
    ADD CONSTRAINT chk_legal_sla_targets_from_le_to
    CHECK (turnaround_working_days_from >= 0
           AND turnaround_working_days_from <= turnaround_working_days);

-- ---------------------------------------------------------------------------
-- legal_sla_clocks: materialised earliest-promise instant (nullable).
-- ---------------------------------------------------------------------------
ALTER TABLE legal_sla_clocks
    ADD COLUMN IF NOT EXISTS turnaround_from_due_at TIMESTAMPTZ;

-- Backfill existing clocks to from == to so already-materialised requests keep a
-- coherent (single-instant) window until they are re-materialised.
UPDATE legal_sla_clocks
SET turnaround_from_due_at = turnaround_due_at
WHERE turnaround_from_due_at IS NULL;

-- ---------------------------------------------------------------------------
-- legal_service_catalog: restore the `from` key on the SLA metadata window.
-- 000089 published {to:N}; publish {from,to} for the seed-owned/PRD baseline.
-- ---------------------------------------------------------------------------
UPDATE legal_service_catalog s
SET metadata = jsonb_set(
        jsonb_set(
            s.metadata,
            '{sla,urgent}',
            jsonb_build_object('from', w.urgent_from, 'to', w.urgent_to)
        ),
        '{sla,normal}',
        jsonb_build_object('from', w.normal_from, 'to', w.normal_to)
    ),
    updated_at = now()
FROM othaim_prd_sla_window w
WHERE s.code = w.code
  AND s.deleted_at IS NULL
  AND s.metadata ? 'sla'
  AND (
      s.created_by = '00000000-0000-0000-0000-000000000001'::uuid
      OR s.metadata->>'prd_baseline' = 'othaim-2026-07-14'
  );
