-- Reverse of investigations.up.sql (CAP-077..083). Drop children before the
-- legal_investigations parent. CASCADE removes RLS policies and dependent indexes.
DROP TABLE IF EXISTS legal_investigation_audit_log CASCADE;
DROP TABLE IF EXISTS legal_investigation_evidence CASCADE;
DROP TABLE IF EXISTS legal_investigation_statements CASCADE;
DROP TABLE IF EXISTS legal_investigation_parties CASCADE;
DROP TABLE IF EXISTS legal_investigations CASCADE;
