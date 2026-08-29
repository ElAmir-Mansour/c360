-- Reverse 000010_copilot_sessions.up.sql. Drop the message table first (it
-- references the session table). Policies and indexes drop with the tables.
DROP TABLE IF EXISTS dr_copilot_message;
DROP TABLE IF EXISTS dr_copilot_session;
