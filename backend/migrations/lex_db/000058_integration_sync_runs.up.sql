-- =============================================================================
-- Lex Integration Platform (Phase 1) — connector framework backing store.
--
--  1. lex_integration_sync_runs: append-only ledger of Syncer dispatches (the
--     admin console renders this as a sync timeline + reconciliation gaps).
--     tenant_id FIRST, 4 RLS policies, no soft-delete (append-only history).
--  2. Widen lex_integration_endpoints.kind CHECK to admit the framework's new
--     connector kinds (nafath_verify, sso, esign) alongside the original five.
--
-- Numbered 000058 (verified next free at implement time; prior max = 000057).
-- =============================================================================

-- 1) Sync-run ledger ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_integration_sync_runs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    endpoint_id   UUID        NOT NULL REFERENCES lex_integration_endpoints(id) ON DELETE CASCADE,
    kind          TEXT        NOT NULL,
    mode          TEXT        NOT NULL DEFAULT 'delta' CHECK (mode IN ('full', 'delta')),
    status        TEXT        NOT NULL CHECK (status IN ('succeeded', 'partial', 'failed')),
    processed     INT         NOT NULL DEFAULT 0,
    created       INT         NOT NULL DEFAULT 0,
    updated       INT         NOT NULL DEFAULT 0,
    skipped       INT         NOT NULL DEFAULT 0,
    failed        INT         NOT NULL DEFAULT 0,
    watermark     TEXT        NOT NULL DEFAULT '',
    detail        TEXT        NOT NULL DEFAULT '',
    error         TEXT,
    metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    triggered_by  UUID,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_integration_sync_runs_endpoint
    ON lex_integration_sync_runs (tenant_id, endpoint_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lex_integration_sync_runs_status
    ON lex_integration_sync_runs (tenant_id, status, started_at DESC);

ALTER TABLE lex_integration_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_integration_sync_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_integration_sync_runs
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_integration_sync_runs
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_integration_sync_runs
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_integration_sync_runs
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- 2) Widen the endpoint-kind CHECK to admit the new framework kinds -----------
-- The constraint name in 000032 was the implicit table-level CHECK; recreate it
-- explicitly so the new kinds validate. Drop-if-exists guards re-runs.
ALTER TABLE lex_integration_endpoints
    DROP CONSTRAINT IF EXISTS lex_integration_endpoints_kind_check;
ALTER TABLE lex_integration_endpoints
    ADD CONSTRAINT lex_integration_endpoints_kind_check
    CHECK (kind IN (
        'najiz', 'hr', 'internal', 'archiving', 'email',
        'nafath_verify', 'sso', 'esign'
    ));
