-- SIEM-03 — sources, credentials, EPS samples, cert revocations, enrollment tokens.
--
-- This migration is the registry-of-truth for every log source that will ever
-- feed the SIEM. The shape of these tables is fixed at acceptance and may only
-- be ADDED to in subsequent migrations — never renamed or removed (the registry
-- is itself audit evidence).
--
-- Idempotency: every CREATE uses IF NOT EXISTS / DO $$ EXCEPTION guards so the
-- migration is safe to re-apply.

-- Lifecycle states
DO $$ BEGIN
  CREATE TYPE siem.source_status AS ENUM (
    'provisioning',  -- created, awaiting enrollment
    'active',        -- enrolled, sending
    'silent',        -- enrolled but EPS deviating below baseline
    'disabled',      -- admin disabled; events rejected at ingestion
    'rotating',      -- cert rotation in flight
    'error'          -- terminal; admin intervention required
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Transport modes
DO $$ BEGIN
  CREATE TYPE siem.source_transport AS ENUM (
    'syslog_udp','syslog_tcp_tls','cef_syslog','leef_syslog',
    'win_event_wec','json_https','kafka','file_tail',
    'cloudtrail_sqs','gcp_pubsub','azure_eventhub','m365_graph',
    'gworkspace_reports','okta_system_log','nibss_iaf','swift_audit',
    't24_export','finacle_export','flexcube_export','postilion_log',
    'iso8583','rtgs_audit','pg_audit','oracle_audit','mssql_audit',
    'k8s_audit','netflow','zeek_json','suricata_json'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS siem.sources (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID            NOT NULL,
  name                TEXT            NOT NULL
                      CHECK (name ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  type                TEXT            NOT NULL,                -- functional category (e.g. "firewall", "cloud_audit")
  transport           siem.source_transport NOT NULL,
  address             TEXT            NOT NULL,                -- host:port | URL | file path; format depends on transport
  expected_eps        INTEGER         NOT NULL DEFAULT 0
                      CHECK (expected_eps >= 0 AND expected_eps <= 1000000),
  baseline_eps        INTEGER         NOT NULL DEFAULT 0,      -- EWMA, computed by detector
  baseline_samples    INTEGER         NOT NULL DEFAULT 0,      -- number of samples behind baseline
  tz                  TEXT            NOT NULL DEFAULT 'Africa/Lagos',
  parser_id           UUID            NULL,                    -- forward ref; FK added in SIEM-04
  status              siem.source_status NOT NULL DEFAULT 'provisioning',
  last_seen_at        TIMESTAMPTZ     NULL,
  last_health_at      TIMESTAMPTZ     NULL,
  mtls_thumbprint     CHAR(64)        NULL,                    -- SHA-256 hex of leaf DER
  cert_serial         TEXT            NULL,
  cert_issued_at      TIMESTAMPTZ     NULL,
  cert_expires_at     TIMESTAMPTZ     NULL,
  cert_revoked_at     TIMESTAMPTZ     NULL,
  cert_revoked_reason TEXT            NULL,
  tags                JSONB           NOT NULL DEFAULT '{}'::jsonb,
  version             BIGINT          NOT NULL DEFAULT 1,      -- optimistic concurrency
  created_by          UUID            NOT NULL,                -- user id from JWT
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ     NULL,                    -- soft delete

  CONSTRAINT sources_tenant_name_unique UNIQUE (tenant_id, name) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT sources_thumbprint_unique  UNIQUE (mtls_thumbprint)
);

CREATE INDEX IF NOT EXISTS sources_tenant_status_idx
  ON siem.sources (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sources_tenant_lastseen_idx
  ON siem.sources (tenant_id, last_seen_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sources_thumbprint_active_idx
  ON siem.sources (mtls_thumbprint) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sources_cert_expiry_idx
  ON siem.sources (cert_expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS sources_tags_gin_idx
  ON siem.sources USING gin (tags);

-- Vault secret references (private key paths)
CREATE TABLE IF NOT EXISTS siem.source_credentials (
  source_id           UUID            PRIMARY KEY REFERENCES siem.sources(id) ON DELETE RESTRICT,
  vault_pki_mount     TEXT            NOT NULL,                -- e.g. pki-siem-intermediate-{tenant_id}
  vault_key_ref       TEXT            NOT NULL,                -- transit-encrypted private key blob OR vault kv path
  cert_pem            TEXT            NOT NULL,                -- public leaf cert
  ca_chain_pem        TEXT            NOT NULL,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  rotated_at          TIMESTAMPTZ     NULL
);

-- Rolling EPS samples (collectors push; detector reads)
CREATE TABLE IF NOT EXISTS siem.source_eps_samples (
  source_id           UUID            NOT NULL REFERENCES siem.sources(id) ON DELETE CASCADE,
  ts                  TIMESTAMPTZ     NOT NULL,
  eps_1min            INTEGER         NOT NULL,
  eps_5min            INTEGER         NOT NULL,
  parser_errors_1min  INTEGER         NOT NULL DEFAULT 0,
  dropped_1min        INTEGER         NOT NULL DEFAULT 0,
  queue_depth         INTEGER         NOT NULL DEFAULT 0,
  collector_version   TEXT            NULL,
  PRIMARY KEY (source_id, ts)
);
CREATE INDEX IF NOT EXISTS eps_samples_recent_idx
  ON siem.source_eps_samples (source_id, ts DESC);

-- Revoked cert ledger (used by mTLS middleware for fast denial)
CREATE TABLE IF NOT EXISTS siem.source_cert_revocations (
  thumbprint          CHAR(64)        PRIMARY KEY,
  source_id           UUID            NOT NULL,
  cert_serial         TEXT            NOT NULL,
  revoked_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  reason              TEXT            NOT NULL
);

-- Enrollment-token replay registry (Redis is primary, this is the durable backstop)
CREATE TABLE IF NOT EXISTS siem.enrollment_tokens (
  jti                 UUID            PRIMARY KEY,
  source_id           UUID            NOT NULL REFERENCES siem.sources(id) ON DELETE CASCADE,
  tenant_id           UUID            NOT NULL,
  purpose             TEXT            NOT NULL                  -- 'enroll' | 'rotate'
                      CHECK (purpose IN ('enroll','rotate')),
  issued_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ     NOT NULL,
  consumed_at         TIMESTAMPTZ     NULL,
  consumed_from_ip    INET            NULL,
  issued_by           UUID            NOT NULL
);
CREATE INDEX IF NOT EXISTS enrollment_tokens_expiry_idx
  ON siem.enrollment_tokens (expires_at) WHERE consumed_at IS NULL;

-- updated_at maintenance + version bump on UPDATE
CREATE OR REPLACE FUNCTION siem.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); NEW.version = OLD.version + 1; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sources_touch ON siem.sources;
CREATE TRIGGER sources_touch BEFORE UPDATE ON siem.sources
  FOR EACH ROW EXECUTE FUNCTION siem.touch_updated_at();
