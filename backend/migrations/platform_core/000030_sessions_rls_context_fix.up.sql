-- Active-session reads run on pooled connections. After a SET LOCAL tenant
-- transaction commits, PostgreSQL can retain a custom GUC as an empty string;
-- casting that value directly to UUID raises 22P02 and turns GET
-- /users/me/sessions into a 500. NULLIF makes the no-context state fail closed
-- without raising, while tenant-scoped repository transactions still expose
-- only the caller's rows.

-- Reassert the last-active column as a repair for environments whose migration
-- version was advanced without applying the original 000013 DDL.
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP POLICY IF EXISTS tenant_isolation ON sessions;
DROP POLICY IF EXISTS tenant_insert ON sessions;
DROP POLICY IF EXISTS tenant_update ON sessions;
DROP POLICY IF EXISTS tenant_delete ON sessions;

CREATE POLICY tenant_isolation ON sessions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_insert ON sessions
    FOR INSERT
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_update ON sessions
    FOR UPDATE
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_delete ON sessions
    FOR DELETE
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
