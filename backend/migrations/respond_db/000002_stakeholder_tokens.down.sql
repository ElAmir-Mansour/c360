DROP POLICY IF EXISTS tenant_delete ON respond_stakeholder_token;
DROP POLICY IF EXISTS tenant_update ON respond_stakeholder_token;
DROP POLICY IF EXISTS tenant_insert ON respond_stakeholder_token;
DROP POLICY IF EXISTS tenant_isolation ON respond_stakeholder_token;

DROP TABLE IF EXISTS respond_stakeholder_token;
