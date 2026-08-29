DROP POLICY IF EXISTS tenant_delete ON respond_notification_dispatch;
DROP POLICY IF EXISTS tenant_update ON respond_notification_dispatch;
DROP POLICY IF EXISTS tenant_insert ON respond_notification_dispatch;
DROP POLICY IF EXISTS tenant_isolation ON respond_notification_dispatch;

DROP POLICY IF EXISTS tenant_delete ON respond_responder_directory;
DROP POLICY IF EXISTS tenant_update ON respond_responder_directory;
DROP POLICY IF EXISTS tenant_insert ON respond_responder_directory;
DROP POLICY IF EXISTS tenant_isolation ON respond_responder_directory;

DROP POLICY IF EXISTS tenant_delete ON respond_incident_role_history;
DROP POLICY IF EXISTS tenant_update ON respond_incident_role_history;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_role_history;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_role_history;

DROP POLICY IF EXISTS tenant_delete ON respond_incident_role_assignment;
DROP POLICY IF EXISTS tenant_update ON respond_incident_role_assignment;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_role_assignment;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_role_assignment;

DROP TABLE IF EXISTS respond_notification_dispatch;
DROP TABLE IF EXISTS respond_responder_directory;

DROP TRIGGER IF EXISTS trg_respond_role_history_no_delete ON respond_incident_role_history;
DROP TRIGGER IF EXISTS trg_respond_role_history_no_update ON respond_incident_role_history;
DROP FUNCTION IF EXISTS respond_role_history_no_mutation();

DROP TABLE IF EXISTS respond_incident_role_history;
DROP TABLE IF EXISTS respond_incident_role_assignment;
