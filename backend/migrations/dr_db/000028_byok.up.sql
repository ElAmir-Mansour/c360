-- =============================================================================
-- ClarioDR capability #19 — BYOK / HSM SOVEREIGN KEY CUSTODY.
--
-- Sovereignty wedge: a tenant brings/owns the MASTER key (the Key-Encryption-Key,
-- KEK) that protects their DR data, and that master key is custodied in the
-- tenant's own HSM / cloud KMS — so the platform operator cannot read tenant
-- data without the tenant-controlled key. The platform already mints per-tenant
-- DATA keys (DEKs) via internal/siem/store/crypto.DEKManager; BYOK adds a tenant
-- KEK layer ABOVE the DEKs: every DEK is envelope-wrapped under the tenant KEK,
-- and the KEK lives behind a KeyProvider (software AES-256-GCM, or HSM/KMS over
-- HTTP). The wrapped DEK bytes are useless to the operator without the KEK.
--
-- Three tenant-scoped tables persist the custody chain:
--
--   dr_tenant_kek         one KEK VERSION for a tenant: which provider custodies
--                         it, the (provider-specific) reference/material needed to
--                         drive a wrap/unwrap against that version, and its
--                         lifecycle state (active | rotating | retired). Exactly
--                         one version is active per tenant at a time; rotation
--                         introduces a new version, rewraps every DEK, then
--                         retires the old one.
--   dr_wrapped_dek        one DEK wrapped under a specific KEK version: the opaque
--                         dek_id (the DEKManager identity the platform gave it),
--                         the KEK version that wrapped it, the wrapped ciphertext
--                         and the GCM nonce. Rotation rewraps these rows from the
--                         old version to the new one.
--   dr_kek_custody_log    an append-only, HASH-CHAINED custody audit: every wrap,
--                         unwrap, enroll, rotate-begin and rotate-complete is a
--                         row whose entry_hash = sha256(prev_hash || canonical
--                         payload), giving tamper-evidence over the whole custody
--                         history (same chain discipline as the dr attestation
--                         ledger). Custody events are ALSO staged to the outbox.
--
-- All three tables carry the dr_db RLS clone (migrations/dr_db/000001_init_schema):
-- every request-path query filters by tenant AND runs under SET LOCAL
-- app.current_tenant_id, with RLS as the backstop; the app.bypass_rls escape
-- hatch is reserved for the rotation/rewrap loop, exactly as elsewhere in dr_db.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One KEK version for a tenant. provider names the custody backend:
--   software  — the bundled, fully-real AES-256-GCM envelope provider. The KEK
--               material itself is NOT stored here (the operator must not hold
--               it in plaintext at rest); reference points at the operator-side
--               keystore handle the SoftwareKeyProvider was constructed with.
--   hsm | kms — the KEK never leaves the tenant HSM/cloud KMS; reference is the
--               key handle / key ARN the HSMKeyProvider passes to the remote
--               wrap/unwrap endpoint. No key material is persisted for these.
-- state walks active -> rotating (a newer version is taking over) -> retired.
CREATE TABLE IF NOT EXISTS dr_tenant_kek (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    key_version INT NOT NULL,                    -- monotonically increasing per tenant
    provider TEXT NOT NULL DEFAULT 'software'
        CHECK (provider IN ('software','hsm','kms')),
    reference TEXT NOT NULL DEFAULT '',          -- provider-side key handle / ARN / keystore id
    state TEXT NOT NULL DEFAULT 'active'
        CHECK (state IN ('active','rotating','retired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ,                     -- when this version became the active KEK
    retired_at TIMESTAMPTZ,                       -- when this version was retired post-rewrap
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key_version)
);

CREATE INDEX IF NOT EXISTS idx_dr_tenant_kek_tenant
    ON dr_tenant_kek (tenant_id, key_version DESC);

-- At most ONE active KEK version per tenant. A partial unique index enforces the
-- "exactly one active" invariant the rotation logic depends on.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dr_tenant_kek_one_active
    ON dr_tenant_kek (tenant_id)
    WHERE state = 'active';

-- One DEK wrapped under a specific KEK version. dek_id is the opaque identity the
-- platform DEK source (DEKManager) gave the DEK; the platform never stores the
-- DEK plaintext here — only the ciphertext produced by wrapping it under the KEK,
-- plus the GCM nonce needed to unwrap. (tenant_id, dek_id) is unique: a DEK is
-- wrapped under exactly one (the current) KEK version at a time; rotation rewraps
-- the row in place to the new version.
CREATE TABLE IF NOT EXISTS dr_wrapped_dek (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    dek_id TEXT NOT NULL,                         -- DEKManager identity (e.g. index name / dek uuid)
    kek_version INT NOT NULL,                     -- the KEK version that wrapped wrapped_dek
    wrapped_dek BYTEA NOT NULL,                   -- AES-256-GCM ciphertext+tag of the DEK plaintext
    nonce BYTEA NOT NULL,                         -- 96-bit GCM nonce used for this wrap
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rewrapped_at TIMESTAMPTZ,                      -- last time this row was rewrapped to a new version
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, dek_id)
);

CREATE INDEX IF NOT EXISTS idx_dr_wrapped_dek_tenant
    ON dr_wrapped_dek (tenant_id, created_at DESC);

-- The rotation loop scans for DEKs not yet rewrapped to the newest version; this
-- index keeps that "stale version" scan cheap.
CREATE INDEX IF NOT EXISTS idx_dr_wrapped_dek_version
    ON dr_wrapped_dek (tenant_id, kek_version);

-- Append-only, hash-chained custody audit. Each row's entry_hash chains the
-- previous row's entry_hash, so any deletion or mutation of history is detectable
-- by re-walking the chain. seq is the per-tenant monotonically increasing index.
CREATE TABLE IF NOT EXISTS dr_kek_custody_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    seq BIGINT NOT NULL,                          -- per-tenant monotonic sequence (1,2,3,...)
    action TEXT NOT NULL                          -- enroll|wrap|unwrap|rotate_begin|rotate_complete|rewrap
        CHECK (action IN ('enroll','wrap','unwrap','rotate_begin','rotate_complete','rewrap')),
    kek_version INT NOT NULL,
    dek_id TEXT NOT NULL DEFAULT '',              -- the DEK acted on, when applicable
    detail TEXT NOT NULL DEFAULT '',              -- short human-readable note (never key material)
    prev_hash TEXT NOT NULL DEFAULT '',           -- previous row's entry_hash ('' for the genesis row)
    entry_hash TEXT NOT NULL,                     -- sha256(prev_hash || canonical(this row)) hex
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_dr_kek_custody_log_tenant
    ON dr_kek_custody_log (tenant_id, seq DESC);

-- --- Row level security (clone of dr_db RLS convention) ---------------------

ALTER TABLE dr_tenant_kek ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_tenant_kek FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_tenant_kek;
DROP POLICY IF EXISTS tenant_insert ON dr_tenant_kek;
DROP POLICY IF EXISTS tenant_update ON dr_tenant_kek;
DROP POLICY IF EXISTS tenant_delete ON dr_tenant_kek;
CREATE POLICY tenant_isolation ON dr_tenant_kek
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_tenant_kek
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_tenant_kek
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_tenant_kek
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE dr_wrapped_dek ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_wrapped_dek FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_wrapped_dek;
DROP POLICY IF EXISTS tenant_insert ON dr_wrapped_dek;
DROP POLICY IF EXISTS tenant_update ON dr_wrapped_dek;
DROP POLICY IF EXISTS tenant_delete ON dr_wrapped_dek;
CREATE POLICY tenant_isolation ON dr_wrapped_dek
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_wrapped_dek
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_wrapped_dek
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_wrapped_dek
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE dr_kek_custody_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_kek_custody_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_kek_custody_log;
DROP POLICY IF EXISTS tenant_insert ON dr_kek_custody_log;
DROP POLICY IF EXISTS tenant_update ON dr_kek_custody_log;
DROP POLICY IF EXISTS tenant_delete ON dr_kek_custody_log;
CREATE POLICY tenant_isolation ON dr_kek_custody_log
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_kek_custody_log
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_kek_custody_log
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_kek_custody_log
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
