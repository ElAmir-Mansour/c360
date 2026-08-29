-- Application-consistent recovery points (ClarioDR capability #7 /
-- DESIGN_DataStream_DR.md §5 recovery-point chunking).
--
-- A plain recovery point is only *crash*-consistent: it captures whatever bytes
-- happened to be on disk, so in-flight application writes and dirty caches may be
-- only partially present. An *application*-consistent point is captured after the
-- protected workload has been quiesced (fsfreeze / VSS / DB FLUSH) so all in-flight
-- writes are flushed and caches are drained; the coordinator then places or
-- derives a CONSISTENCY BARRIER marker at the source, waits for every member
-- stream to apply through that marker, seals the point, and thaws the workload.
--
-- dr_consistency_barrier is the durable record of every quiesce/seal/thaw attempt:
-- the provider used, the quiesce + thaw timestamps, success, the barrier LSN the
-- marker was placed at, the resulting recovery_point_id (when sealing succeeded),
-- and the achieved consistency level (application vs crash). The barrier row is the
-- authoritative consistency_level for the produced point — it is written in the
-- same transaction as the seal so the two commit together (or not at all).

CREATE TABLE IF NOT EXISTS dr_consistency_barrier (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    group_id          UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    -- recovery_point_id is the application-consistent point that was sealed at this
    -- barrier. It is NULL when quiesce failed (no point sealed) or when the capture
    -- failed after a successful quiesce (barrier recorded as failed, workload thawed).
    recovery_point_id UUID REFERENCES recovery_point(id) ON DELETE SET NULL,
    -- consistency_level is the achieved level of the produced point:
    --   application -> workload was quiesced, in-flight writes flushed, then sealed
    --   crash       -> no quiesce (or quiesce failed) — only on-disk bytes captured
    consistency_level TEXT NOT NULL CHECK (consistency_level IN ('application','crash')),
    -- provider names the quiesce mechanism that ran: 'script' (pre-freeze/post-thaw
    -- commands) or 'http' (workload-agent webhook), or 'none' when no quiesce ran.
    provider          TEXT NOT NULL CHECK (provider IN ('script','http','none')),
    -- barrier_lsn is the source marker the consistency fence drained to; it pins
    -- the exact point in the change stream the sealed point corresponds to.
    barrier_lsn       TEXT NOT NULL DEFAULT '',
    -- success is true only when quiesce, marker placement/derivation, stream
    -- drain, and seal all succeeded AND the workload was thawed cleanly.
    success           BOOLEAN NOT NULL DEFAULT false,
    -- quiesced indicates the workload was successfully frozen (distinguishes a
    -- quiesce failure from a later capture failure).
    quiesced          BOOLEAN NOT NULL DEFAULT false,
    -- thawed indicates the post-thaw step ran and reported success; the coordinator
    -- ALWAYS attempts thaw (via defer) even when the capture failed.
    thawed            BOOLEAN NOT NULL DEFAULT false,
    -- detail captures the human-readable outcome: provider stdout/stderr on failure,
    -- the failing phase, or a one-line success summary.
    detail            TEXT NOT NULL DEFAULT '',
    -- error is the failure reason when success = false (empty on success).
    error             TEXT NOT NULL DEFAULT '',
    requested_by      UUID,
    quiesce_started_at  TIMESTAMPTZ,
    quiesce_finished_at TIMESTAMPTZ,
    thaw_started_at     TIMESTAMPTZ,
    thaw_finished_at    TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_consistency_barrier_group
    ON dr_consistency_barrier (tenant_id, group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_consistency_barrier_rp
    ON dr_consistency_barrier (recovery_point_id)
    WHERE recovery_point_id IS NOT NULL;

-- Per-operation tenant RLS policies + the app.bypass_rls backstop, matching the
-- dr_db convention (clone of migrations/platform_core/000002_rls + the other dr_db
-- tables). Every request-path query also filters by tenant_id and runs under
-- SET LOCAL app.current_tenant_id, so RLS is the safety net if a filter is forgotten.
ALTER TABLE dr_consistency_barrier ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_consistency_barrier FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_consistency_barrier;
DROP POLICY IF EXISTS tenant_insert ON dr_consistency_barrier;
DROP POLICY IF EXISTS tenant_update ON dr_consistency_barrier;
DROP POLICY IF EXISTS tenant_delete ON dr_consistency_barrier;

CREATE POLICY tenant_isolation ON dr_consistency_barrier
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_consistency_barrier
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_consistency_barrier
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_consistency_barrier
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
