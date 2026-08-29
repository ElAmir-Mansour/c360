-- =============================================================================
-- 000008: Durable dead-letter store (#14).
--
-- events.DeadLetterStore is an in-memory map (lost on restart). This table gives
-- notification-service a durable home for failed events routed to the DLQ topics
-- so operators can inspect, replay and acknowledge them across restarts.
-- Persisted in notification_db as notification_dead_letters because
-- platform_core is off-limits for this change; the shared in-memory store
-- (events.DeadLetterStore) is unchanged and other services keep using it.
--
-- Columns mirror events.DeadLetterEntry. status lifecycle:
--   pending -> replayed | acknowledged.
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification_dead_letters (
    id                UUID        PRIMARY KEY,
    original_event_id TEXT        NOT NULL DEFAULT '',
    original_type     TEXT        NOT NULL DEFAULT '',
    original_topic    TEXT        NOT NULL DEFAULT '',
    tenant_id         UUID,
    error             TEXT        NOT NULL DEFAULT '',
    retry_count       INT         NOT NULL DEFAULT 0,
    original_event    JSONB,
    event_data        JSONB,
    status            TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'replayed', 'acknowledged')),
    failed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dead_letters_tenant_status
    ON notification_dead_letters (tenant_id, status, failed_at DESC);

CREATE INDEX IF NOT EXISTS idx_dead_letters_status
    ON notification_dead_letters (status, failed_at DESC);
