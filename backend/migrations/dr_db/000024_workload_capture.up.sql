-- VM & Kubernetes workload capturers (DESIGN_DataStream_DR.md capability #15):
-- extend protected-workload coverage beyond databases/files to whole VMs and
-- Kubernetes namespaces. Both feed the EXISTING replication pipeline as
-- core.Capturer implementations that emit core.Frame batches the framestore /
-- ingest / applier path already applies.
--
-- Three tables, all in dr_db, fully tenant-scoped under the dr_db RLS
-- convention (per-operation tenant policies + the app.bypass_rls backstop for
-- the leader-singleton capture loop):
--
--   dr_workload_capture_source — a registered capture source. A source binds a
--     human-named workload (a VM disk image or a K8s namespace set) to the
--     replication stream_id it ships into, plus the source-specific config
--     (block size, binding kind for VM; api server, namespaces, kinds for K8s).
--     One source produces a sequence of capture EPOCHS over time.
--
--   dr_workload_capture_epoch — one row per capture PASS of a source. The first
--     pass is the BASE (full state); each later pass is an INCREMENTAL delta
--     carrying only what changed. Each epoch records the contiguous Frame Seq
--     range it emitted, the frame/byte/changed-unit counts, a deterministic
--     content hash of the captured set, and the source marker (snapshot wall
--     clock for VM, manifest-set hash anchor for K8s). The epoch index lets the
--     control plane reason about base vs. delta lineage and recoverable points.
--
--   dr_vm_capture_state — the persisted CHANGED-BLOCK MAP for a VM disk source:
--     the per-block content-hash bitmap of the last captured epoch plus the
--     epoch counter, so the next incremental pass reads blocks, compares hashes
--     against this map, and emits ONLY changed blocks. This is the durable CBT
--     state; it is rewritten in place each epoch (the epoch history lives in
--     dr_workload_capture_epoch).

CREATE TABLE IF NOT EXISTS dr_workload_capture_source (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    -- stream_id is the replication stream this source feeds. It is the same
    -- StreamID carried on every emitted core.Frame, so the existing framestore
    -- and ingest path key applied bytes by it. It is NOT FK-constrained here so
    -- this package owns no shared-table coupling (disjoint ownership): the
    -- replication_stream lifecycle is managed by the DR service layer.
    stream_id       UUID NOT NULL,
    -- name is an operator-facing label, unique per tenant.
    name            TEXT NOT NULL CHECK (name <> ''),
    -- source_kind selects the capturer: a VM disk (block CBT) or a K8s
    -- namespace resource set (normalized manifest snapshot).
    source_kind     TEXT NOT NULL CHECK (source_kind IN ('vm_disk','k8s_workload')),
    -- binding_kind selects WHERE the bytes/resources come from. For vm_disk:
    -- 'file' (a real image file — the tested path), 'vmware_cbt', 'libvirt'.
    -- For k8s_workload: 'rest' (the real K8s REST API), 'fixture' (tests).
    binding_kind    TEXT NOT NULL CHECK (binding_kind <> ''),
    -- block_size_bytes is the fixed CBT block size for vm_disk sources (the unit
    -- of changed-block tracking). Ignored for k8s_workload (stored 0).
    block_size_bytes INT NOT NULL DEFAULT 0 CHECK (block_size_bytes >= 0),
    -- config holds the source-specific connection/scope JSON: for vm_disk the
    -- image path; for k8s_workload the api server URL, namespaces, resource
    -- kinds and (reference, not the secret) the credential locator.
    config          JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- enabled gates whether the capture loop / run endpoint will execute it.
    enabled         BOOLEAN NOT NULL DEFAULT true,
    -- epoch_count is the number of capture passes completed; base is epoch 1.
    epoch_count     INT NOT NULL DEFAULT 0 CHECK (epoch_count >= 0),
    -- last_run_at / last_seq track the most recent pass and the highest emitted
    -- Frame Seq, so the next pass assigns Seq strictly above it.
    last_run_at     TIMESTAMPTZ,
    last_seq        BIGINT NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_dr_workload_capture_source_stream
    ON dr_workload_capture_source (tenant_id, stream_id);
CREATE INDEX IF NOT EXISTS idx_dr_workload_capture_source_enabled
    ON dr_workload_capture_source (tenant_id, enabled)
    WHERE enabled = true;

CREATE TABLE IF NOT EXISTS dr_workload_capture_epoch (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    source_id       UUID NOT NULL REFERENCES dr_workload_capture_source(id) ON DELETE CASCADE,
    stream_id       UUID NOT NULL,
    -- epoch is monotonic per source; epoch 1 is the BASE (full) capture.
    epoch           INT NOT NULL CHECK (epoch > 0),
    -- epoch_kind classifies the pass: the first is 'base', the rest 'incremental'.
    epoch_kind      TEXT NOT NULL CHECK (epoch_kind IN ('base','incremental')),
    -- The contiguous Frame Seq range this epoch emitted (inclusive). from_seq is
    -- the first frame's Seq, to_seq the last. An epoch that found no change emits
    -- only a trailing MARKER, so frame_count >= 1 always.
    from_seq        BIGINT NOT NULL CHECK (from_seq > 0),
    to_seq          BIGINT NOT NULL CHECK (to_seq >= from_seq),
    frame_count     INT NOT NULL CHECK (frame_count > 0),
    -- changed_units is the domain delta: changed BLOCKS for vm_disk, changed
    -- RESOURCES for k8s_workload (0 on a no-change incremental pass).
    changed_units   INT NOT NULL DEFAULT 0 CHECK (changed_units >= 0),
    -- total_units is the full unit count of the captured set (all blocks / all
    -- resources) so a delta ratio is computable.
    total_units     INT NOT NULL DEFAULT 0 CHECK (total_units >= 0),
    payload_bytes   BIGINT NOT NULL DEFAULT 0 CHECK (payload_bytes >= 0),
    -- content_hash is a deterministic SHA-256 over the captured set: the full
    -- block-hash map for vm_disk, the normalized manifest-set hash for
    -- k8s_workload. Identical workload state across two passes yields the same
    -- hash, which is how a no-change pass is proven.
    content_hash    TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    -- source_marker pins the consistency point (VM snapshot wall clock / K8s
    -- manifest-set anchor) carried on the epoch's trailing MARKER frame.
    source_marker   TEXT NOT NULL DEFAULT '',
    -- set_summary is, for k8s_workload epochs, the ordered per-resource header
    -- map [{kind,namespace,name,hash,data_ref}, ...] of the captured set (no
    -- manifest bytes). The next incremental pass diffs the freshly-normalized
    -- set against this summary to count exactly the changed resources (the K8s
    -- analogue of the VM changed-block map). Empty array for vm_disk epochs.
    set_summary     JSONB NOT NULL DEFAULT '[]'::jsonb,
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, source_id, epoch)
);

CREATE INDEX IF NOT EXISTS idx_dr_workload_capture_epoch_source
    ON dr_workload_capture_epoch (tenant_id, source_id, epoch);
CREATE INDEX IF NOT EXISTS idx_dr_workload_capture_epoch_stream
    ON dr_workload_capture_epoch (tenant_id, stream_id, to_seq);

CREATE TABLE IF NOT EXISTS dr_vm_capture_state (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    source_id       UUID NOT NULL REFERENCES dr_workload_capture_source(id) ON DELETE CASCADE,
    -- block_size_bytes and image_bytes describe the geometry the block map was
    -- computed against; a geometry change (resize) forces a full re-base.
    block_size_bytes INT NOT NULL CHECK (block_size_bytes > 0),
    image_bytes     BIGINT NOT NULL DEFAULT 0 CHECK (image_bytes >= 0),
    block_count     INT NOT NULL DEFAULT 0 CHECK (block_count >= 0),
    -- epoch is the epoch number this map reflects (matches the source's latest
    -- dr_workload_capture_epoch.epoch).
    epoch           INT NOT NULL DEFAULT 0 CHECK (epoch >= 0),
    -- block_hashes is the changed-block map: an ordered JSON array of per-block
    -- hex SHA-256 content hashes, index == block index. The next incremental
    -- pass compares freshly-read block hashes against this array and emits only
    -- the blocks whose hash differs (or that are newly present).
    block_hashes    JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- exactly one CBT state row per source.
    UNIQUE (source_id)
);

CREATE INDEX IF NOT EXISTS idx_dr_vm_capture_state_tenant
    ON dr_vm_capture_state (tenant_id, source_id);

-- Row Level Security: per-operation tenant policies + the app.bypass_rls
-- backstop for the leader-singleton capture loop, matching the dr_db
-- convention (000011_cdp_journal et al.).

ALTER TABLE dr_workload_capture_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_workload_capture_source FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_workload_capture_source;
DROP POLICY IF EXISTS tenant_insert ON dr_workload_capture_source;
DROP POLICY IF EXISTS tenant_update ON dr_workload_capture_source;
DROP POLICY IF EXISTS tenant_delete ON dr_workload_capture_source;

CREATE POLICY tenant_isolation ON dr_workload_capture_source
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_workload_capture_source
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_workload_capture_source
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_workload_capture_source
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE dr_workload_capture_epoch ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_workload_capture_epoch FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_workload_capture_epoch;
DROP POLICY IF EXISTS tenant_insert ON dr_workload_capture_epoch;
DROP POLICY IF EXISTS tenant_update ON dr_workload_capture_epoch;
DROP POLICY IF EXISTS tenant_delete ON dr_workload_capture_epoch;

CREATE POLICY tenant_isolation ON dr_workload_capture_epoch
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_workload_capture_epoch
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_workload_capture_epoch
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_workload_capture_epoch
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE dr_vm_capture_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_vm_capture_state FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_vm_capture_state;
DROP POLICY IF EXISTS tenant_insert ON dr_vm_capture_state;
DROP POLICY IF EXISTS tenant_update ON dr_vm_capture_state;
DROP POLICY IF EXISTS tenant_delete ON dr_vm_capture_state;

CREATE POLICY tenant_isolation ON dr_vm_capture_state
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_vm_capture_state
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_vm_capture_state
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_vm_capture_state
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
