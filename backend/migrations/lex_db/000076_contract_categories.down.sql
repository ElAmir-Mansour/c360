-- Reverse of contract_categories.up.sql (CAP-123). Drops the per-tenant category
-- catalog table outright (and with it the seeded demo-tenant rows); the
-- categorize writes it backed live only in contracts.tags / contracts.metadata,
-- which are owned by their own table and are left untouched.
DROP TABLE IF EXISTS contract_categories;
