-- Reverse of 000001_init.up.sql. Safe to run repeatedly.

DROP INDEX IF EXISTS siem.health_check_tenant_idx;
DROP TABLE IF EXISTS siem.health_check;
DROP SCHEMA IF EXISTS siem CASCADE;
