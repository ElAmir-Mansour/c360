DROP POLICY IF EXISTS tenant_insert ON legal_matter_audit_log;
DROP POLICY IF EXISTS tenant_isolation ON legal_matter_audit_log;
DROP INDEX IF EXISTS idx_legal_matter_audit_log_matter;
DROP TABLE IF EXISTS legal_matter_audit_log;
