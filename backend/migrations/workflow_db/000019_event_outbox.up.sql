-- =============================================================================
-- GOVERNANCE (Phase 5 moat) — LOSSLESS NON-PROMOTION AUDIT via the TRANSACTIONAL
-- OUTBOX (OUTBOX-ATOMICITY POLISH).
--
-- Before this wave, the non-promotion audit emits (the lifecycle events
-- workflow.instance.{completed,failed,cancelled,suspended,resumed,retried}) were
-- published to Kafka BEST-EFFORT, OUTSIDE the transaction that committed the state
-- change. A broker outage between the committed state transition and the publish
-- could LOSE the audit event, leaving a committed governed transition with no
-- corresponding entry in the platform hash-chain audit trail.
--
-- The engine now stages each such audit event via outbox.Write INSIDE the SAME
-- pgx transaction as the state UPDATE (repository.CommitInstanceStateWithEvent), so
-- the event row commits or rolls back ATOMICALLY with the state. The outbox relay
-- then delivers it exactly-once to platform.workflow.events (dedup on the stable
-- event_id), where the audit-service consumer chains it — no double-emit, and no
-- lost event. (Promotion already staged workflow.definition.promoted this way; this
-- extends the same guarantee to the lifecycle emits.)
--
-- This migration creates the event_outbox table in workflow_db so that
-- migrator-managed environments have it ahead of the in-tx staging writes. The
-- standalone workflow-engine ALSO calls outbox.EnsureSchema(db) at boot, so the two
-- paths converge; both are byte-for-byte identical to
-- internal/events/outbox/schema.go and migrations/platform_core/000015_event_outbox.
--
-- Additive, reversible, idempotent (CREATE TABLE/INDEX IF NOT EXISTS). NOT
-- RLS-forced: the relay claims rows cross-tenant (FOR UPDATE SKIP LOCKED) and the
-- table carries its own tenant_id column purely for operator triage of parked rows.
-- Kept in sync with repository/schema.go SchemaSQL (the same statements were added
-- there so embedding suites get the same shape).
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
