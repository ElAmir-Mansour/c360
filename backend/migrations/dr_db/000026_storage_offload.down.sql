-- Reverse migrations/dr_db/000026_storage_offload.up.sql.
-- Drop the snapshot catalog first (it FKs the volume), then the volume table.
DROP TABLE IF EXISTS dr_storage_snapshot;
DROP TABLE IF EXISTS dr_storage_volume;
