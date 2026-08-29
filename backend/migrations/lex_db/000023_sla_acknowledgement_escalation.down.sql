-- Reverse FK order: outbox (child) → clocks → targets (parents). RLS policies and
-- indexes drop with their tables.
DROP TABLE IF EXISTS legal_sla_notification_outbox;
DROP TABLE IF EXISTS legal_sla_clocks;
DROP TABLE IF EXISTS legal_sla_targets;
