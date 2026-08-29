-- Emergency priority tier (Al Othaim PRD — "Emergency, within 24 hours").
--
-- Widens the priority CHECK constraints across the legal-request + SLA spine to
-- accept 'emergency' alongside 'urgent' and 'normal', and extends the SLA-target
-- acknowledgement compound CHECK with an emergency (working-hours) branch.
--
-- Unlike the user-elevated 'urgent' tier, 'emergency' does NOT require a
-- structured justification (CAP-010 gates urgent only), so the
-- chk_legal_requests_urgent_justification constraint is intentionally untouched.

-- legal_requests.priority (single-column inline CHECK → conventional name).
ALTER TABLE legal_requests DROP CONSTRAINT IF EXISTS legal_requests_priority_check;
ALTER TABLE legal_requests
    ADD CONSTRAINT legal_requests_priority_check
    CHECK (priority IN ('emergency', 'urgent', 'normal'));

-- legal_request_priority_changes.from_priority / to_priority.
ALTER TABLE legal_request_priority_changes
    DROP CONSTRAINT IF EXISTS legal_request_priority_changes_from_priority_check;
ALTER TABLE legal_request_priority_changes
    ADD CONSTRAINT legal_request_priority_changes_from_priority_check
    CHECK (from_priority IN ('emergency', 'urgent', 'normal'));
ALTER TABLE legal_request_priority_changes
    DROP CONSTRAINT IF EXISTS legal_request_priority_changes_to_priority_check;
ALTER TABLE legal_request_priority_changes
    ADD CONSTRAINT legal_request_priority_changes_to_priority_check
    CHECK (to_priority IN ('emergency', 'urgent', 'normal'));

-- legal_sla_targets.priority.
ALTER TABLE legal_sla_targets DROP CONSTRAINT IF EXISTS legal_sla_targets_priority_check;
ALTER TABLE legal_sla_targets
    ADD CONSTRAINT legal_sla_targets_priority_check
    CHECK (priority IN ('emergency', 'urgent', 'normal'));

-- legal_sla_clocks.priority.
ALTER TABLE legal_sla_clocks DROP CONSTRAINT IF EXISTS legal_sla_clocks_priority_check;
ALTER TABLE legal_sla_clocks
    ADD CONSTRAINT legal_sla_clocks_priority_check
    CHECK (priority IN ('emergency', 'urgent', 'normal'));

-- legal_sla_targets compound ack-window CHECK (table-level, auto-named). Drop the
-- constraint whose definition references ack_window_unit, then re-add it with the
-- emergency (working-hours) branch under an explicit, stable name.
DO $$
DECLARE
    c text;
BEGIN
    SELECT conname INTO c
    FROM pg_constraint
    WHERE conrelid = 'legal_sla_targets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%ack_window_unit%';
    IF c IS NOT NULL THEN
        EXECUTE format('ALTER TABLE legal_sla_targets DROP CONSTRAINT %I', c);
    END IF;
END $$;

ALTER TABLE legal_sla_targets
    ADD CONSTRAINT legal_sla_targets_ack_window_check
    CHECK (
        (priority = 'urgent'    AND ack_window_unit = 'working_hours' AND ack_window_value BETWEEN 0 AND 4)
        OR
        (priority = 'normal'    AND ack_window_unit = 'working_days'  AND ack_window_value BETWEEN 0 AND 1)
        OR
        (priority = 'emergency' AND ack_window_unit = 'working_hours' AND ack_window_value BETWEEN 0 AND 4)
    );
