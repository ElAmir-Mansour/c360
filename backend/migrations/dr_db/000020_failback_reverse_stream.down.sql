DROP POLICY IF EXISTS tenant_delete ON dr_failback_reverse_stream;
DROP POLICY IF EXISTS tenant_update ON dr_failback_reverse_stream;
DROP POLICY IF EXISTS tenant_insert ON dr_failback_reverse_stream;
DROP POLICY IF EXISTS tenant_isolation ON dr_failback_reverse_stream;

DROP TABLE IF EXISTS dr_failback_reverse_stream;
