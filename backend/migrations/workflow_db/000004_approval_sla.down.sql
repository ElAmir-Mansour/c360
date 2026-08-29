-- Reverse of 000004_approval_sla.up.sql. Policies are dropped implicitly with
-- their owning tables. Tables are dropped independently (no FKs between them).
-- The pgcrypto extension is intentionally left in place.

DROP TABLE IF EXISTS workflow_calendars;
DROP TABLE IF EXISTS workflow_sla_policies;
