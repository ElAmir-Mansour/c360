-- Durable applied-frame store for recovery-point sealing.
--
-- Recovery points must seal the actual bytes applied to each replication
-- stream, not only the checkpoint coordinates. This table records the raw
-- applied frame payloads keyed by (tenant, stream, seq), with the source marker
-- carried alongside for marker-time manifests. Appends are idempotent at the
-- repository layer: a duplicate (tenant_id, stream_id, seq) is accepted only
-- when kind/source_marker/payload_sha256 match the existing row.

CREATE TABLE IF NOT EXISTS dr_applied_frame (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    stream_id UUID NOT NULL REFERENCES replication_stream(id) ON DELETE CASCADE,
    seq BIGINT NOT NULL CHECK (seq > 0),
    kind TEXT NOT NULL CHECK (kind IN ('SNAPSHOT_CHUNK','WAL','FILE_DELTA','MARKER')),
    source_marker TEXT NOT NULL DEFAULT '',
    payload BYTEA NOT NULL,
    payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    payload_bytes BIGINT NOT NULL CHECK (payload_bytes = octet_length(payload)),
    applied_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, stream_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_dr_applied_frame_stream_seq
    ON dr_applied_frame (tenant_id, stream_id, seq);

CREATE INDEX IF NOT EXISTS idx_dr_applied_frame_stream_marker
    ON dr_applied_frame (tenant_id, stream_id, source_marker, seq);

CREATE INDEX IF NOT EXISTS idx_dr_applied_frame_stream_applied
    ON dr_applied_frame (tenant_id, stream_id, applied_at DESC);

CREATE OR REPLACE FUNCTION prevent_dr_applied_frame_mutation()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'dr_applied_frame rows are append-only'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR NEW.stream_id IS DISTINCT FROM OLD.stream_id
        OR NEW.seq IS DISTINCT FROM OLD.seq
        OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.source_marker IS DISTINCT FROM OLD.source_marker
        OR NEW.payload IS DISTINCT FROM OLD.payload
        OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
        OR NEW.payload_bytes IS DISTINCT FROM OLD.payload_bytes
        OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'dr_applied_frame rows are append-only'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dr_applied_frame_append_only_guard ON dr_applied_frame;
CREATE TRIGGER dr_applied_frame_append_only_guard
    BEFORE UPDATE OR DELETE ON dr_applied_frame
    FOR EACH ROW
    EXECUTE FUNCTION prevent_dr_applied_frame_mutation();

ALTER TABLE dr_applied_frame ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_applied_frame FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_applied_frame;
DROP POLICY IF EXISTS tenant_insert ON dr_applied_frame;
DROP POLICY IF EXISTS tenant_update ON dr_applied_frame;
DROP POLICY IF EXISTS tenant_delete ON dr_applied_frame;

CREATE POLICY tenant_isolation ON dr_applied_frame
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_applied_frame
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_applied_frame
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_applied_frame
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
