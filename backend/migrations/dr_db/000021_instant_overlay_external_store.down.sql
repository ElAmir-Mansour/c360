DROP INDEX IF EXISTS idx_dr_instant_overlay_storage_ref;

ALTER TABLE dr_instant_overlay_chunk
    DROP COLUMN IF EXISTS storage_ref,
    DROP COLUMN IF EXISTS storage_backend;
