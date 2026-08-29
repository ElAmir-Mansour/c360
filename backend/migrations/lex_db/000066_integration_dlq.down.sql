-- Reverse of integration_dlq.up.sql (reliability feature #11). The table
-- CASCADE-drops its policies + indexes.
DROP TABLE IF EXISTS lex_integration_dlq;
