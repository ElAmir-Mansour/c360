-- Revert the emergency priority tier: restore the two-tier (urgent/normal) CHECK
-- constraints. NOTE: this will fail if any 'emergency' rows still exist — remove
-- or re-tier them before rolling back.

ALTER TABLE legal_requests DROP CONSTRAINT IF EXISTS legal_requests_priority_check;
ALTER TABLE legal_requests
    ADD CONSTRAINT legal_requests_priority_check
    CHECK (priority IN ('urgent', 'normal'));

ALTER TABLE legal_request_priority_changes
    DROP CONSTRAINT IF EXISTS legal_request_priority_changes_from_priority_check;
ALTER TABLE legal_request_priority_changes
    ADD CONSTRAINT legal_request_priority_changes_from_priority_check
    CHECK (from_priority IN ('urgent', 'normal'));
ALTER TABLE legal_request_priority_changes
    DROP CONSTRAINT IF EXISTS legal_request_priority_changes_to_priority_check;
ALTER TABLE legal_request_priority_changes
    ADD CONSTRAINT legal_request_priority_changes_to_priority_check
    CHECK (to_priority IN ('urgent', 'normal'));

ALTER TABLE legal_sla_targets DROP CONSTRAINT IF EXISTS legal_sla_targets_priority_check;
ALTER TABLE legal_sla_targets
    ADD CONSTRAINT legal_sla_targets_priority_check
    CHECK (priority IN ('urgent', 'normal'));

ALTER TABLE legal_sla_clocks DROP CONSTRAINT IF EXISTS legal_sla_clocks_priority_check;
ALTER TABLE legal_sla_clocks
    ADD CONSTRAINT legal_sla_clocks_priority_check
    CHECK (priority IN ('urgent', 'normal'));

ALTER TABLE legal_sla_targets DROP CONSTRAINT IF EXISTS legal_sla_targets_ack_window_check;
ALTER TABLE legal_sla_targets
    ADD CONSTRAINT legal_sla_targets_ack_window_check
    CHECK (
        (priority = 'urgent' AND ack_window_unit = 'working_hours' AND ack_window_value BETWEEN 0 AND 4)
        OR
        (priority = 'normal' AND ack_window_unit = 'working_days'  AND ack_window_value BETWEEN 0 AND 1)
    );
