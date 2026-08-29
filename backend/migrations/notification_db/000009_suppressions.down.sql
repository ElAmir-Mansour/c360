-- Reverse 000009. Drops the suppression list and the global opt-out column.
DROP INDEX IF EXISTS idx_suppressions_lookup;
DROP TABLE IF EXISTS notification_suppressions;

ALTER TABLE notification_preferences
    DROP COLUMN IF EXISTS opted_out;
