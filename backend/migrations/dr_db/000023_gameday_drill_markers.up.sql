-- =============================================================================
-- ClarioDR capability #14 — GAME-DAY: make the induce_lag and block_site faults
-- GENUINELY OBSERVABLE by the platform's own monitoring (not in-process self-
-- tests). DESIGN_DataStream_DR.md §6 (drill scope), §11 (SLO board).
--
-- Before this migration the induce_lag / block_site faults wrote to in-process
-- maps that nothing in the observation path read, so only pause_stream produced
-- a real, measured platform reaction. This migration adds the two DURABLE,
-- DRILL-SCOPE marker substrates the design always intended ("wired to a durable
-- drill-scope marker store in a later migration without changing the fault
-- contract"):
--
--   dr_drill_lag_marker  : a per-stream simulated replication-lag offset the
--                          PREDICT forecaster honors (systemListStreamStatesSQL
--                          adds it to each windowed sample's lag), so an induced
--                          lag genuinely raises the smoothed lag and flips
--                          dr_predictions.breach_forecast — the lag_alert /
--                          predicted_breach signal a game-day step polls for.
--   dr_drill_site_block  : a per-site reachability block. The TOPOLOGY overlay
--                          flips the blocked site's edges to 'unhealthy' (and
--                          snapshots their prior health for an exact revert), so
--                          an induced site block genuinely flips
--                          dr_topology_edge.health — the topology_degraded
--                          signal a game-day step polls for.
--
-- It also adds dr_gameday_step_result.observability so the SCORECARD declares,
-- per step, whether the fault was system-observable (a real platform reaction
-- was measured) or harness-only (a self-test) — a green run can never be misread
-- as "the platform survived a real fault".
--
-- Both marker tables are written and read ONLY on the system (RLS-bypass) path
-- (the leader-singleton game-day orchestrator and the forecaster/topology
-- consumers), but they carry RLS with the app.bypass_rls backstop and tenant
-- policies for defense in depth, matching the dr_db convention (§7).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- A simulated replication-lag offset (seconds) for a stream, set by the game-day
-- induce_lag fault and cleared on its revert. It does NOT delay real replication;
-- the forecaster ADDS it to the stream's sampled lag so its breach detection is
-- exercised against an observable lag the platform actually reacts to.
CREATE TABLE IF NOT EXISTS dr_drill_lag_marker (
    -- stream_id is globally unique (replication_stream PK), so it keys the marker.
    stream_id UUID PRIMARY KEY REFERENCES replication_stream(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    lag_seconds DOUBLE PRECISION NOT NULL CHECK (lag_seconds >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_drill_lag_marker_tenant
    ON dr_drill_lag_marker (tenant_id);

-- A drill-scope reachability block for a site, set by the game-day block_site
-- fault and cleared on its revert. snapshot records the prior health of every
-- topology edge the block flipped to 'unhealthy' ([{edge_id, prev_health}, ...]),
-- so the revert restores the EXACT pre-block health rather than guessing.
CREATE TABLE IF NOT EXISTS dr_drill_site_block (
    site_id UUID PRIMARY KEY REFERENCES protected_site(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    blocked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_drill_site_block_tenant
    ON dr_drill_site_block (tenant_id);

-- The per-step scorecard now declares whether the step's fault was genuinely
-- observable by the platform (a real reaction was measured) or harness-only (an
-- in-process self-test). After this migration all three faults are
-- system-observable; the column exists so any future harness-only fault is
-- flagged and a green run is never misread.
ALTER TABLE dr_gameday_step_result
    ADD COLUMN IF NOT EXISTS observability TEXT NOT NULL DEFAULT 'harness_only'
        CHECK (observability IN ('system_observable', 'harness_only'));

-- Backfill historical rows honestly: before this migration only pause_stream
-- produced a real, measured platform reaction; induce_lag / block_site were
-- in-process self-tests at the time those legacy runs executed.
UPDATE dr_gameday_step_result
   SET observability = CASE
        WHEN action = 'pause_stream' THEN 'system_observable'
        ELSE 'harness_only'
   END
 WHERE true;

-- =============================================================================
-- Row-level security (system-path writers/readers + tenant backstop), mirroring
-- the dr_db convention used by the game-day / topology / predict tables.
-- =============================================================================
ALTER TABLE dr_drill_lag_marker ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_drill_lag_marker FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_drill_site_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_drill_site_block FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_drill_lag_marker;
DROP POLICY IF EXISTS tenant_insert ON dr_drill_lag_marker;
DROP POLICY IF EXISTS tenant_update ON dr_drill_lag_marker;
DROP POLICY IF EXISTS tenant_delete ON dr_drill_lag_marker;

DROP POLICY IF EXISTS tenant_isolation ON dr_drill_site_block;
DROP POLICY IF EXISTS tenant_insert ON dr_drill_site_block;
DROP POLICY IF EXISTS tenant_update ON dr_drill_site_block;
DROP POLICY IF EXISTS tenant_delete ON dr_drill_site_block;

CREATE POLICY tenant_isolation ON dr_drill_lag_marker
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_drill_lag_marker
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_drill_lag_marker
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_drill_lag_marker
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON dr_drill_site_block
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_drill_site_block
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_drill_site_block
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_drill_site_block
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
