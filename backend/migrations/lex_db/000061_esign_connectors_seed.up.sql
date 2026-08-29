-- =============================================================================
-- Lex Integration Platform (Phase 2) — e-signature connector seed.
--
-- Registers per-PROVIDER e-signature connector records in
-- lex_integration_endpoints (kind='esign'), replacing reliance on the env-gated
-- LEX_SIGNATURE_PROVIDER_* block: each provider becomes a first-class registry
-- endpoint with its own status, Test Connection, and honest Health, configured
-- through the dynamic console form (schema.go IntegrationKindEsign) rather than
-- process env.
--
-- HONEST STATUS (NEVER fake-healthy):
--   * native  -> 'active'  : deterministic local signing needs NO external
--                            transport or secret, so it is ready out of the box.
--   * docusign/adobe (self-serve commercial) -> 'planned' : an operator supplies
--                            base_url + account_id + client_secret/private_key and
--                            activates; the connector grades not-reachable until
--                            a transport credential is configured.
--   * najiz / emdha (gov-gated) -> 'planned' : ship configurable + sandbox-mock;
--                            the connector grades not_configured until real MOJ /
--                            emdha-TSP credentials land — it NEVER reports healthy
--                            while unconfigured.
--
-- SECRET CUSTODY. The seeded config carries ONLY non-secret routing hints
-- (provider_kind / mode / signer_id_proofing / default_signature_level). It holds
-- NO base_url for the gov rails (those are configured per deployment region — the
-- connector never hardcodes a gov path) and NO credentials. config_encrypted is
-- stored as PLAINTEXT JSON with config_encrypted_flag=false: the repo's
-- decodeConfig reads non-enveloped text as plaintext even when FieldCrypto is
-- wired, and any secret an operator later adds is re-encrypted on Update.
--
-- Seeded for ALL tenants (loop over tenants), ON CONFLICT DO NOTHING so a re-run
-- and the existing 000032 default-endpoint seed never collide.
--
-- Staged in _staging/ until the integrator assigns the next free migration number
-- Numbered 000061 by integrator. No DDL — pure
-- idempotent seed against the existing table.
-- =============================================================================

INSERT INTO lex_integration_endpoints (
    tenant_id, kind, code, name, description, status,
    config_encrypted, config_encrypted_flag, created_by
)
SELECT t.id, 'esign', k.code, k.name, k.description, k.status,
       k.config, false,
       '00000000-0000-0000-0000-000000000001'::uuid
FROM tenants t
CROSS JOIN (
    VALUES
        ('esign_native',
         'Native e-Signature',
         'Deterministic in-platform signing (no external provider)',
         'active',
         '{"provider":"native","provider_kind":"native","mode":"deterministic","signer_id_proofing":"none","default_signature_level":"basic"}'),
        ('esign_docusign',
         'DocuSign',
         'DocuSign envelopes via OAuth/JWT (configure base_url + account_id + credentials)',
         'planned',
         '{"provider":"docusign","provider_kind":"external","mode":"docusign","signer_id_proofing":"none","default_signature_level":"advanced"}'),
        ('esign_adobe',
         'Adobe Acrobat Sign',
         'Adobe Acrobat Sign agreements via OAuth (configure base_url + credentials)',
         'planned',
         '{"provider":"adobe","provider_kind":"external","mode":"adobe","signer_id_proofing":"none","default_signature_level":"advanced"}'),
        ('esign_najiz',
         'Najiz (MoJ) e-Signature',
         'Saudi MoJ Najiz signing portal — gov-gated, sandbox-mock until MOJ credentials land',
         'planned',
         '{"provider":"native","provider_kind":"najiz","mode":"najiz","signer_id_proofing":"nafath","default_signature_level":"qualified"}'),
        ('esign_emdha',
         'emdha (TSP) Qualified Signature',
         'emdha trust service provider qualified signature paired with Nafath identity proofing — gov-gated, sandbox-mock until credentials land',
         'planned',
         '{"provider":"emdha","provider_kind":"nafath","mode":"emdha","signer_id_proofing":"nafath","default_signature_level":"qualified"}')
) AS k(code, name, description, status, config)
ON CONFLICT (tenant_id, code) WHERE deleted_at IS NULL DO NOTHING;
