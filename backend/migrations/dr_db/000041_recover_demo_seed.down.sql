-- Reverse 000041_recover_demo_seed: drop the Recover onboarding demo-seed
-- ledger (and with it its RLS policies and indexes). The demo CONTENT itself
-- (recover_metastore_* applications and dr_studio_* runbooks) lives in those
-- tables and is removed by the "remove demo data" action, not by this migration;
-- dropping the ledger only removes the tracking rows.
DROP TABLE IF EXISTS recover_demo_seed_item;
