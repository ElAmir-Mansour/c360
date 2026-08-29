-- =============================================================================
-- Lex Integration Platform — endpoint health-check history.
--
--   lex_integration_health_checks: append-only ledger of connector Test()
--   diagnostics. The integration admin console renders this as a health
--   timeline (grade + reachability sparkline per endpoint). tenant_id FIRST,
--   ENABLE+FORCE RLS with 4 tenant policies. No soft-delete (append-only).
--
--   No other schema is needed for the 10 integration-console UX features:
--   secret-rotation timestamps (last_rotated.<field>) and last-received-event
--   markers live in lex_integration_endpoints.metadata (JSONB).
--
-- Integrator: number this 000064 (verified next free at implement time;
-- prior max = 000063 / scim_tokens).
-- =============================================================================

CREATE TABLE IF NOT EXISTS lex_integration_health_checks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    endpoint_id UUID        NOT NULL REFERENCES lex_integration_endpoints(id) ON DELETE CASCADE,
    grade       TEXT        NOT NULL,
    reachable   BOOLEAN     NOT NULL DEFAULT false,
    detail      TEXT,
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant-leading index: drives the per-endpoint health timeline (latest first).
CREATE INDEX IF NOT EXISTS idx_lex_integration_health_checks_endpoint
    ON lex_integration_health_checks (tenant_id, endpoint_id, checked_at DESC);

ALTER TABLE lex_integration_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_integration_health_checks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_integration_health_checks
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_integration_health_checks
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_integration_health_checks
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_integration_health_checks
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
