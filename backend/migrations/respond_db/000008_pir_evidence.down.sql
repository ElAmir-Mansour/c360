DROP POLICY IF EXISTS tenant_delete ON respond_incident_evidence_export;
DROP POLICY IF EXISTS tenant_update ON respond_incident_evidence_export;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_evidence_export;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_evidence_export;

DROP POLICY IF EXISTS tenant_delete ON respond_incident_pir_action_item;
DROP POLICY IF EXISTS tenant_update ON respond_incident_pir_action_item;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_pir_action_item;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_pir_action_item;

DROP POLICY IF EXISTS tenant_delete ON respond_incident_pir;
DROP POLICY IF EXISTS tenant_update ON respond_incident_pir;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_pir;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_pir;

DROP TRIGGER IF EXISTS trg_respond_evidence_export_no_delete ON respond_incident_evidence_export;
DROP TRIGGER IF EXISTS trg_respond_evidence_export_no_update ON respond_incident_evidence_export;
DROP FUNCTION IF EXISTS respond_evidence_export_no_mutation();

DROP TABLE IF EXISTS respond_incident_evidence_export;
DROP TABLE IF EXISTS respond_incident_pir_action_item;
DROP TABLE IF EXISTS respond_incident_pir;
