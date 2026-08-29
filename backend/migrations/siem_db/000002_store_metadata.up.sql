-- SIEM-02 — store metadata.
--
-- Tracks every SIEM index, its DEK envelope, schema version, and lifecycle
-- state. All retention/encryption metadata lives here; the OpenSearch
-- indices themselves only carry pointers into this table.

CREATE TABLE IF NOT EXISTS siem.index_metadata (
    index_name        TEXT          PRIMARY KEY,
    tenant_id         UUID          NOT NULL,
    schema_version    TEXT          NOT NULL,
    template_hash     CHAR(64)      NOT NULL,
    dek_envelope      BYTEA         NOT NULL,
    dek_kek_version   INTEGER       NOT NULL,
    pii_schema_hash   CHAR(64)      NOT NULL,
    lifecycle_state   TEXT          NOT NULL DEFAULT 'hot'
                      CHECK (lifecycle_state IN ('hot','warm','cold','deleted')),
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    rolled_at         TIMESTAMPTZ,
    frozen_at         TIMESTAMPTZ,
    sealed_at         TIMESTAMPTZ,
    sealed_object_key TEXT,
    sealed_sha256     CHAR(64),
    retain_until      TIMESTAMPTZ
);

COMMENT ON TABLE  siem.index_metadata IS
    'SIEM-02 store metadata — one row per OpenSearch index. Envelope-encrypted DEK,
     schema version, PII schema hash, and lifecycle pointers are tracked here.';
COMMENT ON COLUMN siem.index_metadata.dek_envelope IS
    'Vault Transit ciphertext envelope (vault:vN:<base64>) wrapping the per-index DEK.';
COMMENT ON COLUMN siem.index_metadata.dek_kek_version IS
    'KEK version embedded in dek_envelope; used to detect KEK rotation needs.';
COMMENT ON COLUMN siem.index_metadata.pii_schema_hash IS
    'SHA-256 of the active pii-fields.yaml at index-creation time. Mismatch triggers re-shard.';
COMMENT ON COLUMN siem.index_metadata.lifecycle_state IS
    'hot=active writes, warm=read-only on OS, cold=sealed to object store, deleted=tombstone.';

CREATE INDEX IF NOT EXISTS index_metadata_tenant_state_idx
    ON siem.index_metadata (tenant_id, lifecycle_state, created_at DESC);

CREATE TABLE IF NOT EXISTS siem.tenant_store_status (
    tenant_id            UUID          PRIMARY KEY,
    template_ensured_at  TIMESTAMPTZ,
    kek_ensured_at       TIMESTAMPTZ,
    last_health_at       TIMESTAMPTZ,
    notes                JSONB         NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE siem.tenant_store_status IS
    'Per-tenant readiness ledger — has the index template been ensured, has the KEK been ensured,
     when did the last health probe succeed. Used by the SIEM bootstrap to skip already-good tenants.';
