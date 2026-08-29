DROP TRIGGER IF EXISTS trg_dr_break_glass_event_append_only ON dr_break_glass_event;
DROP TRIGGER IF EXISTS trg_dr_failover_approval_append_only ON dr_failover_approval;
DROP FUNCTION IF EXISTS dr_break_glass_event_append_only();
DROP FUNCTION IF EXISTS dr_failover_approval_append_only();
DROP TABLE IF EXISTS dr_break_glass_event;
DROP TABLE IF EXISTS dr_failover_approval;
DROP TABLE IF EXISTS dr_approval_policy;
