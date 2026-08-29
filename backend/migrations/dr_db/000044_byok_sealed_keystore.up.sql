-- =============================================================================
-- ClarioDR capability #19 (continued) — SEALED, PERSISTENT SOFTWARE KEY CUSTODY.
--
-- The bundled software BYOK factory (internal/dr/byok/factory.go
-- MemoryProviderFactory) held minted tenant KEKs in a process-local map. A process
-- restart empties that map and ORPHANS every wrapped DEK — a headline sovereignty
-- gap. The SealedProviderFactory (internal/dr/byok/sealed_provider.go) closes it:
-- every freshly minted 32-byte tenant KEK is envelope-encrypted (AES-256-GCM) under
-- an operator-supplied ROOT key and PERSISTED here as a sealed blob. On restart a
-- new factory over the same root key + these rows recovers every KEK, so no wrapped
-- DEK is orphaned.
--
--   dr_sealed_kek   one sealed tenant KEK: reference is the opaque handle stored in
--                   dr_tenant_kek.reference (the Service passes it back on unwrap so
--                   the factory loads and unseals this exact row); sealed_kek is
--                   nonce||ciphertext||tag of the tenant KEK under the root key
--                   (USELESS to the database operator without the root key);
--                   root_key_id identifies WHICH operator root key sealed it (so a
--                   root rotation can still identify legacy rows).
--
-- The table carries the dr_db RLS clone (migrations/dr_db/000001_init_schema,
-- matching 000028_byok): every request-path query filters by tenant AND runs under
-- SET LOCAL app.current_tenant_id, with RLS as the backstop; app.bypass_rls is the
-- reserved system-path escape hatch, exactly as elsewhere in dr_db.
-- =============================================================================

CREATE TABLE IF NOT EXISTS dr_sealed_kek (
    reference TEXT PRIMARY KEY,                   -- opaque handle == dr_tenant_kek.reference
    tenant_id UUID NOT NULL,
    sealed_kek BYTEA NOT NULL,                    -- AES-256-GCM nonce||ciphertext||tag of the tenant KEK under the ROOT key
    root_key_id TEXT NOT NULL,                    -- non-secret label of the operator root key that sealed this blob
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_sealed_kek_tenant
    ON dr_sealed_kek (tenant_id, created_at DESC);

-- --- Row level security (clone of dr_db RLS convention, matching 000028_byok) ---

ALTER TABLE dr_sealed_kek ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_sealed_kek FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_sealed_kek;
DROP POLICY IF EXISTS tenant_insert ON dr_sealed_kek;
DROP POLICY IF EXISTS tenant_update ON dr_sealed_kek;
DROP POLICY IF EXISTS tenant_delete ON dr_sealed_kek;
CREATE POLICY tenant_isolation ON dr_sealed_kek
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_sealed_kek
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_sealed_kek
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_sealed_kek
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
