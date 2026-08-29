DROP POLICY IF EXISTS tenant_delete ON respond_integration_sync_audit;
DROP POLICY IF EXISTS tenant_update ON respond_integration_sync_audit;
DROP POLICY IF EXISTS tenant_insert ON respond_integration_sync_audit;
DROP POLICY IF EXISTS tenant_isolation ON respond_integration_sync_audit;

DROP POLICY IF EXISTS tenant_delete ON respond_integration_webhook_dedupe;
DROP POLICY IF EXISTS tenant_update ON respond_integration_webhook_dedupe;
DROP POLICY IF EXISTS tenant_insert ON respond_integration_webhook_dedupe;
DROP POLICY IF EXISTS tenant_isolation ON respond_integration_webhook_dedupe;

DROP POLICY IF EXISTS tenant_delete ON respond_incident_integration_link;
DROP POLICY IF EXISTS tenant_update ON respond_incident_integration_link;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_integration_link;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_integration_link;

DROP POLICY IF EXISTS tenant_delete ON respond_integration_connector_secret;
DROP POLICY IF EXISTS tenant_update ON respond_integration_connector_secret;
DROP POLICY IF EXISTS tenant_insert ON respond_integration_connector_secret;
DROP POLICY IF EXISTS tenant_isolation ON respond_integration_connector_secret;

DROP POLICY IF EXISTS tenant_delete ON respond_integration_connector;
DROP POLICY IF EXISTS tenant_update ON respond_integration_connector;
DROP POLICY IF EXISTS tenant_insert ON respond_integration_connector;
DROP POLICY IF EXISTS tenant_isolation ON respond_integration_connector;

DROP TABLE IF EXISTS respond_integration_sync_audit;
DROP TABLE IF EXISTS respond_integration_webhook_dedupe;
DROP TABLE IF EXISTS respond_incident_integration_link;
DROP TABLE IF EXISTS respond_integration_connector_secret;
DROP TABLE IF EXISTS respond_integration_connector;
