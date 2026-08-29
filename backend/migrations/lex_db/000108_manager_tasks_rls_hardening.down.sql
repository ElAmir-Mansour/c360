DROP POLICY IF EXISTS tenant_isolation ON legal_manager_tasks;
DROP POLICY IF EXISTS tenant_insert ON legal_manager_tasks;
DROP POLICY IF EXISTS tenant_update ON legal_manager_tasks;
DROP POLICY IF EXISTS tenant_delete ON legal_manager_tasks;

CREATE POLICY tenant_isolation ON legal_manager_tasks
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_manager_tasks
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_manager_tasks
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_manager_tasks
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON legal_manager_task_audit;
DROP POLICY IF EXISTS tenant_insert ON legal_manager_task_audit;

CREATE POLICY tenant_isolation ON legal_manager_task_audit
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_manager_task_audit
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
