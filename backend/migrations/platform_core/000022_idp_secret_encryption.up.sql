-- =============================================================================
-- Clario 360 — Encrypt idp_connections.client_secret at rest + SAML SP fields
-- Database: platform_core
-- Staged (NOT yet numbered): the integrator renames this to the next sequential
-- platform_core migration number (currently 000022_*) at wiring time.
--
-- WHY (NCA/PDPL): idp_connections.client_secret was stored PLAINTEXT — a real
-- credential-at-rest gap. The repository (internal/iam/repository/idp_repo.go)
-- now FieldCrypto-encrypts client_secret on write (envelope prefix 'enc:idp1:')
-- and decrypts on read; values WITHOUT the prefix are treated as legacy plaintext
-- so reads keep working DURING the rollout (no token-exchange downtime).
--
-- RE-ENCRYPTION OF EXISTING ROWS. The AES-256 key lives in the IAM SERVICE
-- (pkg/crypto), NOT in Postgres, so the backfill of existing plaintext secrets
-- into ciphertext is performed by a one-shot APPLICATION job AFTER this migration:
--
--     -- pseudo (run once, in-process, with the wired idp secret key):
--     for each row in idp_connections where client_secret NOT LIKE 'enc:idp1:%':
--         repo.UpsertConnection(ctx, decrypted_then_reencrypted_row)
--
-- Because decryptSecret() passes legacy plaintext through unchanged and
-- encryptSecret() is idempotent on already-prefixed values, the system is correct
-- whether or not the backfill has run yet — so this migration is safe to deploy
-- ahead of the backfill (forward-compatible) and the backfill can run lazily.
-- This is the "coordinate to avoid token-exchange downtime" requirement.
-- =============================================================================

-- 1. SAML SP fields ----------------------------------------------------------
-- idp_metadata_xml: alias/companion to the existing saml_metadata_xml column,
--   added per spec; populated from saml_metadata_xml when present so both names
--   resolve. (saml_metadata_xml is retained for backward compatibility.)
ALTER TABLE idp_connections
    ADD COLUMN IF NOT EXISTS idp_metadata_xml TEXT,
    ADD COLUMN IF NOT EXISTS name_id_format   TEXT NOT NULL DEFAULT
        'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
    -- group_to_role maps IdP group/attribute values to platform role slugs, as a
    -- JSON object e.g. {"Watheeq-Admins":"admin","Legal-Viewers":"viewer"}.
    ADD COLUMN IF NOT EXISTS group_to_role    JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- sp_signing_key is the SP's PRIVATE key used to sign AuthnRequests; it is a
    -- SECRET and MUST be stored encrypted (envelope prefix 'enc:idp1:'), exactly
    -- like client_secret. The application encrypts it on write.
    ADD COLUMN IF NOT EXISTS sp_signing_key   TEXT;

COMMENT ON COLUMN idp_connections.idp_metadata_xml IS
    'SAML IdP metadata XML (companion to saml_metadata_xml)';
COMMENT ON COLUMN idp_connections.name_id_format IS
    'SAML NameID format requested/expected from the IdP';
COMMENT ON COLUMN idp_connections.group_to_role IS
    'JSON map of IdP group/attribute value -> platform role slug (SAML/OIDC group mapping)';
COMMENT ON COLUMN idp_connections.sp_signing_key IS
    'SP private signing key (SECRET). Encrypted at rest with envelope prefix enc:idp1:';
COMMENT ON COLUMN idp_connections.client_secret IS
    'OIDC/OAuth2 client secret (SECRET). Encrypted at rest with envelope prefix enc:idp1: by the IAM service; legacy plaintext is read transparently until the app backfill re-encrypts it.';

-- Backfill idp_metadata_xml from the legacy column so both names resolve.
UPDATE idp_connections
   SET idp_metadata_xml = saml_metadata_xml
 WHERE idp_metadata_xml IS NULL
   AND saml_metadata_xml IS NOT NULL
   AND saml_metadata_xml <> '';

-- 2. Re-encryption audit guard ----------------------------------------------
-- A diagnostic VIEW so operators can confirm the application backfill has
-- re-encrypted every secret (zero rows == done). It NEVER exposes secret
-- material — only the encryption state.
CREATE OR REPLACE VIEW idp_connections_plaintext_secret_audit AS
    SELECT id, tenant_id, provider,
           (client_secret IS NOT NULL AND client_secret <> ''
              AND client_secret NOT LIKE 'enc:idp1:%') AS client_secret_plaintext,
           (sp_signing_key IS NOT NULL AND sp_signing_key <> ''
              AND sp_signing_key NOT LIKE 'enc:idp1:%') AS sp_signing_key_plaintext
      FROM idp_connections
     WHERE (client_secret IS NOT NULL AND client_secret <> ''
              AND client_secret NOT LIKE 'enc:idp1:%')
        OR (sp_signing_key IS NOT NULL AND sp_signing_key <> ''
              AND sp_signing_key NOT LIKE 'enc:idp1:%');

COMMENT ON VIEW idp_connections_plaintext_secret_audit IS
    'Rows whose client_secret/sp_signing_key are still PLAINTEXT (awaiting app re-encryption backfill). Zero rows == fully encrypted. Exposes no secret values.';
