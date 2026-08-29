DROP TRIGGER IF EXISTS trg_dr_attestation_checkpoint_immutable ON dr_attestation_checkpoint;
DROP FUNCTION IF EXISTS dr_attestation_checkpoint_immutable_guard();

DROP TRIGGER IF EXISTS trg_dr_attestation_ledger_immutable ON dr_attestation_ledger;
DROP FUNCTION IF EXISTS dr_attestation_ledger_immutable_guard();

ALTER TABLE dr_attestation_ledger
    DROP CONSTRAINT IF EXISTS dr_attestation_ledger_entry_type_check;

ALTER TABLE dr_attestation_ledger
    ADD CONSTRAINT dr_attestation_ledger_entry_type_check CHECK (entry_type IN (
        'failover_attestation','drill_attestation',
        'recovery_point_validation','cleanroom_verdict','anchor_checkpoint'));

CREATE POLICY tenant_delete ON dr_attestation_ledger
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_attestation_checkpoint
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_attestation_checkpoint
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
