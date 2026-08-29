-- ClarioDR capability #9 hardening — durable failback reverse-stream ledger.
--
-- dr_failback_run owns the gated FSM. This table owns the data-plane progress
-- that FSM gates on: the DR-site source stream, restored-primary target stream,
-- produced head, applied cursor, byte backlog, and cutover-window state.
-- Without this row the failback driver can only compare two unrelated forward
-- stream ledgers. With it, REVERSE_SYNCING and CUTTING_BACK read one durable
-- reverse stream and fail closed if the reverse delta has not drained.

CREATE TABLE IF NOT EXISTS dr_failback_reverse_stream (
    stream_id TEXT PRIMARY KEY,
    run_id UUID NOT NULL UNIQUE REFERENCES dr_failback_run(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id),
    from_site UUID NOT NULL REFERENCES protected_site(id),
    to_site UUID NOT NULL REFERENCES protected_site(id),
    source_stream_id UUID NOT NULL REFERENCES replication_stream(id),
    target_stream_id UUID NOT NULL REFERENCES replication_stream(id),
    head_seq BIGINT NOT NULL DEFAULT 0 CHECK (head_seq >= 0),
    applied_seq BIGINT NOT NULL DEFAULT 0 CHECK (applied_seq >= 0),
    head_lsn TEXT,
    applied_lsn TEXT,
    bytes_pending BIGINT NOT NULL DEFAULT 0 CHECK (bytes_pending >= 0),
    cutover_window_open BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'syncing'
        CHECK (status IN ('syncing','drained','cutback','closed','error')),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_site <> to_site),
    CHECK (source_stream_id <> target_stream_id)
);

CREATE INDEX IF NOT EXISTS idx_failback_reverse_stream_run
    ON dr_failback_reverse_stream (run_id);

CREATE INDEX IF NOT EXISTS idx_failback_reverse_stream_tenant
    ON dr_failback_reverse_stream (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_failback_reverse_stream_status
    ON dr_failback_reverse_stream (status, updated_at);

ALTER TABLE dr_failback_reverse_stream ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_failback_reverse_stream FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_failback_reverse_stream;
DROP POLICY IF EXISTS tenant_insert ON dr_failback_reverse_stream;
DROP POLICY IF EXISTS tenant_update ON dr_failback_reverse_stream;
DROP POLICY IF EXISTS tenant_delete ON dr_failback_reverse_stream;

CREATE POLICY tenant_isolation ON dr_failback_reverse_stream
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_failback_reverse_stream
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_failback_reverse_stream
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_failback_reverse_stream
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
