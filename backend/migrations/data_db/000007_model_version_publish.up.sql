-- Add publish provenance to data_models so a published, immutable model
-- version row records WHEN it was published and BY WHOM. Each version of a
-- data model is a separate data_models row sharing (tenant_id, name); the
-- publish-version endpoint snapshots the current definition into a new row
-- with an incremented version and stamps these columns.
ALTER TABLE data_models
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS published_by UUID;

-- Locate published versions quickly (e.g. the latest published version of a model).
CREATE INDEX IF NOT EXISTS idx_models_published
    ON data_models (tenant_id, name, version DESC)
    WHERE published_at IS NOT NULL AND deleted_at IS NULL;
