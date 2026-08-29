-- =============================================================================
-- ClarioDR — EXTERNAL INTEGRATIONS CATALOG.
--
-- ClarioDR drives recovery against external systems: hypervisors (vSphere,
-- libvirt), storage arrays (NetApp ONTAP, Dell PowerStore, plain NFS), cloud
-- vaults (AWS Backup), and Kubernetes clusters. Each one needs a tenant-scoped
-- record of WHERE it lives (endpoint) and HOW to authenticate to it
-- (credentials). This table is that registry: the DR factories resolve the
-- active integration for a (tenant, vendor) at request time and the connector
-- adapters in the cmd/ bridge test live connectivity.
--
-- Credentials are NEVER stored in plaintext. The service JSON-marshals the
-- decrypted Config bundle and AES-256-GCM seals it before insert; the sealed
-- ciphertext (which carries its own 96-bit nonce prefix) lands in
-- encrypted_credentials. They are only opened inside TestConnection and
-- ResolveActive, and are never serialized to an API response or a log line.
--
-- This table carries the dr_db RLS clone (migrations/dr_db/000026_storage_offload):
-- every request-path query filters by tenant AND runs under SET LOCAL
-- app.current_tenant_id, with RLS as the backstop; the app.bypass_rls escape
-- hatch is reserved for any cross-tenant system path, exactly as elsewhere in
-- dr_db.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One registered external DR integration. kind is the broad capability class;
-- vendor names the concrete backing implementation a connector adapter is
-- registered for (e.g. netapp_ontap, vmware_vsphere, aws_backup). status tracks
-- the last connectivity test outcome; enabled gates whether ResolveActive will
-- pick it for a (tenant, vendor).
CREATE TABLE IF NOT EXISTS dr_integration (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,                          -- operator-facing name (unique per tenant)
    kind TEXT NOT NULL
        CHECK (kind IN ('hypervisor','storage_array','cloud_vault','kubernetes')),
    vendor TEXT NOT NULL,                         -- concrete backing vendor a connector is registered for
    endpoint TEXT NOT NULL DEFAULT '',            -- management endpoint / base URL
    status TEXT NOT NULL DEFAULT 'configured'
        CHECK (status IN ('configured','active','error','untested')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    encrypted_credentials BYTEA NOT NULL,         -- AES-256-GCM ciphertext of the JSON Config bundle (nonce-prefixed)
    last_tested_at TIMESTAMPTZ,                   -- when TestConnection last ran
    last_test_error TEXT NOT NULL DEFAULT '',     -- populated when status = error
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_dr_integration_tenant
    ON dr_integration (tenant_id, created_at DESC);

-- ResolveActive picks the newest enabled+active integration for a (tenant,
-- vendor); this index keeps that lookup cheap.
CREATE INDEX IF NOT EXISTS idx_dr_integration_resolve
    ON dr_integration (tenant_id, vendor, created_at DESC)
    WHERE enabled AND status = 'active';

-- --- Row level security (clone of dr_db RLS convention) ---------------------

ALTER TABLE dr_integration ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_integration FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_integration;
DROP POLICY IF EXISTS tenant_insert ON dr_integration;
DROP POLICY IF EXISTS tenant_update ON dr_integration;
DROP POLICY IF EXISTS tenant_delete ON dr_integration;
CREATE POLICY tenant_isolation ON dr_integration
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_integration
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_integration
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_integration
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
