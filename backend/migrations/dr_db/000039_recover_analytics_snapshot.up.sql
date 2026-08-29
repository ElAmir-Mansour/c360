-- =============================================================================
-- Clario Recover — UNIFIED RTO/RTA & RECOVERY ANALYTICS readiness-trend snapshot
-- (Prompt 8, Wave 3).
--
-- The cross-sub-solution analytics endpoint (GET /api/recover/analytics) computes
-- per-application RTO-vs-RTA, multi-application recovery progress, and flagged
-- bottlenecks LIVE from the EXISTING execution records (dr_studio_run, joined to
-- applications via recover_metastore_runbook_link; dr_drill_result; failover_run)
-- and the RTO TARGET from the Application Metastore seam — those are never
-- duplicated here.
--
-- What this table persists is the ONE thing the live records cannot reconstruct:
-- the portfolio READINESS TREND over time. A readiness score is a point-in-time
-- projection of the current estate; to plot a trend the analytics layer appends
-- one immutable snapshot per capture. The snapshot is append-only (no UPDATE /
-- DELETE code path in the store) so the trend is a faithful historical record.
--
-- This table carries the dr_db RLS clone (see 000036_recover_activation): every
-- request-path query filters by tenant AND runs under SET LOCAL
-- app.current_tenant_id, with RLS as the backstop; app.bypass_rls is reserved for
-- any cross-tenant system path, exactly as elsewhere in dr_db.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One immutable row per portfolio-readiness capture. score is 0..100; the
-- component fractions that produced it are kept as JSONB so a trend point stays
-- explainable. captured_at is the logical capture instant (the analytics request
-- time), distinct from the physical created_at.
CREATE TABLE IF NOT EXISTS recover_readiness_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    -- the portfolio readiness score at capture (0..100), and the count of
    -- applications the score was computed across (denominator transparency).
    score INTEGER NOT NULL
        CHECK (score >= 0 AND score <= 100),
    application_count INTEGER NOT NULL DEFAULT 0
        CHECK (application_count >= 0),
    -- applications whose latest RTA exceeded their RTO target at capture — the
    -- count of breaching applications, surfaced on the trend for context.
    breaching_count INTEGER NOT NULL DEFAULT 0
        CHECK (breaching_count >= 0),
    -- the weighted component breakdown that produced the score (key→fraction),
    -- so a trend point is explainable, never a bare number.
    components JSONB NOT NULL DEFAULT '{}'::jsonb,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The trend query reads a tenant's snapshots over a trailing window, newest
-- first; this composite index keeps that a single-tenant ranged scan.
CREATE INDEX IF NOT EXISTS idx_recover_readiness_snapshot_trend
    ON recover_readiness_snapshot (tenant_id, captured_at DESC);

-- --- Row level security (clone of dr_db RLS convention) ---------------------

ALTER TABLE recover_readiness_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE recover_readiness_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON recover_readiness_snapshot;
DROP POLICY IF EXISTS tenant_insert ON recover_readiness_snapshot;
-- The read policy is scoped to SELECT only (FOR SELECT), NOT a catch-all FOR ALL
-- (whose USING clause would also satisfy UPDATE/DELETE). Combined with the
-- INSERT-only write policy and the absence of any UPDATE/DELETE policy, FORCE RLS
-- denies UPDATE and DELETE to EVERY session (owner included), so the readiness
-- trend is append-only at the DATABASE layer, not just the service layer.
CREATE POLICY tenant_select ON recover_readiness_snapshot
    FOR SELECT
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON recover_readiness_snapshot
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
-- No UPDATE or DELETE policy: the snapshot trend is append-only by design, so
-- even a tenant-scoped session cannot mutate a recorded readiness point.
