DROP TRIGGER IF EXISTS trg_dr_rehearsal_proof_immutable ON dr_rehearsal_proof;
DROP FUNCTION IF EXISTS dr_rehearsal_proof_immutable_guard();

DROP POLICY IF EXISTS tenant_insert ON dr_rehearsal_proof;
DROP POLICY IF EXISTS tenant_isolation ON dr_rehearsal_proof;

DROP INDEX IF EXISTS idx_dr_rehearsal_proof_subject;

DROP TABLE IF EXISTS dr_rehearsal_proof;
