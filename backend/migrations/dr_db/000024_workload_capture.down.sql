DROP POLICY IF EXISTS tenant_delete ON dr_vm_capture_state;
DROP POLICY IF EXISTS tenant_update ON dr_vm_capture_state;
DROP POLICY IF EXISTS tenant_insert ON dr_vm_capture_state;
DROP POLICY IF EXISTS tenant_isolation ON dr_vm_capture_state;

DROP POLICY IF EXISTS tenant_delete ON dr_workload_capture_epoch;
DROP POLICY IF EXISTS tenant_update ON dr_workload_capture_epoch;
DROP POLICY IF EXISTS tenant_insert ON dr_workload_capture_epoch;
DROP POLICY IF EXISTS tenant_isolation ON dr_workload_capture_epoch;

DROP POLICY IF EXISTS tenant_delete ON dr_workload_capture_source;
DROP POLICY IF EXISTS tenant_update ON dr_workload_capture_source;
DROP POLICY IF EXISTS tenant_insert ON dr_workload_capture_source;
DROP POLICY IF EXISTS tenant_isolation ON dr_workload_capture_source;

DROP TABLE IF EXISTS dr_vm_capture_state;
DROP TABLE IF EXISTS dr_workload_capture_epoch;
DROP TABLE IF EXISTS dr_workload_capture_source;
