-- =============================================================================
-- Transactional event outbox (Solution Architecture E2E, slide 40).
--
-- Services INSERT a row here in the SAME transaction as their business write;
-- the outbox relay claims pending rows and publishes them to Kafka. This
-- removes the dual-write between PostgreSQL and the bus: if the transaction
-- rolls back, the event was never staged; if it commits, the event cannot be
-- lost.
--
-- This is an infrastructure table, deliberately NOT covered by tenant RLS:
-- the relay must claim rows across every tenant in one scan. No API surface
-- reads this table; services only write through internal/events/outbox.
-- Delivery is at-least-once — consumers deduplicate via the existing
-- idempotency guard keyed on event_id.
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

-- Relay claim scan: pending rows that are due, oldest first.
CREATE INDEX IF NOT EXISTS idx_event_outbox_claim
    ON event_outbox (next_attempt_at, created_at)
    WHERE status = 'pending';

-- Reaper scan: rows stuck in 'publishing' after a relay crash.
CREATE INDEX IF NOT EXISTS idx_event_outbox_stuck
    ON event_outbox (claimed_at)
    WHERE status = 'publishing';

-- Retention purge scan: published rows past the retention window.
CREATE INDEX IF NOT EXISTS idx_event_outbox_purge
    ON event_outbox (published_at)
    WHERE status = 'published';

-- Operator triage: terminally failed events per tenant.
CREATE INDEX IF NOT EXISTS idx_event_outbox_failed
    ON event_outbox (tenant_id, created_at)
    WHERE status = 'failed';
