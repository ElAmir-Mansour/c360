DROP POLICY IF EXISTS tenant_delete ON respond_incident_affected_service;
DROP POLICY IF EXISTS tenant_update ON respond_incident_affected_service;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_affected_service;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_affected_service;

DROP POLICY IF EXISTS tenant_delete ON respond_incident_severity_decision;
DROP POLICY IF EXISTS tenant_update ON respond_incident_severity_decision;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_severity_decision;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_severity_decision;

DROP POLICY IF EXISTS tenant_delete ON respond_incident_impact_assessment;
DROP POLICY IF EXISTS tenant_update ON respond_incident_impact_assessment;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_impact_assessment;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_impact_assessment;

DROP POLICY IF EXISTS tenant_delete ON respond_service_dependency;
DROP POLICY IF EXISTS tenant_update ON respond_service_dependency;
DROP POLICY IF EXISTS tenant_insert ON respond_service_dependency;
DROP POLICY IF EXISTS tenant_isolation ON respond_service_dependency;

DROP POLICY IF EXISTS tenant_delete ON respond_service_registry;
DROP POLICY IF EXISTS tenant_update ON respond_service_registry;
DROP POLICY IF EXISTS tenant_insert ON respond_service_registry;
DROP POLICY IF EXISTS tenant_isolation ON respond_service_registry;

DROP TABLE IF EXISTS respond_incident_affected_service;
DROP TABLE IF EXISTS respond_incident_severity_decision;
DROP TABLE IF EXISTS respond_incident_impact_assessment;
DROP TABLE IF EXISTS respond_service_dependency;
DROP TABLE IF EXISTS respond_service_registry;
