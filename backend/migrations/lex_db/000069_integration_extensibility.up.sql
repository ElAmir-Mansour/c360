-- =============================================================================
-- Lex Integration Platform — EXTENSIBILITY (#18 no-code custom connector,
-- #19 transform/filter rules, #20 conflict queue + mass-change guard).
--
--   1. Widen lex_integration_endpoints.kind CHECK to admit the new "custom" kind
--      (the no-code generic REST connector, #18). The kind CHECK was last widened
--      in 000058; recreate it explicitly so 'custom' validates alongside the rest.
--      (sync_rules + mass_change_threshold_pct for #19/#20 are non-secret CONFIG
--      fields living inside the existing encrypted config blob — no column needed.)
--
--   2. lex_integration_conflicts: the conflict-resolution queue (#20). One OPEN row
--      per field-level divergence a Reconcile pass finds between a source record and
--      its lex counterpart; an operator lists + resolves them (merge|override|ignore).
--      tenant_id FIRST; FORCE RLS; secret-free (only identifiers + diverging values).
-- =============================================================================

-- 1) Widen the endpoint-kind CHECK to admit the no-code "custom" connector --------
-- Drop-if-exists guards re-runs; the recreated list mirrors 000058 + 'custom'.
ALTER TABLE lex_integration_endpoints
    DROP CONSTRAINT IF EXISTS lex_integration_endpoints_kind_check;
ALTER TABLE lex_integration_endpoints
    ADD CONSTRAINT lex_integration_endpoints_kind_check
    CHECK (kind IN (
        'najiz', 'hr', 'internal', 'archiving', 'email',
        'nafath_verify', 'sso', 'esign', 'custom'
    ));

-- 2) Conflict-resolution queue (#20) ---------------------------------------------
CREATE TABLE IF NOT EXISTS lex_integration_conflicts (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    endpoint_id   UUID        NOT NULL REFERENCES lex_integration_endpoints(id) ON DELETE CASCADE,
    -- external_id is the upstream record the conflict is about (non-sensitive).
    external_id   TEXT        NOT NULL DEFAULT '',
    -- field is the diverging field name; source_value / lex_value are the two sides.
    field         TEXT        NOT NULL DEFAULT '',
    source_value  TEXT        NOT NULL DEFAULT '',
    lex_value     TEXT        NOT NULL DEFAULT '',
    -- status: open until an operator resolves it. resolution records the chosen action.
    status        TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    resolution    TEXT        NOT NULL DEFAULT '',
    -- suggested is the reconciler's secret-free remediation hint.
    suggested     TEXT        NOT NULL DEFAULT '',
    detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at   TIMESTAMPTZ,
    resolved_by   UUID
);

-- One OPEN conflict per (tenant, endpoint, external_id, field): a re-reconcile
-- refreshes the still-open row rather than piling duplicates (drives the Upsert
-- ON CONFLICT). A resolved row keeps the same key so a future re-detection is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_integration_conflicts_unique
    ON lex_integration_conflicts (tenant_id, endpoint_id, external_id, field);

-- Tenant-leading index: drives the per-endpoint conflict list (newest first) + the
-- open-count badge.
CREATE INDEX IF NOT EXISTS idx_lex_integration_conflicts_endpoint
    ON lex_integration_conflicts (tenant_id, endpoint_id, status, detected_at DESC);

ALTER TABLE lex_integration_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_integration_conflicts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_integration_conflicts
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_integration_conflicts
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_integration_conflicts
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_integration_conflicts
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
