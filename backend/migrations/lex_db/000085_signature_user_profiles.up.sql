CREATE TABLE IF NOT EXISTS signature_user_profiles (
    tenant_id             UUID        NOT NULL,
    user_id               UUID        NOT NULL,
    typed_name            TEXT        NOT NULL DEFAULT '',
    initials              TEXT        NOT NULL DEFAULT '',
    signature_image       TEXT,
    signature_image_mime  TEXT,
    signature_image_hash  TEXT,
    initials_image        TEXT,
    initials_image_mime   TEXT,
    initials_image_hash   TEXT,
    consent_version       TEXT        NOT NULL DEFAULT 'native-v1',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_signature_user_profiles_updated
    ON signature_user_profiles (tenant_id, updated_at DESC);

ALTER TABLE signature_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_user_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON signature_user_profiles
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON signature_user_profiles
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON signature_user_profiles
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON signature_user_profiles
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
