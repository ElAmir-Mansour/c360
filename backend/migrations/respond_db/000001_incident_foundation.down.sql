DROP POLICY IF EXISTS tenant_delete ON respond_incident_timeline_event;
DROP POLICY IF EXISTS tenant_update ON respond_incident_timeline_event;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_timeline_event;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_timeline_event;

DROP POLICY IF EXISTS tenant_delete ON respond_incident;
DROP POLICY IF EXISTS tenant_update ON respond_incident;
DROP POLICY IF EXISTS tenant_insert ON respond_incident;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident;

DROP POLICY IF EXISTS tenant_delete ON respond_incident_reference_counter;
DROP POLICY IF EXISTS tenant_update ON respond_incident_reference_counter;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_reference_counter;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_reference_counter;

DROP TRIGGER IF EXISTS trg_respond_timeline_no_delete ON respond_incident_timeline_event;
DROP TRIGGER IF EXISTS trg_respond_timeline_no_update ON respond_incident_timeline_event;
DROP FUNCTION IF EXISTS respond_timeline_no_mutation();

DROP TABLE IF EXISTS respond_incident_timeline_event;
DROP TABLE IF EXISTS respond_incident;
DROP TABLE IF EXISTS respond_incident_reference_counter;

