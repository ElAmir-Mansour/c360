-- Continuous Data Protection (CDP) journal — any-point-in-time (APIT) recovery.
--
-- DESIGN_DataStream_DR.md capability #6. Snapshot-only DR can only rewind to a
-- sealed recovery point; CDP keeps a time-ordered, durable journal of every
-- replicated change frame per stream so state can be reconstructed as of ANY
-- instant or LSN within a retention window.
--
-- Two tables:
--   dr_journal_segment  — the index of sealed journal segments. Each row covers
--     a contiguous, gap-free Seq range of one stream's applied frames, with the
--     LSN and wall-clock bounds and the WORM/frame-store object key that holds
--     the exact sealed bytes. The resolver binary-searches this index to map a
--     target timestamp or LSN to the precise ordered set of segments to replay
--     and the cut LSN within the boundary segment.
--   dr_journal_bookmark — named restore points (app-consistent barriers, drill
--     markers, pre-change markers). A bookmark pins a stream + LSN + wall-clock;
--     retention pruning never removes a segment that a bookmark falls inside.
--
-- Sealed segment bytes are immutable: a sealed segment's coordinates never
-- change (only its prune state may flip from live to pruned), enforced by an
-- append-only trigger. RLS follows the dr_db convention: per-operation tenant
-- policies + the app.bypass_rls backstop for the leader-singleton appender and
-- retention loop.

CREATE TABLE IF NOT EXISTS dr_journal_segment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    stream_id       UUID NOT NULL REFERENCES replication_stream(id) ON DELETE CASCADE,
    -- The contiguous Seq range this segment covers (inclusive). min_seq is the
    -- first frame's Seq, max_seq the last. Segments for a stream tile the Seq
    -- space without gaps or overlap: the next segment opens at max_seq + 1.
    min_seq         BIGINT NOT NULL CHECK (min_seq > 0),
    max_seq         BIGINT NOT NULL CHECK (max_seq >= min_seq),
    frame_count     INT NOT NULL CHECK (frame_count > 0),
    -- LSN bounds, lexical/opaque-ordered as the source emits them. The resolver
    -- compares against these to find the cut LSN. Empty string is allowed for
    -- frame kinds that carry no source LSN; min/max are taken across the segment.
    min_lsn         TEXT NOT NULL DEFAULT '',
    max_lsn         TEXT NOT NULL DEFAULT '',
    -- Wall-clock bounds (the frame EmittedAt range) for timestamp resolution.
    min_ts          TIMESTAMPTZ NOT NULL,
    max_ts          TIMESTAMPTZ NOT NULL CHECK (max_ts >= min_ts),
    -- object_key references the same durable store as the applied frames
    -- (framestore / WORM): the exact sealed bytes for this Seq range.
    object_key      TEXT NOT NULL CHECK (object_key <> ''),
    -- Byte size and a content hash of the sealed segment for tamper evidence.
    payload_bytes   BIGINT NOT NULL CHECK (payload_bytes >= 0),
    content_hash    TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    -- pruned flips true when retention reclaims the segment's bytes; the index
    -- row is retained (tombstone) so a resolve that lands on it reports the data
    -- is no longer recoverable rather than silently returning a wrong segment.
    pruned          BOOLEAN NOT NULL DEFAULT false,
    pruned_at       TIMESTAMPTZ,
    sealed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, stream_id, min_seq)
);

-- Resolver index: binary-search a stream's segments by Seq, ts and LSN.
CREATE INDEX IF NOT EXISTS idx_dr_journal_segment_seq
    ON dr_journal_segment (tenant_id, stream_id, min_seq);
CREATE INDEX IF NOT EXISTS idx_dr_journal_segment_ts
    ON dr_journal_segment (tenant_id, stream_id, max_ts);
CREATE INDEX IF NOT EXISTS idx_dr_journal_segment_lsn
    ON dr_journal_segment (tenant_id, stream_id, max_lsn);
-- Retention scan: aged, not-yet-pruned segments oldest first.
CREATE INDEX IF NOT EXISTS idx_dr_journal_segment_prune
    ON dr_journal_segment (tenant_id, stream_id, max_ts)
    WHERE pruned = false;

CREATE TABLE IF NOT EXISTS dr_journal_bookmark (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    stream_id   UUID NOT NULL REFERENCES replication_stream(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (name <> ''),
    -- kind classifies why the restore point exists, for the timeline UI and so
    -- automatic markers can be distinguished from operator-named ones.
    --   barrier    -> app-consistent barrier (a MARKER frame)
    --   drill      -> a drill / rehearsal point
    --   pre_change -> a pre-change safety marker before a risky operation
    --   manual     -> an operator-named restore point
    kind        TEXT NOT NULL DEFAULT 'manual'
        CHECK (kind IN ('barrier','drill','pre_change','manual')),
    -- The pinned instant: the Seq/LSN/wall-clock the restore point refers to. A
    -- bookmark protects the segment whose Seq range contains at_seq from pruning.
    at_seq      BIGINT NOT NULL CHECK (at_seq > 0),
    at_lsn      TEXT NOT NULL DEFAULT '',
    at_ts       TIMESTAMPTZ NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, stream_id, name)
);

CREATE INDEX IF NOT EXISTS idx_dr_journal_bookmark_stream
    ON dr_journal_bookmark (tenant_id, stream_id, at_seq);
CREATE INDEX IF NOT EXISTS idx_dr_journal_bookmark_protect
    ON dr_journal_bookmark (stream_id, at_seq);

-- Sealed segments are append-only on their coordinates: a segment's Seq/LSN/ts
-- bounds, object key, hash and size are fixed once sealed. Only the prune state
-- (pruned/pruned_at) may transition, exactly once, from live to pruned. Deletes
-- of a live segment are blocked; the retention loop tombstones via UPDATE.
CREATE OR REPLACE FUNCTION prevent_dr_journal_segment_mutation()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Cascade deletes (stream removed) are allowed; a direct delete of a
        -- live segment is not. Distinguish by whether the parent stream still
        -- exists: if it does, this is a forbidden direct delete.
        IF EXISTS (SELECT 1 FROM replication_stream WHERE id = OLD.stream_id) THEN
            RAISE EXCEPTION 'dr_journal_segment rows are append-only (use prune)'
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR NEW.stream_id IS DISTINCT FROM OLD.stream_id
        OR NEW.min_seq IS DISTINCT FROM OLD.min_seq
        OR NEW.max_seq IS DISTINCT FROM OLD.max_seq
        OR NEW.frame_count IS DISTINCT FROM OLD.frame_count
        OR NEW.min_lsn IS DISTINCT FROM OLD.min_lsn
        OR NEW.max_lsn IS DISTINCT FROM OLD.max_lsn
        OR NEW.min_ts IS DISTINCT FROM OLD.min_ts
        OR NEW.max_ts IS DISTINCT FROM OLD.max_ts
        OR NEW.object_key IS DISTINCT FROM OLD.object_key
        OR NEW.payload_bytes IS DISTINCT FROM OLD.payload_bytes
        OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
        OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at THEN
        RAISE EXCEPTION 'dr_journal_segment coordinates are immutable once sealed'
            USING ERRCODE = '55000';
    END IF;

    -- prune is a one-way latch: false -> true only.
    IF OLD.pruned = true AND NEW.pruned = false THEN
        RAISE EXCEPTION 'dr_journal_segment prune state cannot be un-set'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dr_journal_segment_append_only_guard ON dr_journal_segment;
CREATE TRIGGER dr_journal_segment_append_only_guard
    BEFORE UPDATE OR DELETE ON dr_journal_segment
    FOR EACH ROW
    EXECUTE FUNCTION prevent_dr_journal_segment_mutation();

ALTER TABLE dr_journal_segment ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_journal_segment FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_journal_segment;
DROP POLICY IF EXISTS tenant_insert ON dr_journal_segment;
DROP POLICY IF EXISTS tenant_update ON dr_journal_segment;
DROP POLICY IF EXISTS tenant_delete ON dr_journal_segment;

CREATE POLICY tenant_isolation ON dr_journal_segment
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_journal_segment
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_journal_segment
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_journal_segment
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE dr_journal_bookmark ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_journal_bookmark FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_journal_bookmark;
DROP POLICY IF EXISTS tenant_insert ON dr_journal_bookmark;
DROP POLICY IF EXISTS tenant_update ON dr_journal_bookmark;
DROP POLICY IF EXISTS tenant_delete ON dr_journal_bookmark;

CREATE POLICY tenant_isolation ON dr_journal_bookmark
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_journal_bookmark
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_journal_bookmark
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_journal_bookmark
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
