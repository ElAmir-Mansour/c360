DROP INDEX IF EXISTS uq_dr_boot_service_group_site;
ALTER TABLE dr_boot_service
    DROP COLUMN IF EXISTS site_id,
    DROP COLUMN IF EXISTS boot_action;
