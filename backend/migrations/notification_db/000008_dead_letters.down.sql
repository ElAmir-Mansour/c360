-- Reverse 000008. Drops the durable dead-letter table and its indexes.
DROP INDEX IF EXISTS idx_dead_letters_status;
DROP INDEX IF EXISTS idx_dead_letters_tenant_status;
DROP TABLE IF EXISTS notification_dead_letters;
