-- Predictive failure detection for ClarioDR (DESIGN §11 metrics, §8 events).
--
-- The forecaster consumes datastream.dr.progress telemetry per replication
-- stream (lag, throughput, applied_seq cadence), persists a rolling sample
-- series (dr_replication_samples), and writes the computed prediction
-- (dr_predictions) so a control-plane restart can resume the EWMA/trend state
-- and the API can serve the most recent forecast without recomputing history.
--
-- Both tables carry tenant_id and are RLS-isolated like the rest of dr_db. The
-- forecaster background loop reads across tenants through the system query path
-- (it bypasses RLS by design, mirroring the RPO monitor), while the request
-- path (GET /predictions, GET /streams/{id}/forecast) filters by tenant and
-- runs under SET LOCAL app.current_tenant_id so RLS is the backstop.

-- Rolling per-stream telemetry sample series. One row per ingested
-- datastream.dr.progress sample; old rows are pruned to a configurable window
-- by the forecaster so the table stays bounded.
CREATE TABLE IF NOT EXISTS dr_replication_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    stream_id UUID NOT NULL REFERENCES replication_stream(id) ON DELETE CASCADE,
    -- Wall-clock at which the sample's lag/throughput were observed at apply.
    observed_at TIMESTAMPTZ NOT NULL,
    -- Live replication lag in seconds (now - Frame.EmittedAt at apply).
    lag_seconds DOUBLE PRECISION NOT NULL CHECK (lag_seconds >= 0),
    -- Apply throughput in bytes per second for this sample window.
    throughput_bps DOUBLE PRECISION NOT NULL CHECK (throughput_bps >= 0),
    -- Highest contiguously-applied Seq at the time of the sample; its cadence
    -- across samples is the "applied_seq is advancing" liveness signal.
    applied_seq BIGINT NOT NULL DEFAULT 0 CHECK (applied_seq >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Idempotency: a re-delivered progress sample (same stream + same observed
    -- instant) is a safe no-op rather than a duplicate series point.
    UNIQUE (tenant_id, stream_id, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_dr_samples_stream_time
    ON dr_replication_samples (tenant_id, stream_id, observed_at DESC);

-- Retention pruning scans by age; this index makes the delete cheap.
CREATE INDEX IF NOT EXISTS idx_dr_samples_observed_at
    ON dr_replication_samples (observed_at);

-- Latest computed prediction per stream. Upserted on every forecast; the row
-- is the durable, queryable forecast the API serves and the background loop
-- uses to decide whether a new breach event must be staged (it only fires when
-- the breach state flips, so repeated forecasts are idempotent).
CREATE TABLE IF NOT EXISTS dr_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    stream_id UUID NOT NULL REFERENCES replication_stream(id) ON DELETE CASCADE,
    -- Consistency-group (or site) label used for the dr_predicted_breach_seconds
    -- gauge and for grouping in the API response.
    group_label TEXT NOT NULL DEFAULT '',
    -- RPO objective (seconds) the forecast is measured against.
    rpo_objective_seconds INT NOT NULL,
    -- EWMA of replication lag (seconds) at the time of the forecast.
    smoothed_lag_seconds DOUBLE PRECISION NOT NULL,
    -- Holt-style trend slope of lag in seconds-of-lag per second of wall clock.
    -- Positive = lag growing (heading toward breach); negative = recovering.
    lag_trend_slope DOUBLE PRECISION NOT NULL,
    -- Throughput trend slope (bytes/sec per second). Sharply negative is the
    -- early source-failure / throughput-collapse signal.
    throughput_trend_slope DOUBLE PRECISION NOT NULL,
    -- Forecast horizon to RPO breach in seconds:
    --   (objective - smoothed_lag) / lag_trend_slope.
    -- NULL when lag is flat/shrinking (no finite breach horizon).
    predicted_breach_seconds DOUBLE PRECISION,
    -- True when predicted_breach_seconds fell under the alert window and a
    -- breach forecast event was staged, so a recovery can clear it once.
    breach_forecast BOOLEAN NOT NULL DEFAULT false,
    -- True when throughput collapse was detected at this forecast.
    throughput_collapse BOOLEAN NOT NULL DEFAULT false,
    -- Number of samples that fed this forecast (a forecast needs >= 2 points).
    sample_count INT NOT NULL DEFAULT 0,
    forecast_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, stream_id)
);

CREATE INDEX IF NOT EXISTS idx_dr_predictions_breach
    ON dr_predictions (tenant_id, breach_forecast, forecast_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_predictions_stream
    ON dr_predictions (tenant_id, stream_id);

ALTER TABLE dr_replication_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_replication_samples FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_predictions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_replication_samples;
DROP POLICY IF EXISTS tenant_insert ON dr_replication_samples;
DROP POLICY IF EXISTS tenant_update ON dr_replication_samples;
DROP POLICY IF EXISTS tenant_delete ON dr_replication_samples;

CREATE POLICY tenant_isolation ON dr_replication_samples
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_replication_samples
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_replication_samples
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_replication_samples
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

DROP POLICY IF EXISTS tenant_isolation ON dr_predictions;
DROP POLICY IF EXISTS tenant_insert ON dr_predictions;
DROP POLICY IF EXISTS tenant_update ON dr_predictions;
DROP POLICY IF EXISTS tenant_delete ON dr_predictions;

CREATE POLICY tenant_isolation ON dr_predictions
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_predictions
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_predictions
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_predictions
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
