DELETE FROM lex_contract_attachments
WHERE metadata->>'source' = 'contract_version_backfill';
