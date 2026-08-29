-- Reverse of esign_connectors_seed.up.sql. Removes ONLY the seeded e-signature
-- connector rows (by their well-known codes), leaving any operator-created esign
-- endpoint untouched. Soft-delete semantics are not used here because these are
-- seed rows with no dependent data; a hard delete keeps the registry clean.
DELETE FROM lex_integration_endpoints
WHERE kind = 'esign'
  AND code IN ('esign_native', 'esign_docusign', 'esign_adobe', 'esign_najiz', 'esign_emdha');
