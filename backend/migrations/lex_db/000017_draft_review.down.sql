-- Reverse Feature 4 (drafting -> engine-backed human tasks).

DROP POLICY IF EXISTS tenant_delete ON lex_draft_reviews;
DROP POLICY IF EXISTS tenant_update ON lex_draft_reviews;
DROP POLICY IF EXISTS tenant_insert ON lex_draft_reviews;
DROP POLICY IF EXISTS tenant_isolation ON lex_draft_reviews;

DROP INDEX IF EXISTS idx_lex_draft_reviews_instance;
DROP INDEX IF EXISTS idx_lex_draft_reviews_task;
DROP INDEX IF EXISTS idx_lex_draft_reviews_tenant;
DROP INDEX IF EXISTS uq_lex_draft_reviews_open;

DROP TABLE IF EXISTS lex_draft_reviews;
