-- =============================================================================
-- ClarioDR capability #17 — SAN/NAS STORAGE OFFLOAD.
--
-- For large estates, copying every byte through the ClarioDR host (host-based
-- copy) is wasteful: the storage array itself can take snapshots and replicate
-- them far more efficiently. This capability lets ClarioDR ORCHESTRATE and
-- CATALOG array-assisted (or file/loopback) snapshots + replication rather than
-- copy through the host. The array does the heavy lifting; ClarioDR records the
-- snapshot lineage (parent chain for incrementals), size, manifest hash, state,
-- and replication outcome, and drives retention/expiry by policy.
--
-- Two tenant-scoped tables persist the catalog:
--
--   dr_storage_volume    one registered SAN block / NAS file volume on a storage
--                        array (or a file/loopback volume on a local path),
--                        with the provider kind, array endpoint, retention
--                        policy, and the source location to snapshot.
--   dr_storage_snapshot  one offloaded snapshot of a volume, with its array-side
--                        handle, parent snapshot (for incremental chains), the
--                        manifest content hash + byte size the provider reported,
--                        its orchestration state, and — once replicated — the DR
--                        target it was shipped to.
--
-- Both tables carry the dr_db RLS clone (migrations/dr_db/000001_init_schema):
-- every request-path query filters by tenant AND runs under SET LOCAL
-- app.current_tenant_id, with RLS as the backstop; the app.bypass_rls escape
-- hatch is reserved for the background poll/retention loop, exactly as elsewhere
-- in dr_db.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One registered storage volume to offload. provider names the backing
-- implementation (file | netapp_ontap | dell_powerstore | nfs); for the
-- file/loopback provider source_location is the on-disk volume directory the
-- provider snapshots and array_endpoint is the snapshot root.
CREATE TABLE IF NOT EXISTS dr_storage_volume (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,                          -- operator-facing volume name (unique per tenant)
    provider TEXT NOT NULL DEFAULT 'file'
        CHECK (provider IN ('file','netapp_ontap','dell_powerstore','nfs')),
    array_endpoint TEXT NOT NULL DEFAULT '',     -- array mgmt endpoint / snapshot root
    source_location TEXT NOT NULL,               -- LUN / export / on-disk volume path to snapshot
    site_id UUID,                                -- optional protected_site this volume belongs to
    retention_max_snapshots INT NOT NULL DEFAULT 7
        CHECK (retention_max_snapshots >= 0),    -- keep at most N newest snapshots (0 = unlimited)
    retention_max_age_seconds BIGINT NOT NULL DEFAULT 0
        CHECK (retention_max_age_seconds >= 0),  -- expire snapshots older than this (0 = no age limit)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_dr_storage_volume_tenant
    ON dr_storage_volume (tenant_id, created_at DESC);

-- One offloaded snapshot of a volume. state walks
-- PENDING -> CREATING -> READY (-> REPLICATING -> REPLICATED) and EXPIRED, with
-- FAILED reachable from any non-terminal state. parent_id links an incremental
-- snapshot to the snapshot it was diffed against (NULL for a full/base snapshot);
-- retention must never expire a snapshot that is still a parent of a live child.
CREATE TABLE IF NOT EXISTS dr_storage_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    volume_id UUID NOT NULL REFERENCES dr_storage_volume(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES dr_storage_snapshot(id) ON DELETE SET NULL,
    provider_handle TEXT NOT NULL DEFAULT '',    -- array-side snapshot id / on-disk snapshot dir
    kind TEXT NOT NULL DEFAULT 'full'
        CHECK (kind IN ('full','incremental')),
    state TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (state IN ('PENDING','CREATING','READY','REPLICATING','REPLICATED','EXPIRED','FAILED')),
    manifest_hash TEXT NOT NULL DEFAULT '',      -- sha256 over the snapshot manifest (tamper-evidence)
    size_bytes BIGINT NOT NULL DEFAULT 0,        -- logical size the provider reported
    changed_bytes BIGINT NOT NULL DEFAULT 0,     -- bytes actually copied (incremental delta accounting)
    file_count INT NOT NULL DEFAULT 0,           -- files captured in the manifest
    replicated_target TEXT,                      -- DR target location once REPLICATED
    last_error TEXT,                             -- populated when state = FAILED
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ready_at TIMESTAMPTZ,                        -- when the array reported the snapshot complete
    replicated_at TIMESTAMPTZ,                   -- when replication to the DR target completed
    expired_at TIMESTAMPTZ,                      -- when retention expired/deleted it
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_storage_snapshot_tenant_volume
    ON dr_storage_snapshot (tenant_id, volume_id, created_at DESC);

-- The poll/retention loop claims snapshots still being created or replicated
-- across tenants; this partial index keeps that scan cheap (terminal states are
-- excluded).
CREATE INDEX IF NOT EXISTS idx_dr_storage_snapshot_active
    ON dr_storage_snapshot (state)
    WHERE state IN ('PENDING','CREATING','REPLICATING');

-- Retention must keep a snapshot that is still the parent of a non-expired
-- child; this index supports the "is referenced as a live parent" lookup.
CREATE INDEX IF NOT EXISTS idx_dr_storage_snapshot_parent
    ON dr_storage_snapshot (parent_id)
    WHERE parent_id IS NOT NULL;

-- --- Row level security (clone of dr_db RLS convention) ---------------------

ALTER TABLE dr_storage_volume ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_storage_volume FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_storage_volume;
DROP POLICY IF EXISTS tenant_insert ON dr_storage_volume;
DROP POLICY IF EXISTS tenant_update ON dr_storage_volume;
DROP POLICY IF EXISTS tenant_delete ON dr_storage_volume;
CREATE POLICY tenant_isolation ON dr_storage_volume
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_storage_volume
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_storage_volume
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_storage_volume
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE dr_storage_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_storage_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_storage_snapshot;
DROP POLICY IF EXISTS tenant_insert ON dr_storage_snapshot;
DROP POLICY IF EXISTS tenant_update ON dr_storage_snapshot;
DROP POLICY IF EXISTS tenant_delete ON dr_storage_snapshot;
CREATE POLICY tenant_isolation ON dr_storage_snapshot
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_storage_snapshot
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_storage_snapshot
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_storage_snapshot
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
