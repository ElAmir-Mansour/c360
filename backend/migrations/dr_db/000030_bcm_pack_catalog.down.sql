-- Reverse migrations/dr_db/000030_bcm_pack_catalog.up.sql.
-- Drop the control table first (it FKs the pack), then the pack table.
DROP TABLE IF EXISTS dr_bcm_pack_control;
DROP TABLE IF EXISTS dr_bcm_pack;
