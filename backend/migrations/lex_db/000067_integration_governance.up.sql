-- =============================================================================
-- Lex Integration Platform — integration GOVERNANCE (#13 maker-checker).
--
--   lex_integration_pending_changes: a tenant-scoped, durable record of a
--   PROPOSED configuration change to a PROTECTED integration endpoint (an active
--   production endpoint, or any gov-gated kind — najiz / nafath_verify / emdha).
--   A proposed change is parked here (status=pending) until a second operator
--   (the CHECKER) approves or rejects it (maker-checker / separation of duties).
--   On approval the stored proposed_config is applied through the registry Update
--   path; on rejection it is discarded. A NON-protected endpoint never lands a row
--   here — its change applies immediately.
--
--   SECRET CUSTODY. proposed_config holds the operator-submitted config map. Any
--   SECRET field whose incoming value is the redaction sentinel (__redacted__) is
--   the "keep stored ciphertext" signal — it carries NO cleartext. The diff column
--   is the human-facing before/after, and the governance service MASKS every secret
--   field there (__redacted__ -> __redacted__), so a reviewer never sees a secret.
--   Cleartext credentials are NEVER written to either column.
--
--   tenant_id FIRST; endpoint_id FK -> lex_integration_endpoints (ON DELETE
--   CASCADE, mirroring lex_integration_dlq); ENABLE + FORCE RLS with 4 tenant
--   policies (tenant_isolation / insert / update / delete), the lex table idiom.
--
-- STAGING: numbered by the integrator on promotion (next free after 000066 is
-- 000067). Lives under _staging until then.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lex_integration_pending_changes (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    endpoint_id     UUID        NOT NULL REFERENCES lex_integration_endpoints(id) ON DELETE CASCADE,
    proposed_config JSONB       NOT NULL DEFAULT '{}'::jsonb,
    diff            JSONB       NOT NULL DEFAULT '[]'::jsonb,
    requested_by    UUID        NOT NULL,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewer        UUID,
    reviewed_at     TIMESTAMPTZ,
    note            TEXT        NOT NULL DEFAULT ''
);

-- Tenant-leading index: drives the pending-changes list (newest first) and the
-- per-endpoint / per-status scans.
CREATE INDEX IF NOT EXISTS idx_lex_integration_pending_changes_tenant
    ON lex_integration_pending_changes (tenant_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_lex_integration_pending_changes_endpoint
    ON lex_integration_pending_changes (tenant_id, endpoint_id, status, requested_at DESC);

ALTER TABLE lex_integration_pending_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_integration_pending_changes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_integration_pending_changes
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_integration_pending_changes
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_integration_pending_changes
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_integration_pending_changes
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
