-- Reverse of legal_case_management.up.sql (CAP-032..051). Drop children before the
-- legal_cases parent. CASCADE removes RLS policies and dependent indexes. The
-- legal_case_classifications taxonomy table is owned by 000025 (dropped by its own
-- down migration), so it is intentionally NOT dropped here.
DROP TABLE IF EXISTS legal_case_versions CASCADE;
DROP TABLE IF EXISTS legal_case_audit_log CASCADE;
DROP TABLE IF EXISTS legal_case_intakes CASCADE;
DROP TABLE IF EXISTS legal_case_tasks CASCADE;
DROP TABLE IF EXISTS legal_case_hearings CASCADE;
DROP TABLE IF EXISTS legal_case_parties CASCADE;
DROP TABLE IF EXISTS legal_cases CASCADE;
