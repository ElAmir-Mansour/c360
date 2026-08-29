-- =============================================================================
-- Down: revert idp_connections SAML SP fields + secret-audit view.
-- Database: platform_core
--
-- NOTE: this does NOT decrypt client_secret back to plaintext. Encrypted values
-- (envelope prefix 'enc:idp1:') remain encrypted; rolling the app back to a build
-- WITHOUT the idp secret key wired would make those secrets unreadable, so a
-- rollback must keep the secret key available. The columns added here are dropped.
-- =============================================================================

DROP VIEW IF EXISTS idp_connections_plaintext_secret_audit;

ALTER TABLE idp_connections
    DROP COLUMN IF EXISTS sp_signing_key,
    DROP COLUMN IF EXISTS group_to_role,
    DROP COLUMN IF EXISTS name_id_format,
    DROP COLUMN IF EXISTS idp_metadata_xml;

COMMENT ON COLUMN idp_connections.client_secret IS NULL;
