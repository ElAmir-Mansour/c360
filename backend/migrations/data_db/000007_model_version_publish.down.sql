DROP INDEX IF EXISTS idx_models_published;

ALTER TABLE data_models
    DROP COLUMN IF EXISTS published_by,
    DROP COLUMN IF EXISTS published_at;
