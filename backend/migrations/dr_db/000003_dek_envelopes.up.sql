-- WP-4 recovery-point store: per-tenant DEK envelope persistence + legal-hold
-- tracking on recovery points.
--
-- The recovery-point store reuses the SIEM envelope-encryption machinery
-- (internal/siem/store/crypto.DEKManager): a per-(tenant, stream) Data
-- Encryption Key is generated once via Vault Transit, wrapped into an envelope,
-- and persisted so the same key decrypts every chunk sealed under that stream.
-- The DEKManager persists envelopes into a table named siem.index_metadata; we
-- create a compatible table in dr_db so the control plane is self-contained and
-- does not reach into the SIEM database.

CREATE SCHEMA IF NOT EXISTS siem;

-- Mirror of the columns DEKManager.loadEnvelope/persistEnvelope touch
-- (internal/siem/store/crypto/dek_manager.go). index_name carries the DR
-- stream id; dek_envelope is the Vault-wrapped DEK; dek_kek_version tracks the
-- KEK version so a rotation can re-seal without losing prior decryptability.
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

-- legal_hold marks the ransomware-safe floor: the newest validated recovery
-- points carry a legal-hold so they cannot be reclaimed even by a break-glass
-- s3:BypassGovernanceRetention holder until a newer validated point supersedes
-- them (DESIGN_DataStream_DR.md §5). The column mirrors the object-lock
-- legal-hold state we set on the WORM objects, so the row is a queryable index
-- of which points are held.
ALTER TABLE recovery_point
    ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT false;

-- The recovery_point immutability trigger (000002) forbids mutating sealed
-- fields but allows validation metadata to change. legal_hold must also be
-- mutable (held → released when superseded), so the trigger's allow-list does
-- not need to change — legal_hold is not in its frozen set.
