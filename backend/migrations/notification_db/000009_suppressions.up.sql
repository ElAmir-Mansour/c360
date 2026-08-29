-- =============================================================================
-- 000009: Compliance suppression list + global opt-out (#17).
--
-- notification-service had no unsubscribe/suppression surface. This migration
-- adds:
--   1. notification_suppressions — per-user, per-channel entries that HARD-BLOCK
--      outbound delivery (RFC 8058 one-click unsubscribe, hard bounces, spam
--      complaints). The dispatcher consults this before delivering email/webhook.
--   2. notification_preferences.opted_out — a global kill-switch honored by
--      ResolveChannels (unsubscribe from ALL notifications).
--
-- Mirrors internal/notification/repository/schema.go (schemaMigrations), which
-- the service also applies at startup, so this converges with runtime
-- provisioning. Every statement is idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification_suppressions (
    tenant_id   UUID        NOT NULL,
    user_id     UUID        NOT NULL,
    channel     TEXT        NOT NULL CHECK (channel IN ('in_app', 'email', 'websocket', 'webhook')),
    reason      TEXT        NOT NULL DEFAULT 'manual',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_suppressions_lookup
    ON notification_suppressions (tenant_id, user_id, channel);

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT false;
