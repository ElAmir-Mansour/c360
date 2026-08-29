-- =============================================================================
-- ClarioDR ransomware early-warning — dr_db migration 000008.
--
-- Capability #3: a detector over the replication change stream flags
-- ransomware-like behavior (high payload entropy from bulk encryption,
-- byte/change-rate spikes vs a learned EWMA baseline, and delete/rewrite
-- bursts). On a confirmed anomaly the detector stages dr.ransomware.suspected to
-- the outbox and CURATES the last-known-clean recovery point (pins legal_hold)
-- so a clean restore target is preserved.
--
-- Two tables:
--   dr_ransomware_baselines — one persisted EWMA baseline per (tenant, stream),
--     restored on detector startup so a restart does not re-trigger on normal
--     traffic. Read/written by the cross-tenant detector loop on the system
--     (bypass-RLS) path, like replication_stream and the event outbox.
--   dr_ransomware_signals — the fired early-warning signals. Read on the request
--     path by GET /ransomware/signals, so it carries the standard 4-policy RLS.
--
-- RLS pattern cloned from migrations/dr_db/000001_init_schema.up.sql; the
-- application sets SET LOCAL app.current_tenant_id per request and the detector
-- loop sets app.bypass_rls = 'on' for its cross-tenant reads/writes.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Persisted per-stream EWMA baseline (bytes/sec, changes/sec, sampled entropy).
CREATE TABLE IF NOT EXISTS dr_ransomware_baselines (
    tenant_id UUID NOT NULL,
    stream_id UUID NOT NULL REFERENCES replication_stream(id) ON DELETE CASCADE,
    byte_rate_mean   DOUBLE PRECISION NOT NULL DEFAULT 0,
    byte_rate_var    DOUBLE PRECISION NOT NULL DEFAULT 0,
    change_rate_mean DOUBLE PRECISION NOT NULL DEFAULT 0,
    change_rate_var  DOUBLE PRECISION NOT NULL DEFAULT 0,
    entropy_mean     DOUBLE PRECISION NOT NULL DEFAULT 0,
    entropy_var      DOUBLE PRECISION NOT NULL DEFAULT 0,
    samples          BIGINT NOT NULL DEFAULT 0 CHECK (samples >= 0),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, stream_id)
);

-- Fired ransomware early-warning signals.
CREATE TABLE IF NOT EXISTS dr_ransomware_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    stream_id UUID NOT NULL REFERENCES replication_stream(id) ON DELETE CASCADE,
    signal_kind TEXT NOT NULL
        CHECK (signal_kind IN ('entropy','byte_rate','change_rate','delete_burst')),
    severity TEXT NOT NULL DEFAULT 'warning'
        CHECK (severity IN ('warning','confirmed')),
    observed  DOUBLE PRECISION NOT NULL,        -- the live measurement that tripped
    baseline  DOUBLE PRECISION NOT NULL DEFAULT 0, -- learned steady-state compared to
    ratio     DOUBLE PRECISION NOT NULL DEFAULT 0, -- observed/baseline for rate signals
    threshold DOUBLE PRECISION NOT NULL,         -- configured trip threshold crossed
    sample_seq BIGINT NOT NULL DEFAULT 0 CHECK (sample_seq >= 0), -- frame Seq anchor
    source_lsn TEXT,                             -- recovery coordinate at the window
    -- Last-known-clean recovery point pinned (legal-held) on a confirmed anomaly.
    curated_recovery_point_id UUID REFERENCES recovery_point(id) ON DELETE SET NULL,
    detail TEXT NOT NULL DEFAULT '',
    observed_at TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_ransomware_signals_tenant_time
    ON dr_ransomware_signals (tenant_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dr_ransomware_signals_stream_time
    ON dr_ransomware_signals (tenant_id, stream_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dr_ransomware_signals_severity
    ON dr_ransomware_signals (tenant_id, severity, observed_at DESC);

-- --- Row-Level Security (4-policy clone of 000001) ---------------------------

-- dr_ransomware_baselines
ALTER TABLE dr_ransomware_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_ransomware_baselines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_ransomware_baselines;
DROP POLICY IF EXISTS tenant_insert ON dr_ransomware_baselines;
DROP POLICY IF EXISTS tenant_update ON dr_ransomware_baselines;
DROP POLICY IF EXISTS tenant_delete ON dr_ransomware_baselines;
CREATE POLICY tenant_isolation ON dr_ransomware_baselines
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_ransomware_baselines
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_ransomware_baselines
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_ransomware_baselines
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- dr_ransomware_signals
ALTER TABLE dr_ransomware_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_ransomware_signals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_ransomware_signals;
DROP POLICY IF EXISTS tenant_insert ON dr_ransomware_signals;
DROP POLICY IF EXISTS tenant_update ON dr_ransomware_signals;
DROP POLICY IF EXISTS tenant_delete ON dr_ransomware_signals;
CREATE POLICY tenant_isolation ON dr_ransomware_signals
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_ransomware_signals
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_ransomware_signals
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_ransomware_signals
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
