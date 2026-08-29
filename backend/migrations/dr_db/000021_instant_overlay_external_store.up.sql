-- Allow instant-recovery overlay payloads to live outside Postgres while the
-- DB row remains the tenant-scoped metadata, content-hash, and ordering ledger.
ALTER TABLE dr_instant_overlay_chunk
    ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'db',
    ADD COLUMN IF NOT EXISTS storage_ref TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_dr_instant_overlay_storage_ref
    ON dr_instant_overlay_chunk (storage_backend, storage_ref)
    WHERE storage_ref <> '';
