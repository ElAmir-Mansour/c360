-- Reverse 000038_recover_cyber_recovery: drop the clean-room recovery flow and
-- its append-only transition log (and with them their RLS policies and indexes).
-- The composed dr/* state is unaffected — clean-room scans, ransomware signals
-- and recovery points never lived here; this only ever linked to them by id.
DROP TABLE IF EXISTS recover_cyber_recovery_event;
DROP TABLE IF EXISTS recover_cyber_recovery_flow;
