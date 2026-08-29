-- Reverse of 000001_init_schema.up.sql. Drop in dependency order; CASCADE on
-- the leaf FKs is implied by the table-drop ordering.
DROP TABLE IF EXISTS event_outbox;
DROP TABLE IF EXISTS attestation;
DROP TABLE IF EXISTS failover_step;
DROP TABLE IF EXISTS failover_run;
DROP TABLE IF EXISTS recovery_target;
DROP TABLE IF EXISTS network_mapping;
DROP TABLE IF EXISTS recovery_point;
DROP TABLE IF EXISTS replication_stream;
DROP TABLE IF EXISTS consistency_group_member;
DROP TABLE IF EXISTS consistency_group;
DROP TABLE IF EXISTS dr_agent;
DROP TABLE IF EXISTS protected_site;
