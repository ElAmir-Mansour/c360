DROP INDEX IF EXISTS idx_event_outbox_failed;
DROP INDEX IF EXISTS idx_event_outbox_purge;
DROP INDEX IF EXISTS idx_event_outbox_stuck;
DROP INDEX IF EXISTS idx_event_outbox_claim;
DROP TABLE IF EXISTS event_outbox;
