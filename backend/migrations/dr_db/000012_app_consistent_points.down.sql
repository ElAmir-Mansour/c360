DROP POLICY IF EXISTS tenant_delete ON dr_consistency_barrier;
DROP POLICY IF EXISTS tenant_update ON dr_consistency_barrier;
DROP POLICY IF EXISTS tenant_insert ON dr_consistency_barrier;
DROP POLICY IF EXISTS tenant_isolation ON dr_consistency_barrier;

DROP INDEX IF EXISTS idx_dr_consistency_barrier_rp;
DROP INDEX IF EXISTS idx_dr_consistency_barrier_group;

DROP TABLE IF EXISTS dr_consistency_barrier;
