-- No FKs between these tables; drop order is independent. RLS policies and indexes
-- drop with their tables.
DROP TABLE IF EXISTS lex_hearing_proximity_marker;
DROP TABLE IF EXISTS lex_notification_subscription;
DROP TABLE IF EXISTS lex_notification_inbox;
