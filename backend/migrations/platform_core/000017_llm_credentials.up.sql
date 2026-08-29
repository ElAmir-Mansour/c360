-- STAGE 1: Encrypted per-tenant LLM API-key credential store.
--
-- Each tenant owns ONE LLM API key (SaaS). The key is encrypted at rest with the
-- platform envelope-encryption machinery (internal/siem/store/crypto.DEKManager +
-- a self-contained SecretCrypto wrapper). The plaintext key is NEVER stored: the
-- api_key_cipher column always holds an "enc:v1:<base64url(nonce||ct||tag)>" value.
--
-- DEKManager persists its per-tenant DEK envelopes into siem.index_metadata, which
-- does not exist in platform_core. We create a compatible, idempotent copy here so
-- the credential store is self-contained and never reaches into the SIEM database.
-- (Mirror of migrations/dr_db/000003_dek_envelopes.up.sql lines 12-29.)
CREATE SCHEMA IF NOT EXISTS siem;

CREATE TABLE IF NOT EXISTS siem.index_metadata (
    index_name      TEXT PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    schema_version  TEXT NOT NULL DEFAULT 'ecs-8.11+clario-1.0',
    template_hash   TEXT NOT NULL DEFAULT 'pending',
    dek_envelope    BYTEA NOT NULL,
    dek_kek_version INT  NOT NULL DEFAULT 1,
    pii_schema_hash TEXT NOT NULL DEFAULT 'unknown',
    lifecycle_state TEXT NOT NULL DEFAULT 'hot',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_index_metadata_tenant ON siem.index_metadata (tenant_id);

-- Per-tenant LLM credential. UNIQUE(tenant_id) enforces "one credential per
-- tenant". The DEK index name used by the store is per-tenant
-- ("llm-credential-<tenant_id>") so each tenant gets its OWN row in
-- siem.index_metadata and its OWN DEK -- the index_name PRIMARY KEY there cannot
-- collide across tenants. The encrypted key, dek_ref, and kek_version are all that
-- is needed to decrypt at resolution time.
CREATE TABLE IF NOT EXISTS llm_tenant_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    provider        TEXT NOT NULL,                 -- "anthropic" | "openai" | "azure"
    model           TEXT NOT NULL DEFAULT '',      -- optional model override; '' = provider default
    api_key_cipher  TEXT NOT NULL,                 -- enc:v1:<...> from SecretCrypto; NEVER plaintext
    dek_ref         TEXT NOT NULL,                 -- "siem-tenant-{t}/llm-credential-{t}#{ver}"
    kek_version     INT  NOT NULL DEFAULT 1,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    version         BIGINT NOT NULL DEFAULT 1,     -- bumped on every write; cache-invalidation lever
    last_rotated_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_llm_tenant_credentials_tenant
    ON llm_tenant_credentials (tenant_id);

-- Row-Level Security: a tenant can only see/modify its own credential row.
-- Clones the bypass-aware convention from migrations/dr_db (app.bypass_rls for
-- the control plane, app.current_tenant_id for request-scoped access).
ALTER TABLE llm_tenant_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_tenant_credentials FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_cred_isolation ON llm_tenant_credentials;
CREATE POLICY llm_cred_isolation ON llm_tenant_credentials
    USING (current_setting('app.bypass_rls', true) = 'on'
           OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (current_setting('app.bypass_rls', true) = 'on'
           OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
