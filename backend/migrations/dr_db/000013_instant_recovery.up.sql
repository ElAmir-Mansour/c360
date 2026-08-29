-- =============================================================================
-- ClarioDR capability #8 — INSTANT RECOVERY (boot-from-DR with copy-on-write,
-- lazy hydration). DESIGN_DataStream_DR.md §5 (recovery points / WORM) and §6
-- (the gated FSM): instant recovery serves a recovered workload from a sealed
-- recovery point in SECONDS by presenting the point as a copy-on-write overlay.
--
-- Reads fall through to the immutable sealed recovery point (the base); writes
-- redirect to a private per-session overlay that NEVER mutates the base; the
-- full dataset hydrates lazily in the background while the workload already
-- runs. These two tables persist:
--
--   dr_instant_session       one instant-recovery session over a recovery point,
--                            with its lifecycle state and hydration progress.
--   dr_instant_overlay_chunk the copy-on-write overlay: one row per chunk index
--                            that has been written-over or hydrated, holding the
--                            overlay bytes. A read with no overlay row falls
--                            through to the base recovery-point chunk.
--
-- Both tables are tenant-scoped and carry the same RLS clone as the rest of
-- dr_db (migrations/dr_db/000001_init_schema.up.sql): request-path queries
-- filter by tenant AND run under SET LOCAL app.current_tenant_id, with RLS as
-- the backstop; the app.bypass_rls escape hatch is reserved for the background
-- hydration / finalize loop, exactly as elsewhere in dr_db.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One instant-recovery session: a copy-on-write view over a single recovery
-- point. state walks HYDRATING -> READY -> FINALIZING -> FINALIZED, with FAILED
-- reachable from any non-terminal state.
CREATE TABLE IF NOT EXISTS dr_instant_session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    recovery_point_id UUID NOT NULL,             -- the sealed base being served
    group_id UUID,                               -- the recovery point's group (denormalized for listing)
    state TEXT NOT NULL DEFAULT 'HYDRATING'
        CHECK (state IN ('HYDRATING','READY','FINALIZING','FINALIZED','FAILED')),
    chunks_total INT NOT NULL DEFAULT 0,         -- total base chunks to hydrate
    chunks_hydrated INT NOT NULL DEFAULT 0,      -- base chunks copied into the overlay so far
    chunk_size INT NOT NULL DEFAULT 0,           -- bytes per chunk (0 = variable / source-defined)
    overlay_location TEXT NOT NULL DEFAULT '',   -- where the overlay lives (e.g. "db:dr_instant_overlay_chunk")
    finalized_location TEXT,                     -- standalone full copy location after Finalize()
    last_error TEXT,                             -- populated when state = FAILED
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ready_at TIMESTAMPTZ,                        -- when hydration first completed (state -> READY)
    finalized_at TIMESTAMPTZ,                    -- when the standalone copy completed (state -> FINALIZED)
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_instant_session_tenant
    ON dr_instant_session (tenant_id, started_at DESC);

-- The hydration loop claims sessions still hydrating across tenants; this
-- partial index keeps that scan cheap (terminal states are excluded).
CREATE INDEX IF NOT EXISTS idx_dr_instant_session_active
    ON dr_instant_session (state)
    WHERE state IN ('HYDRATING','FINALIZING');

-- The copy-on-write overlay. One row per chunk index that has been either
-- written-over (redirect-on-write) or lazily hydrated (background copy of the
-- base chunk). origin distinguishes the two so accounting only counts hydrated
-- base chunks toward chunks_hydrated and so a finalize keeps written-over chunks
-- authoritative over hydrated ones.
--   origin = 'write'    operator/workload wrote this chunk; it overrides base.
--   origin = 'hydrate'  background hydration copied the base chunk verbatim.
CREATE TABLE IF NOT EXISTS dr_instant_overlay_chunk (
    session_id UUID NOT NULL REFERENCES dr_instant_session(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    chunk_index BIGINT NOT NULL,                 -- 0-based block/chunk index
    origin TEXT NOT NULL DEFAULT 'write'
        CHECK (origin IN ('write','hydrate')),
    data BYTEA NOT NULL,                         -- the overlay chunk bytes
    content_hash TEXT NOT NULL,                  -- sha256 hex of data (tamper-evidence)
    byte_len INT NOT NULL,                       -- length(data); kept for cheap accounting
    written_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_dr_instant_overlay_session
    ON dr_instant_overlay_chunk (session_id, chunk_index);

-- --- Row level security (clone of dr_db RLS convention) ---------------------

ALTER TABLE dr_instant_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_instant_session FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_instant_session;
DROP POLICY IF EXISTS tenant_insert ON dr_instant_session;
DROP POLICY IF EXISTS tenant_update ON dr_instant_session;
DROP POLICY IF EXISTS tenant_delete ON dr_instant_session;
CREATE POLICY tenant_isolation ON dr_instant_session
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_instant_session
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_instant_session
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_instant_session
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE dr_instant_overlay_chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_instant_overlay_chunk FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_instant_overlay_chunk;
DROP POLICY IF EXISTS tenant_insert ON dr_instant_overlay_chunk;
DROP POLICY IF EXISTS tenant_update ON dr_instant_overlay_chunk;
DROP POLICY IF EXISTS tenant_delete ON dr_instant_overlay_chunk;
CREATE POLICY tenant_isolation ON dr_instant_overlay_chunk
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_instant_overlay_chunk
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_instant_overlay_chunk
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_instant_overlay_chunk
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
