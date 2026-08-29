-- Revert the kind CHECK to the 000069 list (drop 'yardi'). Any 'yardi' rows must be
-- removed before this down-migration can re-add the narrower constraint.
ALTER TABLE lex_integration_endpoints
    DROP CONSTRAINT IF EXISTS lex_integration_endpoints_kind_check;
ALTER TABLE lex_integration_endpoints
    ADD CONSTRAINT lex_integration_endpoints_kind_check
    CHECK (kind IN (
        'najiz', 'hr', 'internal', 'archiving', 'email',
        'nafath_verify', 'sso', 'esign', 'custom'
    ));
