-- Down: drop the inbound SCIM 2.0 server bearer-token store (Phase 2 HR connector).
DROP TABLE IF EXISTS lex_scim_tokens;
