-- =============================================================================
-- Down migration for the cross-cutting Phase-4 module.
-- =============================================================================

DROP TABLE IF EXISTS lex_integration_endpoints;
DROP TABLE IF EXISTS lex_attachment_policies;

-- FTS additions on legal_documents (drop index, generated column, then body col).
DROP INDEX IF EXISTS idx_legal_documents_search_vector;
ALTER TABLE legal_documents DROP COLUMN IF EXISTS search_vector;
ALTER TABLE legal_documents DROP COLUMN IF EXISTS extracted_text;
