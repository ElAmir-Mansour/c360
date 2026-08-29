-- Repair the acknowledgement-window checks after emergency priority was added.
-- 000102 selected only one anonymous CHECK mentioning ack_window_unit; depending
-- on catalog order it could drop the unit enum check instead of the original
-- urgent/normal compound check. That left legal_sla_targets_check rejecting every
-- emergency seed row. Drop every affected legacy check and recreate both intended
-- invariants under stable names.
DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'legal_sla_targets'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%ack_window_unit%'
    LOOP
        EXECUTE format('ALTER TABLE legal_sla_targets DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE legal_sla_targets
    ADD CONSTRAINT legal_sla_targets_ack_window_unit_check_v2
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
