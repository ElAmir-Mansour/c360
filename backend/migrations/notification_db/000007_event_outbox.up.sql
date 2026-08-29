-- =============================================================================
-- 000007: Transactional outbox for notification-service (#12).
--
-- notification.created was published fire-and-forget (warn-and-continue) right
-- after the notification row committed, so a crash between commit and publish
-- lost the event. This table lets the service stage the event in the SAME
-- transaction as the notification insert; the shared outbox.Relay
-- (internal/events/outbox) then drains staged rows to Kafka and marks them
-- published. Delivery to the bus is at-least-once; consumers dedup on event id
-- via events.IdempotencyGuard.
--
-- The table name and columns MIRROR the shared outbox schema
-- (internal/events/outbox/schema.go, migrations/platform_core/000015) so the
-- shared relay operates on it unchanged. Every statement is idempotent, so this
-- migration converges with outbox.EnsureSchema() which the service also calls at
-- startup for runtime provisioning.
-- =============================================================================

CREATE TABLE IF NOT EXISTS event_outbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID        NOT NULL UNIQUE,
    tenant_id       UUID        NOT NULL,
    topic           TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    payload         JSONB       NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
    attempts        INT         NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at      TIMESTAMPTZ,
    published_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_claim
    ON event_outbox (next_attempt_at, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_event_outbox_stuck
    ON event_outbox (claimed_at)
    WHERE status = 'publishing';

CREATE INDEX IF NOT EXISTS idx_event_outbox_purge
    ON event_outbox (published_at)
    WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_event_outbox_failed
    ON event_outbox (tenant_id, created_at)
    WHERE status = 'failed';
