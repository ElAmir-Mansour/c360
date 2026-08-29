DROP TRIGGER IF EXISTS recovery_point_immutable_guard ON recovery_point;
DROP FUNCTION IF EXISTS prevent_recovery_point_mutation();

DROP POLICY IF EXISTS tenant_update_validation ON recovery_point;
DROP POLICY IF EXISTS tenant_delete_expired ON recovery_point;
DROP POLICY IF EXISTS tenant_update ON recovery_point;
DROP POLICY IF EXISTS tenant_delete ON recovery_point;

CREATE POLICY tenant_update ON recovery_point
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON recovery_point
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
