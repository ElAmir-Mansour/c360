-- Reverse of 000035_dr_integrations.up.sql: drop the external integrations
-- catalog. The RLS policies and indexes are dropped with the table.
DROP TABLE IF EXISTS dr_integration;
