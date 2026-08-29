-- Reverse of 000005_workflow_templates.up.sql. Indexes are dropped implicitly
-- with their owning table. The pgcrypto extension is intentionally left in place.

DROP TABLE IF EXISTS workflow_templates;
