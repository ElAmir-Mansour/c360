-- Reverse 000013_instant_recovery.up.sql. Drop the overlay-chunk table first (it
-- references the session table). Policies and indexes drop with the tables.
DROP TABLE IF EXISTS dr_instant_overlay_chunk;
DROP TABLE IF EXISTS dr_instant_session;
