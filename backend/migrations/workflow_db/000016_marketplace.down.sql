-- Reverse 000016_marketplace: drop the marketplace catalog + install ledger and
-- the provenance columns stamped on workflow_definitions. Idempotent; drops only
-- what the up migration added, so existing workflow_definitions rows are
-- otherwise untouched.
ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS marketplace_item_version;
ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS marketplace_item_id;

DROP TABLE IF EXISTS workflow_marketplace_installs;
DROP TABLE IF EXISTS workflow_marketplace_items;
