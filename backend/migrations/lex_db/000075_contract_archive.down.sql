DROP INDEX IF EXISTS idx_contracts_archive;

ALTER TABLE contracts
    DROP COLUMN IF EXISTS archive_status,
    DROP COLUMN IF EXISTS archive_reason,
    DROP COLUMN IF EXISTS archived_by,
    DROP COLUMN IF EXISTS archive_date;
