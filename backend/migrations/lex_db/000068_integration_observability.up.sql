-- =============================================================================
-- Lex Integration Platform — OBSERVABILITY (#16 per-connector metrics + SLOs,
-- #17 inbound-event inspector + replay). Migration 000068, the next free
-- sequence number after 000067_integration_governance.
--
--   lex_integration_call_metrics: one append-only row per registry dispatch
--   (TestConnection / SyncNow / Invoke) with {op, latency_ms, ok, occurred_at}.
--   Aggregated with percentile_cont (p50/p95) + error_rate over a rolling
--   window to drive ConnectorMetrics + the SLO breach verdict. Carries NO
--   payload and NO secrets — only a non-sensitive operation label + timing.
--   BOUNDED: callers query a time window, and a retention sweep prunes rows
--   older than the longest dashboard window (90d) so the table never grows
--   unbounded. tenant_id FIRST, ENABLE+FORCE RLS with 4 tenant policies.
--
--   lex_integration_events: one row per INBOUND (or test/synthetic) event a
--   verified webhook accepted — kind, signature_valid, status (received |
--   processed | failed), the resulting lex action, a REDACTED jsonb payload,
--   and a sanitized error. Backs the event inspector + replay. The payload is
--   REDACTED by the event-log service before insert (secrets/PII never stored
--   in cleartext here). tenant_id FIRST, ENABLE+FORCE RLS with 4 tenant
--   policies.
--
-- Numbered AFTER 000067 (integration_governance).
-- =============================================================================

-- --- #16 per-connector call metrics --------------------------------------- --
CREATE TABLE IF NOT EXISTS lex_integration_call_metrics (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    endpoint_id UUID        NOT NULL REFERENCES lex_integration_endpoints(id) ON DELETE CASCADE,
    op          TEXT        NOT NULL DEFAULT '',
    latency_ms  INTEGER     NOT NULL DEFAULT 0,
    ok          BOOLEAN     NOT NULL DEFAULT false,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant-leading index: drives the per-endpoint windowed aggregate
-- (tenant + endpoint + occurred_at >= window-start), newest first.
CREATE INDEX IF NOT EXISTS idx_lex_integration_call_metrics_endpoint
    ON lex_integration_call_metrics (tenant_id, endpoint_id, occurred_at DESC);

-- Tenant-leading index for the cross-endpoint tenant rollup (GET .../metrics).
CREATE INDEX IF NOT EXISTS idx_lex_integration_call_metrics_tenant
    ON lex_integration_call_metrics (tenant_id, occurred_at DESC);

ALTER TABLE lex_integration_call_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_integration_call_metrics FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_integration_call_metrics
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_integration_call_metrics
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_integration_call_metrics
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_integration_call_metrics
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- --- #17 inbound-event inspector ------------------------------------------ --
CREATE TABLE IF NOT EXISTS lex_integration_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    endpoint_id     UUID        NOT NULL REFERENCES lex_integration_endpoints(id) ON DELETE CASCADE,
    direction       TEXT        NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
    kind            TEXT        NOT NULL DEFAULT '',
    signature_valid BOOLEAN     NOT NULL DEFAULT false,
    status          TEXT        NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
    result_action   TEXT        NOT NULL DEFAULT '',
    payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    error           TEXT        NOT NULL DEFAULT '',
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant-leading index: drives the per-endpoint event list (newest first) and
-- the filtered (direction/kind/status) inspector queries.
CREATE INDEX IF NOT EXISTS idx_lex_integration_events_endpoint
    ON lex_integration_events (tenant_id, endpoint_id, occurred_at DESC);

-- Tenant-leading index for the cross-endpoint tenant event list (GET .../events).
CREATE INDEX IF NOT EXISTS idx_lex_integration_events_tenant
    ON lex_integration_events (tenant_id, occurred_at DESC);

ALTER TABLE lex_integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_integration_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_integration_events
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_integration_events
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_integration_events
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_integration_events
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
