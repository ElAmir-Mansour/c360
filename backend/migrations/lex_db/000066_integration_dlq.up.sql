-- =============================================================================
-- Lex Integration Platform — dead-letter queue (DLQ, reliability feature #11).
--
--   lex_integration_dlq: durable, tenant-scoped record of a FAILED integration
--   operation (a SyncNow / Invoke / TestConnection dispatch, or a verified-but-
--   failed inbound webhook handling) that the operator can REPLAY from the admin
--   console. Each row carries a REDACTED payload (secrets stripped by the DLQ
--   service before insert — never written here in cleartext), a sanitized error
--   message, an attempt counter, and a lifecycle status (failed -> replayed /
--   resolved). tenant_id FIRST, ENABLE+FORCE RLS with 4 tenant policies.
--
--   The breaker controls (feature #12) need NO schema: per-endpoint breaker
--   state + auto-quarantine are held in-process (BreakerController), and the
--   quarantine "stop calling me" flag is reflected onto the endpoint's existing
--   status column (active -> disabled) via the registry, so no new table.
--
-- Numbered 000066 (next free after 000065 / integration_sync_runs_preview_mode).
-- =============================================================================

CREATE TABLE IF NOT EXISTS lex_integration_dlq (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    endpoint_id     UUID        NOT NULL REFERENCES lex_integration_endpoints(id) ON DELETE CASCADE,
    source          TEXT        NOT NULL CHECK (source IN ('sync', 'webhook', 'outbox', 'invoke')),
    summary         TEXT        NOT NULL DEFAULT '',
    payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    error           TEXT        NOT NULL DEFAULT '',
    attempts        INTEGER     NOT NULL DEFAULT 0,
    status          TEXT        NOT NULL DEFAULT 'failed' CHECK (status IN ('failed', 'replayed', 'resolved')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_attempt_at TIMESTAMPTZ
);

-- Tenant-leading index: drives the per-endpoint DLQ list (newest first) and the
-- batch replay-failed scan (tenant + endpoint + status).
CREATE INDEX IF NOT EXISTS idx_lex_integration_dlq_endpoint
    ON lex_integration_dlq (tenant_id, endpoint_id, status, created_at DESC);

-- Tenant-leading index for the cross-endpoint tenant DLQ list (GET .../dlq).
CREATE INDEX IF NOT EXISTS idx_lex_integration_dlq_tenant
    ON lex_integration_dlq (tenant_id, status, created_at DESC);

ALTER TABLE lex_integration_dlq ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_integration_dlq FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_integration_dlq
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_integration_dlq
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_integration_dlq
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_integration_dlq
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
