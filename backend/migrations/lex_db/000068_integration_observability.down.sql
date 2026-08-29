-- Reverse of integration_observability.up.sql (#16 call metrics + #17 inbound
-- events). Each table CASCADE-drops its policies + indexes.
DROP TABLE IF EXISTS lex_integration_events;
DROP TABLE IF EXISTS lex_integration_call_metrics;
