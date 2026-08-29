-- Restore the original policy expressions. The last_active_at column belongs
-- to migration 000013 and must not be removed when rolling back this repair.

DROP POLICY IF EXISTS tenant_isolation ON sessions;
DROP POLICY IF EXISTS tenant_insert ON sessions;
DROP POLICY IF EXISTS tenant_update ON sessions;
DROP POLICY IF EXISTS tenant_delete ON sessions;

CREATE POLICY tenant_isolation ON sessions
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON sessions
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON sessions
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON sessions
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
