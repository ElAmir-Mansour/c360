ALTER TABLE legal_sla_targets
    DROP CONSTRAINT IF EXISTS legal_sla_targets_ack_window_check;

ALTER TABLE legal_sla_targets
    DROP CONSTRAINT IF EXISTS legal_sla_targets_ack_window_unit_check_v2;

-- Preserve the pre-117 emergency semantics while restoring the conventional
-- unit-constraint name expected at the 000102 schema version.
ALTER TABLE legal_sla_targets
    ADD CONSTRAINT legal_sla_targets_ack_window_unit_check
    CHECK (ack_window_unit IN ('working_days', 'working_hours'));

ALTER TABLE legal_sla_targets
    ADD CONSTRAINT legal_sla_targets_ack_window_check
    CHECK (
        (priority = 'urgent'    AND ack_window_unit = 'working_hours' AND ack_window_value BETWEEN 0 AND 4)
        OR
        (priority = 'normal'    AND ack_window_unit = 'working_days'  AND ack_window_value BETWEEN 0 AND 1)
        OR
        (priority = 'emergency' AND ack_window_unit = 'working_hours' AND ack_window_value BETWEEN 0 AND 4)
    );
