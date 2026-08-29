ALTER TABLE document_versions
    ADD COLUMN IF NOT EXISTS extracted_text TEXT;
