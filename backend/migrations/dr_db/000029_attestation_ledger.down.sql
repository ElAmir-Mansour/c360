DROP POLICY IF EXISTS tenant_delete ON dr_attestation_checkpoint;
DROP POLICY IF EXISTS tenant_update ON dr_attestation_checkpoint;
DROP POLICY IF EXISTS tenant_insert ON dr_attestation_checkpoint;
DROP POLICY IF EXISTS tenant_isolation ON dr_attestation_checkpoint;

DROP POLICY IF EXISTS tenant_delete ON dr_attestation_ledger;
DROP POLICY IF EXISTS tenant_update ON dr_attestation_ledger;
DROP POLICY IF EXISTS tenant_insert ON dr_attestation_ledger;
DROP POLICY IF EXISTS tenant_isolation ON dr_attestation_ledger;

DROP INDEX IF EXISTS idx_dr_attestation_checkpoint_range;
DROP INDEX IF EXISTS idx_dr_attestation_checkpoint_tenant;
DROP INDEX IF EXISTS idx_dr_attestation_ledger_subject;
DROP INDEX IF EXISTS idx_dr_attestation_ledger_type;
DROP INDEX IF EXISTS idx_dr_attestation_ledger_tenant_seq;

DROP TABLE IF EXISTS dr_attestation_checkpoint;
DROP TABLE IF EXISTS dr_attestation_ledger;
