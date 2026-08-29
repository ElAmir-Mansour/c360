-- Reverse of integration_extensibility.up.sql.
--
--   1. Drop the conflict-resolution queue (#20). CASCADE-drops its policies + indexes.
--   2. Revert the endpoint-kind CHECK to the 000058 list (without 'custom'). Any
--      existing kind='custom' rows would violate the narrowed CHECK; this DOWN assumes
--      they have been migrated/removed first (the same expectation the 000058 widen
--      carried). The narrowed list mirrors 000058 exactly.

DROP TABLE IF EXISTS lex_integration_conflicts;

ALTER TABLE lex_integration_endpoints
    DROP CONSTRAINT IF EXISTS lex_integration_endpoints_kind_check;
ALTER TABLE lex_integration_endpoints
    ADD CONSTRAINT lex_integration_endpoints_kind_check
    CHECK (kind IN (
        'najiz', 'hr', 'internal', 'archiving', 'email',
        'nafath_verify', 'sso', 'esign'
    ));
