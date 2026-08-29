-- SIEM-01 — siem_db baseline.
--
-- The siem.health_check table is the only persisted artifact in this
-- prompt. It exists so the service can prove end-to-end DB connectivity
-- without depending on any of the real domain tables that arrive in
-- SIEM-03 onward.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS siem;

CREATE TABLE IF NOT EXISTS siem.health_check (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  siem.health_check IS 'SIEM-01 baseline table — round-trip readiness probe target. Replaced by real domain tables in SIEM-03.';
COMMENT ON COLUMN siem.health_check.tenant_id IS 'Owning tenant. Every SIEM row is tenant-isolated.';

CREATE INDEX IF NOT EXISTS health_check_tenant_idx
    ON siem.health_check (tenant_id, created_at DESC);
