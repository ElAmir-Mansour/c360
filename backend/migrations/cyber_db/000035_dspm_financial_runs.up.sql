-- =============================================================================
-- Migration 000035: DSPM Financial Quantification Runs
--
-- POST /dspm/financial/run triggers a real server-side (re)computation of the
-- portfolio financial quantification (recomputes + upserts per-asset
-- dspm_financial_impact rows). This table records each run with a computed_at
-- timestamp so the GET endpoints have a freshness/provenance anchor and an
-- auditable history of who recomputed the model and when.
-- =============================================================================

CREATE TABLE IF NOT EXISTS dspm_financial_runs (
    id                        UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 UUID            NOT NULL,
    status                    TEXT            NOT NULL DEFAULT 'completed'
                                              CHECK (status IN ('completed', 'failed')),
    assets_evaluated          INT             NOT NULL DEFAULT 0,
    total_breach_cost         FLOAT           NOT NULL DEFAULT 0,
    total_annual_expected_loss FLOAT          NOT NULL DEFAULT 0,
    triggered_by              UUID,
    error                     TEXT,
    computed_at               TIMESTAMPTZ     NOT NULL DEFAULT now(),
    created_at                TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Latest run per tenant.
CREATE INDEX IF NOT EXISTS idx_dspm_financial_runs_tenant
    ON dspm_financial_runs (tenant_id, computed_at DESC);

-- ----------------------------------------------------------------------------
-- RLS (matches the 000022 tenant-isolation policy set).
-- ----------------------------------------------------------------------------
ALTER TABLE dspm_financial_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dspm_financial_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dspm_financial_runs
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON dspm_financial_runs
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON dspm_financial_runs
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON dspm_financial_runs
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
