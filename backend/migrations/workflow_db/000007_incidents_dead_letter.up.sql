-- =============================================================================
-- Workflow durable-execution correctness substrate — incidents, governed
-- operator overrides (maker-checker), and dead-letter.
--
-- GAP 4 closure. Instead of failInstance() terminating the WHOLE instance on
-- retry exhaustion, the engine raises an INCIDENT (Camunda-incident pattern):
-- the failed step is parked with the failure captured and the rest of the
-- instance / sibling parallel branches are preserved. A governed operator can
-- then retry / skip / modify-variables-then-retry.
--
--   * workflow_incidents           — one open incident per parked failed step.
--   * workflow_incident_overrides  — maker-checker (four-eyes) requests for the
--                                    SENSITIVE actions (skip / modify-variables).
--                                    The requester may NOT approve their own
--                                    request (distinct-actor / SoD, fail-closed).
--   * workflow_dead_letter         — instances/steps permanently failed or
--                                    explicitly abandoned, with enough context
--                                    (definition pin + instance snapshot) to
--                                    diagnose + replay.
--
-- Additive + reversible: every object uses IF NOT EXISTS and no existing table
-- is dropped or altered destructively. The instance/step CHECK constraints are
-- widened (drop + re-add) to admit the new 'incident' status; this is backward
-- compatible — every previously-valid value remains valid. Applying this on an
-- existing deployed workflow DB is safe: running instances and definitions are
-- unaffected. The down migration removes only what this file adds and restores
-- the original CHECK constraints. NOT RLS-forced — like the other workflow
-- tables the repositories filter by tenant/instance in SQL (see
-- 000001_init_schema.up.sql RLS NOTE).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Widen the instance + step-execution status CHECK constraints to admit the new
-- 'incident' status. Drop-and-re-add is idempotent and backward compatible: all
-- previously-accepted values are retained.
-- ---------------------------------------------------------------------------
ALTER TABLE workflow_instances       DROP CONSTRAINT IF EXISTS workflow_instances_status_check;
ALTER TABLE workflow_instances
    ADD CONSTRAINT workflow_instances_status_check
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'suspended', 'incident'));

ALTER TABLE workflow_step_executions DROP CONSTRAINT IF EXISTS workflow_step_executions_status_check;
ALTER TABLE workflow_step_executions
    ADD CONSTRAINT workflow_step_executions_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled', 'incident'));

-- ---------------------------------------------------------------------------
-- Incidents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_incidents (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    instance_id     UUID        NOT NULL REFERENCES workflow_instances(id),
    step_id         TEXT        NOT NULL,
    step_exec_id    UUID        REFERENCES workflow_step_executions(id),
    step_type       TEXT        NOT NULL,
    -- 'open'          : awaiting operator intervention
    -- 'resolved'      : an operator cleared it (retry/skip/modify) and the
    --                   instance resumed
    -- 'dead_lettered' : abandoned / permanently failed (see workflow_dead_letter)
    status          TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'resolved', 'dead_lettered')),
    error_message   TEXT        NOT NULL DEFAULT '',
    attempt         INT         NOT NULL DEFAULT 1,
    details         JSONB,
    resolved_by     UUID,
    resolved_at     TIMESTAMPTZ,
    resolution_kind TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_incidents_tenant
    ON workflow_incidents (tenant_id);

CREATE INDEX IF NOT EXISTS idx_workflow_incidents_instance
    ON workflow_incidents (instance_id);

-- At most one OPEN incident per instance+step (partial unique) — a re-raise
-- while one is already open is idempotent rather than duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_incidents_open_step
    ON workflow_incidents (instance_id, step_id)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_workflow_incidents_open
    ON workflow_incidents (tenant_id, status) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- Incident overrides (maker-checker / four-eyes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_incident_overrides (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    incident_id   UUID        NOT NULL REFERENCES workflow_incidents(id),
    instance_id   UUID        NOT NULL REFERENCES workflow_instances(id),
    -- 'skip' | 'modify_variables_retry' — the sensitive action being requested.
    kind          TEXT        NOT NULL
                  CHECK (kind IN ('skip', 'modify_variables_retry')),
    status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
    -- The MAKER (requester). The approver must be a DISTINCT actor (enforced in
    -- the service via the approval-chain distinct-actor primitive, fail-closed).
    requested_by  UUID        NOT NULL,
    reason        TEXT        NOT NULL DEFAULT '',
    old_variables JSONB,
    new_variables JSONB,
    approved_by   UUID,
    approved_at   TIMESTAMPTZ,
    rejected_by   UUID,
    rejected_at   TIMESTAMPTZ,
    reject_reason TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_incident_overrides_incident
    ON workflow_incident_overrides (incident_id);

CREATE INDEX IF NOT EXISTS idx_workflow_incident_overrides_tenant_status
    ON workflow_incident_overrides (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Dead letter
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_dead_letter (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID        NOT NULL,
    instance_id    UUID        NOT NULL REFERENCES workflow_instances(id),
    incident_id    UUID        REFERENCES workflow_incidents(id),
    step_id        TEXT        NOT NULL,
    step_type      TEXT        NOT NULL DEFAULT '',
    -- 'abandoned'         : an operator explicitly abandoned the incident
    -- 'permanent_failure' : automatic dead-letter, no viable recovery path
    reason         TEXT        NOT NULL
                   CHECK (reason IN ('abandoned', 'permanent_failure')),
    error_message  TEXT        NOT NULL DEFAULT '',
    definition_id  UUID        NOT NULL,
    definition_ver INT         NOT NULL DEFAULT 1,
    -- Full instance state at dead-letter time (variables, step outputs, current
    -- step) so a replay can be reconstructed off-line.
    snapshot       JSONB,
    abandoned_by   UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_dead_letter_tenant_created
    ON workflow_dead_letter (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_dead_letter_instance
    ON workflow_dead_letter (instance_id);
