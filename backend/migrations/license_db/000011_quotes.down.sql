-- Reversible: drop the quotes table, its indexes and the quote-number sequence.
-- IF EXISTS keeps the down migration idempotent. No other table is affected
-- (pricing_config is left intact; only the FK from quotes referenced it).
DROP INDEX IF EXISTS idx_quotes_created;
DROP INDEX IF EXISTS idx_quotes_model;
DROP INDEX IF EXISTS idx_quotes_tenant;
DROP INDEX IF EXISTS idx_quotes_status;
DROP TABLE IF EXISTS quotes;
DROP SEQUENCE IF EXISTS quote_number_seq;
