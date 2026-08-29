-- Reverse the predictive failure detection schema.

DROP POLICY IF EXISTS tenant_delete ON dr_predictions;
DROP POLICY IF EXISTS tenant_update ON dr_predictions;
DROP POLICY IF EXISTS tenant_insert ON dr_predictions;
DROP POLICY IF EXISTS tenant_isolation ON dr_predictions;

DROP POLICY IF EXISTS tenant_delete ON dr_replication_samples;
DROP POLICY IF EXISTS tenant_update ON dr_replication_samples;
DROP POLICY IF EXISTS tenant_insert ON dr_replication_samples;
DROP POLICY IF EXISTS tenant_isolation ON dr_replication_samples;

DROP TABLE IF EXISTS dr_predictions;
DROP TABLE IF EXISTS dr_replication_samples;
