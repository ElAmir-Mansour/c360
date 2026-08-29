-- =============================================================================
-- Workflow durable-execution correctness substrate — activity idempotency ledger.
--
-- This table is the persisted idempotency ledger for outbound activity attempts
-- (currently service_task HTTP calls, extensible to any external-effect step).
-- The engine records a stable key (instance_id:step_id:attempt) BEFORE the
-- outbound call so a recovered or retried instance never double-fires an external
-- effect: recovery/retry looks the key up and, when the prior attempt already
-- succeeded, replays the cached response instead of re-issuing the call.
--
-- The same key is sent as the Idempotency-Key HTTP header so a cooperating
-- downstream can also dedupe server-side (belt and suspenders).
--
-- Additive + reversible: every object uses IF NOT EXISTS. Applying this on an
-- existing deployed workflow DB is a safe no-op; the down migration drops only
-- what this file creates. No existing table is altered, so running instances and
-- definitions are unaffected. NOT RLS-forced — like the other workflow tables the
-- repositories filter by instance/tenant in SQL and do not use SET LOCAL
-- app.current_tenant_id (see 000001_init_schema.up.sql RLS NOTE).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS workflow_activity_executions (
    -- Stable idempotency key: instance_id:step_id:attempt. PRIMARY KEY so a
    -- concurrent re-entry that races to claim the same attempt collides on
    -- INSERT (ON CONFLICT DO NOTHING) instead of double-firing.
    idempotency_key TEXT        PRIMARY KEY,
    instance_id     UUID        NOT NULL REFERENCES workflow_instances(id),
    step_id         TEXT        NOT NULL,
    attempt         INT         NOT NULL DEFAULT 1,
    -- 'pending'   : claimed, outbound call in flight (or crashed mid-call)
    -- 'completed' : outbound call succeeded; response_data holds the cached result
    -- 'failed'    : outbound call failed terminally for this attempt
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'completed', 'failed')),
    response_data   JSONB,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_activity_executions_instance
    ON workflow_activity_executions (instance_id);

CREATE INDEX IF NOT EXISTS idx_workflow_activity_executions_instance_step
    ON workflow_activity_executions (instance_id, step_id);
