-- =============================================================================
-- Othaim PRD 14.2 — first-class Yardi property-management / real-estate connector.
--
-- Widen the lex_integration_endpoints.kind CHECK to admit the new 'yardi' kind
-- (the Yardi Voyager / Interface pull connector). The kind CHECK was last widened
-- in 000069 (adding 'custom'); recreate it explicitly so 'yardi' validates
-- alongside the existing kinds. No new table/column is needed — the Yardi
-- connection settings live inside the existing FieldCrypto-encrypted config blob.
-- =============================================================================

-- Drop-if-exists guards re-runs; the recreated list mirrors 000069 + 'yardi'.
ALTER TABLE lex_integration_endpoints
    DROP CONSTRAINT IF EXISTS lex_integration_endpoints_kind_check;
ALTER TABLE lex_integration_endpoints
    ADD CONSTRAINT lex_integration_endpoints_kind_check
    CHECK (kind IN (
        'najiz', 'hr', 'internal', 'archiving', 'email',
        'nafath_verify', 'sso', 'esign', 'custom', 'yardi'
    ));
