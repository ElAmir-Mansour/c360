-- Reverse 000064: drop the endpoint health-check ledger.
-- The index and 4 RLS policies are dropped implicitly with the table.

DROP TABLE IF EXISTS lex_integration_health_checks;
