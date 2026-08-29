-- Per-user dashboard preferences. Kept separate from the users row so layout
-- writes do not contend with profile/authentication updates and can evolve
-- independently from the core user schema.
CREATE TABLE IF NOT EXISTS user_dashboard_preferences (
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preferences JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, user_id),
    CONSTRAINT user_dashboard_preferences_object
        CHECK (jsonb_typeof(preferences) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_user_dashboard_preferences_user
    ON user_dashboard_preferences (user_id);

ALTER TABLE user_dashboard_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_dashboard_preferences FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON user_dashboard_preferences
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON user_dashboard_preferences
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON user_dashboard_preferences
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON user_dashboard_preferences
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_user_dashboard_preferences_updated_at
    BEFORE UPDATE ON user_dashboard_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

