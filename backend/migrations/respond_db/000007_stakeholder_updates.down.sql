DROP POLICY IF EXISTS tenant_delete ON respond_incident_approval;
DROP POLICY IF EXISTS tenant_update ON respond_incident_approval;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_approval;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_approval;

DROP POLICY IF EXISTS tenant_delete ON respond_stakeholder_update_dispatch;
DROP POLICY IF EXISTS tenant_update ON respond_stakeholder_update_dispatch;
DROP POLICY IF EXISTS tenant_insert ON respond_stakeholder_update_dispatch;
DROP POLICY IF EXISTS tenant_isolation ON respond_stakeholder_update_dispatch;

DROP TABLE IF EXISTS respond_incident_approval;
DROP TABLE IF EXISTS respond_stakeholder_update_dispatch;
