-- Reverse of 000028_byok.up.sql. Drop in dependency-free order (no FKs between
-- these tables); RLS policies drop with their tables.
DROP TABLE IF EXISTS dr_kek_custody_log;
DROP TABLE IF EXISTS dr_wrapped_dek;
DROP TABLE IF EXISTS dr_tenant_kek;
