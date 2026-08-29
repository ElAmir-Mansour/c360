-- =============================================================================
-- Workflow engine schema — workflow_db.
--
-- This migration is the central-migrator home for the workflow engine schema
-- that was historically self-managed by internal/workflow/repository/schema.go
-- (the SchemaSQL constant applied at boot by RunMigration). The table, column,
-- and index definitions below are copied VERBATIM from that SchemaSQL constant
-- so the schema is byte-for-byte identical: every statement uses
-- IF NOT EXISTS, which makes applying this migration on an existing deployed
-- workflow DB a safe no-op and leaves running tenants unaffected.
--
-- RLS NOTE: the existing workflow repositories filter by tenant_id in SQL but
-- do NOT use database.RunWithTenant / SET LOCAL app.current_tenant_id. We
-- therefore intentionally do NOT add ENABLE/FORCE ROW LEVEL SECURITY to these
-- tables here — forcing RLS would break the non-RLS-aware repositories. The
-- tables are migrated verbatim (no new RLS). RLS retrofit deferred — requires
-- repos to adopt RunWithTenant first; a later WP can harden it. New tables in
-- later migration batches are built RLS-aware and carry full RLS.
--
-- The event_outbox block at the bottom mirrors
-- migrations/license_db/000001_init_schema.up.sql and
-- internal/events/outbox/schema.go (outbox.EnsureSchema). The workflow-engine
-- ensures this table at boot via outbox.EnsureSchema; defining it here lets the
-- central migrator provision the same table. Like the other infrastructure
-- outbox tables it is not RLS-forced.
-- =============================================================================

-- gen_random_uuid() requires the pgcrypto extension. Provisioned in
-- deploy/docker/init-databases.sql for managed environments; declared here as
-- an idempotent no-op so an apply-from-scratch (e.g. the migration idempotency
-- test) succeeds on a bare database.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Workflow Definitions
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    version INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'deprecated', 'archived')),
    trigger_config JSONB NOT NULL DEFAULT '{}',
    variables JSONB NOT NULL DEFAULT '{}',
    steps JSONB NOT NULL,
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (tenant_id, name, version)
);

-- Add columns if they do not already exist (idempotent).
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant
    ON workflow_definitions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant_status
    ON workflow_definitions (tenant_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant_name
    ON workflow_definitions (tenant_id, name) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger_topic
    ON workflow_definitions USING gin ((trigger_config -> 'topic'))
    WHERE status = 'active' AND deleted_at IS NULL;

-- ============================================================
-- Workflow Instances
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    definition_id UUID NOT NULL REFERENCES workflow_definitions(id),
    definition_ver INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'suspended')),
    current_step_id TEXT,
    variables JSONB NOT NULL DEFAULT '{}',
    step_outputs JSONB NOT NULL DEFAULT '{}',
    trigger_data JSONB,
    error_message TEXT,
    started_by UUID,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_tenant
    ON workflow_instances (tenant_id);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_tenant_status
    ON workflow_instances (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_tenant_definition
    ON workflow_instances (tenant_id, definition_id);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_status
    ON workflow_instances (status) WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_workflow_instances_started_at
    ON workflow_instances (tenant_id, started_at DESC);

-- ============================================================
-- Workflow Trigger Executions
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_trigger_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    definition_id UUID NOT NULL REFERENCES workflow_definitions(id),
    instance_id UUID REFERENCES workflow_instances(id),
    event_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('matched', 'skipped', 'duplicate', 'started', 'failed')),
    dedupe_key TEXT,
    reason TEXT NOT NULL DEFAULT '',
    trigger_data JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_trigger_executions_tenant_created
    ON workflow_trigger_executions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_trigger_executions_definition_event
    ON workflow_trigger_executions (definition_id, event_id);

CREATE INDEX IF NOT EXISTS idx_workflow_trigger_executions_dedupe
    ON workflow_trigger_executions (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ============================================================
-- Workflow Step Executions
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_step_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES workflow_instances(id),
    step_id TEXT NOT NULL,
    step_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
    input_data JSONB,
    output_data JSONB,
    error_message TEXT,
    attempt INT NOT NULL DEFAULT 1,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_step_executions_instance
    ON workflow_step_executions (instance_id);

CREATE INDEX IF NOT EXISTS idx_workflow_step_executions_instance_step
    ON workflow_step_executions (instance_id, step_id);

-- ============================================================
-- Workflow Tasks (Human Tasks)
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    instance_id UUID NOT NULL REFERENCES workflow_instances(id),
    step_id TEXT NOT NULL,
    step_exec_id UUID NOT NULL REFERENCES workflow_step_executions(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'completed', 'rejected', 'escalated', 'cancelled')),
    assignee_id UUID,
    assignee_role TEXT,
    claimed_by UUID,
    claimed_at TIMESTAMPTZ,
    form_schema JSONB NOT NULL DEFAULT '[]',
    form_data JSONB,
    sla_deadline TIMESTAMPTZ,
    sla_breached BOOLEAN NOT NULL DEFAULT false,
    escalated_to UUID,
    escalation_role TEXT,
    delegated_by UUID,
    delegated_at TIMESTAMPTZ,
    priority INT NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_tenant
    ON workflow_tasks (tenant_id);

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_tenant_status
    ON workflow_tasks (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_assignee
    ON workflow_tasks (tenant_id, assignee_id) WHERE status IN ('pending', 'claimed');

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_assignee_role
    ON workflow_tasks (tenant_id, assignee_role) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_instance
    ON workflow_tasks (instance_id);

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_sla
    ON workflow_tasks (sla_deadline) WHERE sla_breached = false AND status IN ('pending', 'claimed');

-- ============================================================
-- Workflow Templates
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    definition_json JSONB NOT NULL,
    icon TEXT NOT NULL DEFAULT 'workflow',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_category
    ON workflow_templates (category);

-- ============================================================
-- Workflow Timers
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_timers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES workflow_instances(id),
    step_id TEXT NOT NULL,
    fire_at TIMESTAMPTZ NOT NULL,
    fired BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_timers_fire
    ON workflow_timers (fire_at) WHERE fired = false;

CREATE INDEX IF NOT EXISTS idx_workflow_timers_instance
    ON workflow_timers (instance_id);

-- ============================================================
-- Event outbox (transactional outbox)
--
-- Workflow events are staged in the same transaction as the state change and
-- drained by the outbox relay. Definition mirrors
-- migrations/license_db/000001_init_schema.up.sql and
-- internal/events/outbox/schema.go (outbox.EnsureSchema, which the
-- workflow-engine calls at boot). Like the other infrastructure outbox tables
-- it is NOT RLS-forced — no tenant-facing API reads it directly.
-- ============================================================
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
