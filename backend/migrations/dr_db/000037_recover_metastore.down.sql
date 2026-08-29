-- Reverse of 000037_recover_metastore.up.sql. Drops the Application Metastore
-- tables in child→parent order so the ON DELETE CASCADE FKs unwind cleanly. The
-- child tables would cascade anyway, but dropping explicitly in dependency order
-- keeps the rollback deterministic and self-documenting.
DROP TABLE IF EXISTS recover_metastore_runbook_link;
DROP TABLE IF EXISTS recover_metastore_cloud_account;
DROP TABLE IF EXISTS recover_metastore_dependency;
DROP TABLE IF EXISTS recover_metastore_environment;
DROP TABLE IF EXISTS recover_metastore_owner;
DROP TABLE IF EXISTS recover_metastore_application;
