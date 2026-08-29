-- Reverse 000026: drop the roles.metadata column.
ALTER TABLE roles
    DROP COLUMN IF EXISTS metadata;
