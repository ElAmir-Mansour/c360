CREATE TABLE IF NOT EXISTS respond_integration_connector (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('itsm','comms')),
    provider TEXT NOT NULL CHECK (provider IN ('servicenow','slack')),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    enabled BOOLEAN NOT NULL DEFAULT true,
    endpoint_url TEXT NOT NULL DEFAULT '',
    non_secret_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    webhook_auth_type TEXT NOT NULL DEFAULT 'hmac_sha256'
        CHECK (webhook_auth_type IN ('hmac_sha256','bearer')),
    webhook_secret_name TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL,
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_respond_integration_connector_tenant
    ON respond_integration_connector (tenant_id, kind, provider, enabled)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS respond_integration_connector_secret (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    connector_id UUID NOT NULL REFERENCES respond_integration_connector(id) ON DELETE CASCADE,
    secret_name TEXT NOT NULL CHECK (length(trim(secret_name)) > 0),
    secret_ref TEXT NOT NULL DEFAULT '',
    encrypted_value BYTEA,
    encrypted_nonce BYTEA,
    key_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (connector_id, secret_name),
    CHECK (
        (length(trim(secret_ref)) > 0 AND encrypted_value IS NULL AND encrypted_nonce IS NULL)
        OR
        (length(trim(secret_ref)) = 0 AND encrypted_value IS NOT NULL AND encrypted_nonce IS NOT NULL AND length(trim(key_id)) > 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_respond_integration_secret_tenant
    ON respond_integration_connector_secret (tenant_id, connector_id);

CREATE TABLE IF NOT EXISTS respond_incident_integration_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    connector_id UUID NOT NULL REFERENCES respond_integration_connector(id) ON DELETE RESTRICT,
    provider TEXT NOT NULL CHECK (provider IN ('servicenow','slack')),
    external_id TEXT NOT NULL CHECK (length(trim(external_id)) > 0),
    external_key TEXT NOT NULL CHECK (length(trim(external_key)) > 0),
    external_url TEXT NOT NULL DEFAULT '',
    external_status TEXT NOT NULL DEFAULT '',
    external_priority TEXT NOT NULL DEFAULT '',
    sync_direction TEXT NOT NULL DEFAULT 'bidirectional'
        CHECK (sync_direction IN ('outbound','inbound','bidirectional')),
    last_synced_at TIMESTAMPTZ,
    last_sync_direction TEXT NOT NULL DEFAULT '',
    sync_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, incident_id, connector_id),
    UNIQUE (tenant_id, connector_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_respond_integration_link_incident
    ON respond_incident_integration_link (tenant_id, incident_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_respond_integration_link_external
    ON respond_incident_integration_link (tenant_id, connector_id, external_id);

CREATE TABLE IF NOT EXISTS respond_integration_webhook_dedupe (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    connector_id UUID NOT NULL REFERENCES respond_integration_connector(id) ON DELETE RESTRICT,
    provider TEXT NOT NULL CHECK (provider IN ('servicenow','slack')),
    external_event_id TEXT NOT NULL CHECK (length(trim(external_event_id)) > 0),
    external_id TEXT NOT NULL DEFAULT '',
    payload_hash BYTEA NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','succeeded','failed','retry_scheduled','duplicate')),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    UNIQUE (connector_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_respond_webhook_dedupe_tenant_time
    ON respond_integration_webhook_dedupe (tenant_id, connector_id, received_at DESC);

CREATE TABLE IF NOT EXISTS respond_integration_sync_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    connector_id UUID NOT NULL REFERENCES respond_integration_connector(id) ON DELETE RESTRICT,
    incident_id UUID REFERENCES respond_incident(id) ON DELETE RESTRICT,
    link_id UUID REFERENCES respond_incident_integration_link(id) ON DELETE SET NULL,
    provider TEXT NOT NULL CHECK (provider IN ('servicenow','slack')),
    direction TEXT NOT NULL CHECK (direction IN ('outbound','inbound','bidirectional')),
    action TEXT NOT NULL CHECK (length(trim(action)) > 0),
    status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','retry_scheduled','duplicate')),
    request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_status INT,
    response_body TEXT NOT NULL DEFAULT '',
    external_event_id TEXT NOT NULL DEFAULT '',
    external_id TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL DEFAULT '',
    attempt INT NOT NULL DEFAULT 1 CHECK (attempt > 0),
    next_retry_at TIMESTAMPTZ,
    error_message TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_respond_sync_audit_incident_time
    ON respond_integration_sync_audit (tenant_id, incident_id, created_at DESC)
    WHERE incident_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_respond_sync_audit_retry
    ON respond_integration_sync_audit (tenant_id, next_retry_at)
    WHERE status = 'retry_scheduled';

CREATE INDEX IF NOT EXISTS idx_respond_sync_audit_idempotency
    ON respond_integration_sync_audit (tenant_id, connector_id, idempotency_key)
    WHERE idempotency_key <> '';

ALTER TABLE respond_integration_connector ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_integration_connector FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_integration_connector_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_integration_connector_secret FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_integration_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_integration_link FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_integration_webhook_dedupe ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_integration_webhook_dedupe FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_integration_sync_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_integration_sync_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON respond_integration_connector;
DROP POLICY IF EXISTS tenant_insert ON respond_integration_connector;
DROP POLICY IF EXISTS tenant_update ON respond_integration_connector;
DROP POLICY IF EXISTS tenant_delete ON respond_integration_connector;
DROP POLICY IF EXISTS tenant_isolation ON respond_integration_connector_secret;
DROP POLICY IF EXISTS tenant_insert ON respond_integration_connector_secret;
DROP POLICY IF EXISTS tenant_update ON respond_integration_connector_secret;
DROP POLICY IF EXISTS tenant_delete ON respond_integration_connector_secret;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_integration_link;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_integration_link;
DROP POLICY IF EXISTS tenant_update ON respond_incident_integration_link;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_integration_link;
DROP POLICY IF EXISTS tenant_isolation ON respond_integration_webhook_dedupe;
DROP POLICY IF EXISTS tenant_insert ON respond_integration_webhook_dedupe;
DROP POLICY IF EXISTS tenant_update ON respond_integration_webhook_dedupe;
DROP POLICY IF EXISTS tenant_delete ON respond_integration_webhook_dedupe;
DROP POLICY IF EXISTS tenant_isolation ON respond_integration_sync_audit;
DROP POLICY IF EXISTS tenant_insert ON respond_integration_sync_audit;
DROP POLICY IF EXISTS tenant_update ON respond_integration_sync_audit;
DROP POLICY IF EXISTS tenant_delete ON respond_integration_sync_audit;

CREATE POLICY tenant_isolation ON respond_integration_connector
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_integration_connector
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_integration_connector
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_integration_connector
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_integration_connector_secret
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_integration_connector_secret
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_integration_connector_secret
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_integration_connector_secret
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_integration_link
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_integration_link
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_integration_link
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_integration_link
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_integration_webhook_dedupe
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_integration_webhook_dedupe
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_integration_webhook_dedupe
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_integration_webhook_dedupe
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_integration_sync_audit
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_integration_sync_audit
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_integration_sync_audit
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_integration_sync_audit
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
