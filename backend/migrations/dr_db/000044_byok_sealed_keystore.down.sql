-- Reverse 000044_byok_sealed_keystore: drop the sealed software keystore table.
-- WARNING: dropping dr_sealed_kek destroys the persisted sealed tenant KEKs; any
-- DEK wrapped under a software KEK becomes unrecoverable. Only run on a teardown.

DROP POLICY IF EXISTS tenant_delete ON dr_sealed_kek;
DROP POLICY IF EXISTS tenant_update ON dr_sealed_kek;
DROP POLICY IF EXISTS tenant_insert ON dr_sealed_kek;
DROP POLICY IF EXISTS tenant_isolation ON dr_sealed_kek;
DROP INDEX IF EXISTS idx_dr_sealed_kek_tenant;
DROP TABLE IF EXISTS dr_sealed_kek;
