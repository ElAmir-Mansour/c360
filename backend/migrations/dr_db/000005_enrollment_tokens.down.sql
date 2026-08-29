DROP POLICY IF EXISTS tenant_delete ON dr_agent_cert_revocation;
DROP POLICY IF EXISTS tenant_update ON dr_agent_cert_revocation;
DROP POLICY IF EXISTS tenant_insert ON dr_agent_cert_revocation;
DROP POLICY IF EXISTS tenant_isolation ON dr_agent_cert_revocation;

DROP POLICY IF EXISTS tenant_delete ON dr_enrollment_token;
DROP POLICY IF EXISTS tenant_update ON dr_enrollment_token;
DROP POLICY IF EXISTS tenant_insert ON dr_enrollment_token;
DROP POLICY IF EXISTS tenant_isolation ON dr_enrollment_token;

DROP TABLE IF EXISTS dr_agent_cert_revocation;
DROP TABLE IF EXISTS dr_enrollment_token;
