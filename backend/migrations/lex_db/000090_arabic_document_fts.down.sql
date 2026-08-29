-- =============================================================================
-- Revert 000090: restore the byte-identical 'english' search_vector from 000032
-- and drop the Arabic normalizer. Reverting is a pure FTS index rebuild.
-- =============================================================================
DROP INDEX IF EXISTS idx_legal_documents_search_vector;

ALTER TABLE legal_documents
    DROP COLUMN IF EXISTS search_vector;

ALTER TABLE legal_documents
    ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(extracted_text, '')), 'C')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_legal_documents_search_vector
    ON legal_documents USING GIN (search_vector);

DROP FUNCTION IF EXISTS lex_search_normalize(text);
