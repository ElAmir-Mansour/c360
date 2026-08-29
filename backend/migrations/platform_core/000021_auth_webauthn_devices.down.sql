-- Reverse of 000021_auth_webauthn_devices.up.sql
-- Drop policies, indexes, tables (reverse FK / creation order) and the
-- idp_connections.email_domain column added by the up migration.

DROP POLICY IF EXISTS tenant_delete ON magic_link_tokens;
DROP POLICY IF EXISTS tenant_update ON magic_link_tokens;
DROP POLICY IF EXISTS tenant_insert ON magic_link_tokens;
DROP POLICY IF EXISTS tenant_isolation ON magic_link_tokens;

DROP POLICY IF EXISTS tenant_delete ON trusted_devices;
DROP POLICY IF EXISTS tenant_update ON trusted_devices;
DROP POLICY IF EXISTS tenant_insert ON trusted_devices;
DROP POLICY IF EXISTS tenant_isolation ON trusted_devices;

DROP POLICY IF EXISTS tenant_delete ON webauthn_credentials;
DROP POLICY IF EXISTS tenant_update ON webauthn_credentials;
DROP POLICY IF EXISTS tenant_insert ON webauthn_credentials;
DROP POLICY IF EXISTS tenant_isolation ON webauthn_credentials;

DROP INDEX IF EXISTS uq_idp_conn_tenant_domain;
ALTER TABLE idp_connections DROP COLUMN IF EXISTS email_domain;

DROP INDEX IF EXISTS idx_magic_links_hash;
DROP TABLE IF EXISTS magic_link_tokens;

DROP INDEX IF EXISTS idx_trusted_devices_user;
DROP TABLE IF EXISTS trusted_devices;

DROP INDEX IF EXISTS idx_webauthn_creds_user;
DROP TABLE IF EXISTS webauthn_credentials;
