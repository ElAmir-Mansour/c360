-- CAP-122: archive lifecycle for contracts. Adds the four archive columns plus a
-- supporting index so the "Archived Contracts" advanced-search view can filter by
-- archive_status + archive_date cheaply. archive_status is a soft state
-- (active|archived) distinct from the contract's business `status`; a contract
-- stays in its current status when archived and only its archive_status flips.

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS archive_date    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by     UUID,
    ADD COLUMN IF NOT EXISTS archive_reason  TEXT,
    ADD COLUMN IF NOT EXISTS archive_status  TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_contracts_archive
    ON contracts (tenant_id, archive_status, archive_date DESC)
    WHERE deleted_at IS NULL;
