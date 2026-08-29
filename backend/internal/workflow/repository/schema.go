package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SchemaSQL is the legacy in-service bootstrap used by suites that embed the
// workflow primitives directly. The workflow-engine itself runs the versioned
// migrations under migrations/workflow_db; keep this bootstrap cumulative with
// those migrations so Lex/Acta/Cyber/onboarding databases have the same columns
// before direct repository writes run. Every statement is idempotent and safe to
// re-run.
//
// CORE-TABLE RLS (migration 000008) IS INTENTIONALLY NOT MIRRORED HERE.
// The standalone workflow-engine FORCE-RLS's the five core tables
// (workflow_definitions/instances/tasks/step_executions/trigger_executions) via
// migrations/workflow_db/000008_core_rls.up.sql, and its retrofitted core
// repositories set SET LOCAL app.current_tenant_id / app.bypass_rls on every
// statement (see repository/rls.go). Embedding suites (Lex/Acta/Cyber), however,
// ALSO issue DIRECT SQL against these tables from their own service layer WITHOUT
// establishing that session variable, so forcing RLS in this shared bootstrap
// would make those suites' queries see zero rows / fail WITH CHECK — a breaking
// change. This is the SAME split the forms/SLA tables use (RLS lives only in the
// versioned migration, never in SchemaSQL) and mirrors the 000001 RLS-deferral
// note above. A later WP can retrofit the embedding suites' direct queries to the
// RunWithTenant pattern and then force core RLS here too.
const SchemaSQL = `
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
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS definition_key UUID;
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'dev';
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS immutable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS promoted_by TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'workflow_definitions_stage_check'
    ) THEN
        ALTER TABLE workflow_definitions
            ADD CONSTRAINT workflow_definitions_stage_check
            CHECK (stage IN ('dev', 'staging', 'prod'));
    END IF;
END
$$;

WITH lineage AS (
    SELECT DISTINCT tenant_id, name
    FROM workflow_definitions
    WHERE definition_key IS NULL
),
assigned AS (
    SELECT tenant_id, name, gen_random_uuid() AS new_key
    FROM lineage
)
UPDATE workflow_definitions d
SET definition_key = a.new_key
FROM assigned a
WHERE d.tenant_id = a.tenant_id
  AND d.name = a.name
  AND d.definition_key IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'workflow_definitions'
          AND column_name = 'definition_key'
          AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE workflow_definitions
            ALTER COLUMN definition_key SET NOT NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant
    ON workflow_definitions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant_status
    ON workflow_definitions (tenant_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant_name
    ON workflow_definitions (tenant_id, name) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant_key
    ON workflow_definitions (tenant_id, definition_key) WHERE deleted_at IS NULL;

-- Versioning/lifecycle hardening (kept in sync with
-- migrations/workflow_db/000014_active_version_uniqueness.up.sql): at most ONE
-- prod-promoted active version per lineage (the single runtime-selected version),
-- plus a supporting index for the deterministic runtime-active lookup. Additive,
-- idempotent; no policy change.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_definitions_one_prod_active
    ON workflow_definitions (tenant_id, definition_key)
    WHERE stage = 'prod' AND status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_lineage_active
    ON workflow_definitions (tenant_id, definition_key, version DESC)
    WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger_topic
    ON workflow_definitions USING gin ((trigger_config -> 'topic'))
    WHERE status = 'active' AND deleted_at IS NULL;

-- CONTROL-FLOW (Phase 5): governance/tooling listing of definitions that attach
-- interrupting boundary events to any step. Boundary events + the event-based
-- gateway live entirely in the existing JSONB (steps / per-step config), so this
-- is the ONLY schema addition — a tiny partial index over boundary-carrying
-- definitions. Kept in sync with migrations/workflow_db/000017_boundary_events.up.sql.
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_boundary_events
    ON workflow_definitions (tenant_id, status)
    WHERE steps::text LIKE '%"boundary_events"%';

-- GOVERNANCE/PDPL (Phase 5): governance/privacy listing of definitions that
-- classify at least one sensitive field. Classification (VariableDef.Sensitivity /
-- FormField.Sensitivity) lives entirely in the existing variables/steps JSONB via
-- the additive "sensitivity" key, so this is the ONLY schema addition — a tiny
-- partial index over classification-carrying definitions. Kept in sync with
-- migrations/workflow_db/000018_payload_encryption.up.sql.
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_sensitivity
    ON workflow_definitions (tenant_id, status)
    WHERE variables::text LIKE '%"sensitivity"%'
       OR steps::text LIKE '%"sensitivity"%';

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

-- GOVERNANCE/PDPL: document the at-rest envelope convention on the sensitive JSONB
-- columns. Classified values may be stored as an "enc:v1:<base64>" AES-256-GCM
-- envelope; values without that prefix are plaintext. Purely informational and
-- idempotent. Kept in sync with migrations/workflow_db/000018_payload_encryption.up.sql.
COMMENT ON COLUMN workflow_instances.variables IS
    'Instance variables (JSONB). Classified values may be stored as an "enc:v1:<base64>" AES-256-GCM envelope at rest; values without that prefix are plaintext. See internal/workflow/payloadcrypto.';
COMMENT ON COLUMN workflow_instances.step_outputs IS
    'Per-step outputs (JSONB). Classified values may be stored as an "enc:v1:<base64>" AES-256-GCM envelope at rest; values without that prefix are plaintext. See internal/workflow/payloadcrypto.';

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

-- PROCESS-INTELLIGENCE read-model supporting indexes (kept in sync with
-- migrations/workflow_db/000012_analytics_indexes.up.sql). Cover the cycle-time
-- percentile scan over completed instances and the throughput/started+active
-- scans. Additive, idempotent; no policy change.
CREATE INDEX IF NOT EXISTS idx_workflow_instances_analytics_completed
    ON workflow_instances (tenant_id, definition_id, completed_at)
    WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_instances_analytics_started
    ON workflow_instances (tenant_id, started_at, status);

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

-- PROCESS-INTELLIGENCE read-model supporting index (kept in sync with
-- migrations/workflow_db/000012_analytics_indexes.up.sql). Covers the
-- bottleneck/rework aggregation's instance_id join + started_at ordering /
-- duration read. Additive, idempotent; no policy change.
CREATE INDEX IF NOT EXISTS idx_workflow_step_executions_analytics
    ON workflow_step_executions (instance_id, started_at)
    WHERE completed_at IS NOT NULL;

-- PROCESS-MINING read-model supporting index (kept in sync with
-- migrations/workflow_db/000015_mining_indexes.up.sql). Covers the executed-path
-- reconstruction: array_agg(step_id ORDER BY started_at, created_at, id) over the
-- STARTED step executions per instance (partial on started_at, unlike the
-- completed-only analytics index). Additive, idempotent; no policy change.
CREATE INDEX IF NOT EXISTS idx_workflow_step_executions_mining_path
    ON workflow_step_executions (instance_id, started_at, created_at, id)
    WHERE started_at IS NOT NULL;

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
	late_justification TEXT,
	late_justification_submitted_by UUID,
	late_justification_submitted_at TIMESTAMPTZ,
	late_justification_manager_role TEXT,
	CONSTRAINT workflow_tasks_late_justification_complete CHECK (
		(late_justification IS NULL
		 AND late_justification_submitted_by IS NULL
		 AND late_justification_submitted_at IS NULL
		 AND late_justification_manager_role IS NULL)
		OR
		(length(btrim(late_justification)) > 0
		 AND late_justification_submitted_by IS NOT NULL
		 AND late_justification_submitted_at IS NOT NULL
		 AND length(btrim(late_justification_manager_role)) > 0)
	),
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

-- Candidate-group / work-queue columns (kept in sync with
-- migrations/workflow_db/000010_candidate_groups.up.sql). ADDITIVE to the single
-- assignee_id / assignee_role: an empty pool (both arrays '{}') is the legacy
-- single-assignee / single-role task, unchanged. candidate_groups holds the
-- groups (roles) whose members may claim from the pool; candidate_users holds
-- specific extra users. Matched at read time against the caller's roles/id.
ALTER TABLE workflow_tasks ADD COLUMN IF NOT EXISTS candidate_groups TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE workflow_tasks ADD COLUMN IF NOT EXISTS candidate_users  UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_candidate_groups
    ON workflow_tasks USING gin (candidate_groups)
    WHERE status = 'pending' AND claimed_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_candidate_users
    ON workflow_tasks USING gin (candidate_users)
    WHERE status = 'pending' AND claimed_by IS NULL;

-- ============================================================
-- Workflow Templates
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_templates (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    category TEXT NOT NULL,
    definition_json JSONB NOT NULL,
    icon TEXT NOT NULL DEFAULT 'workflow',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WS-1: data-driven catalog columns (kept in sync with
-- migrations/workflow_db/000005_workflow_templates.up.sql) so suites that boot
-- the workflow schema via SchemaSQL get the same catalog shape. tenant_id NULL
-- == GLOBAL; name_i18n/description_i18n carry the bilingual display strings.
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS tenant_id        UUID;
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS name_i18n        JSONB NOT NULL DEFAULT '{}';
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS description_i18n JSONB NOT NULL DEFAULT '{}';
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS tags             JSONB NOT NULL DEFAULT '[]';
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS version          INT NOT NULL DEFAULT 1;
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_templates' AND column_name='name') THEN
        ALTER TABLE workflow_templates ALTER COLUMN name DROP NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_templates' AND column_name='description') THEN
        ALTER TABLE workflow_templates ALTER COLUMN description DROP NOT NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_workflow_templates_category
    ON workflow_templates (category);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_tenant
    ON workflow_templates (tenant_id);

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
-- Workflow Activity Executions (idempotency ledger)
--
-- Persisted idempotency key per outbound activity attempt
-- (instance_id:step_id:attempt). Recorded BEFORE the outbound call so a
-- recovered/retried instance never double-fires an external effect. Kept in sync
-- with migrations/workflow_db/000006_activity_idempotency.up.sql so suites that
-- boot the workflow schema via SchemaSQL get the same table.
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_activity_executions (
    idempotency_key TEXT        PRIMARY KEY,
    instance_id     UUID        NOT NULL REFERENCES workflow_instances(id),
    step_id         TEXT        NOT NULL,
    attempt         INT         NOT NULL DEFAULT 1,
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

-- ============================================================
-- Workflow Incidents + governed operator overrides + dead-letter
--
-- GAP 4: retry exhaustion raises an INCIDENT (Camunda-incident pattern) that
-- PARKS the failed step instead of terminating the whole instance. Kept in sync
-- with migrations/workflow_db/000007_incidents_dead_letter.up.sql so suites that
-- boot the workflow schema via SchemaSQL get the same tables + the widened
-- 'incident' status. All statements are idempotent.
-- ============================================================

-- Widen instance + step status CHECK constraints to admit 'incident'
-- (backward compatible: every previously-valid value remains valid).
ALTER TABLE workflow_instances       DROP CONSTRAINT IF EXISTS workflow_instances_status_check;
ALTER TABLE workflow_instances
    ADD CONSTRAINT workflow_instances_status_check
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'suspended', 'incident'));

ALTER TABLE workflow_step_executions DROP CONSTRAINT IF EXISTS workflow_step_executions_status_check;
ALTER TABLE workflow_step_executions
    ADD CONSTRAINT workflow_step_executions_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled', 'incident'));

CREATE TABLE IF NOT EXISTS workflow_incidents (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    instance_id     UUID        NOT NULL REFERENCES workflow_instances(id),
    step_id         TEXT        NOT NULL,
    step_exec_id    UUID        REFERENCES workflow_step_executions(id),
    step_type       TEXT        NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_incidents_open_step
    ON workflow_incidents (instance_id, step_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_workflow_incidents_open
    ON workflow_incidents (tenant_id, status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS workflow_incident_overrides (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    incident_id   UUID        NOT NULL REFERENCES workflow_incidents(id),
    instance_id   UUID        NOT NULL REFERENCES workflow_instances(id),
    kind          TEXT        NOT NULL
                  CHECK (kind IN ('skip', 'modify_variables_retry')),
    status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
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

CREATE TABLE IF NOT EXISTS workflow_dead_letter (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID        NOT NULL,
    instance_id    UUID        NOT NULL REFERENCES workflow_instances(id),
    incident_id    UUID        REFERENCES workflow_incidents(id),
    step_id        TEXT        NOT NULL,
    step_type      TEXT        NOT NULL DEFAULT '',
    reason         TEXT        NOT NULL
                   CHECK (reason IN ('abandoned', 'permanent_failure')),
    error_message  TEXT        NOT NULL DEFAULT '',
    definition_id  UUID        NOT NULL,
    definition_ver INT         NOT NULL DEFAULT 1,
    snapshot       JSONB,
    abandoned_by   UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_dead_letter_tenant_created
    ON workflow_dead_letter (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_dead_letter_instance
    ON workflow_dead_letter (instance_id);

-- ============================================================
-- Out-of-office / substitute (deputy) registry. Kept cumulative with
-- migrations/workflow_db/000009_substitutions.up.sql so suites that boot the
-- workflow schema via SchemaSQL get the same table. As with the other core
-- tables above, RLS is NOT forced here (embedding suites issue direct SQL
-- without the SET LOCAL tenant context); the standalone workflow-engine forces
-- RLS on this table via the 000009 versioned migration.
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_substitutions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    user_id     UUID        NOT NULL,
    deputy_id   UUID        NOT NULL,
    from_time   TIMESTAMPTZ NOT NULL,
    to_time     TIMESTAMPTZ NOT NULL,
    active      BOOLEAN     NOT NULL DEFAULT true,
    reason      TEXT        NOT NULL DEFAULT '',
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT workflow_substitutions_no_self CHECK (user_id <> deputy_id),
    CONSTRAINT workflow_substitutions_window CHECK (to_time >= from_time)
);
CREATE INDEX IF NOT EXISTS idx_workflow_substitutions_lookup
    ON workflow_substitutions (tenant_id, user_id, active);
CREATE INDEX IF NOT EXISTS idx_workflow_substitutions_window
    ON workflow_substitutions (tenant_id, user_id, from_time, to_time)
    WHERE active = true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_substitutions_active_user
    ON workflow_substitutions (tenant_id, user_id)
    WHERE active = true;

-- ============================================================
-- Pre-breach SLA at-risk marker on workflow_tasks. Kept cumulative with
-- migrations/workflow_db/000011_task_at_risk.up.sql so suites that boot the
-- workflow schema via SchemaSQL get the same columns. Additive ADD COLUMN IF NOT
-- EXISTS on the existing table (no policy change; workflow_tasks already FORCEs
-- RLS via 000008). at_risk flags an APPROACHING-breach task so the pre-breach
-- reminder tiers are reachable and approaching work is queryable.
-- ============================================================
ALTER TABLE workflow_tasks
    ADD COLUMN IF NOT EXISTS at_risk BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE workflow_tasks
    ADD COLUMN IF NOT EXISTS at_risk_since TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_at_risk
    ON workflow_tasks (at_risk_since)
    WHERE at_risk = true AND sla_breached = false AND status IN ('pending', 'claimed');

-- ============================================================
-- BPMN composition — call-activity / sub-process + multi-instance (for-each).
-- Kept cumulative with migrations/workflow_db/000013_composition.up.sql so suites
-- that boot the workflow schema via SchemaSQL get the same shape. Additive:
--   * parent-link columns on workflow_instances (NULL for every existing row and
--     every top-level start — legacy behaviour unchanged);
--   * a NEW workflow_mi_children fan-in ledger (one row per fan-out child of a
--     multi_instance parent step). As with the other core tables above, RLS is
--     NOT forced here in SchemaSQL (embedding suites issue direct SQL without the
--     SET LOCAL tenant context); the standalone workflow-engine forces RLS on this
--     table via the 000013 versioned migration.
-- ============================================================
ALTER TABLE workflow_instances
    ADD COLUMN IF NOT EXISTS parent_instance_id UUID REFERENCES workflow_instances(id);
ALTER TABLE workflow_instances
    ADD COLUMN IF NOT EXISTS parent_step_id TEXT;
CREATE INDEX IF NOT EXISTS idx_workflow_instances_parent
    ON workflow_instances (parent_instance_id, parent_step_id)
    WHERE parent_instance_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workflow_mi_children (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL,
    parent_instance_id UUID        NOT NULL REFERENCES workflow_instances(id),
    parent_step_id     TEXT        NOT NULL,
    child_index        INT         NOT NULL,
    child_instance_id  UUID        REFERENCES workflow_instances(id),
    status             TEXT        NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'completed', 'failed')),
    output             JSONB,
    error_message      TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_workflow_mi_children_slot
        UNIQUE (parent_instance_id, parent_step_id, child_index)
);
CREATE INDEX IF NOT EXISTS idx_workflow_mi_children_parent
    ON workflow_mi_children (parent_instance_id, parent_step_id);
CREATE INDEX IF NOT EXISTS idx_workflow_mi_children_child
    ON workflow_mi_children (child_instance_id)
    WHERE child_instance_id IS NOT NULL;

-- ============================================================
-- Marketplace (governed template/connector gallery) — migration 000016.
-- Kept cumulative with the versioned migration so embedding suites that
-- bootstrap via SchemaSQL have the same tables. NOT RLS-forced (globals ∪ own),
-- matching the workflow_templates convention. Every statement is idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_marketplace_items (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID,
    kind             TEXT        NOT NULL DEFAULT 'template'
                     CHECK (kind IN ('template', 'connector')),
    key              TEXT        NOT NULL,
    title_i18n       JSONB       NOT NULL DEFAULT '{}',
    description_i18n JSONB       NOT NULL DEFAULT '{}',
    category         TEXT        NOT NULL DEFAULT '',
    tags             JSONB       NOT NULL DEFAULT '[]',
    version          TEXT        NOT NULL DEFAULT '1.0.0',
    version_major    INT         NOT NULL DEFAULT 1,
    version_minor    INT         NOT NULL DEFAULT 0,
    version_patch    INT         NOT NULL DEFAULT 0,
    maturity         TEXT        NOT NULL DEFAULT 'ga'
                     CHECK (maturity IN ('draft', 'beta', 'ga', 'deprecated')),
    publisher        TEXT        NOT NULL DEFAULT '',
    payload          JSONB       NOT NULL DEFAULT '{}',
    source           TEXT        NOT NULL DEFAULT '',
    checksum         TEXT        NOT NULL DEFAULT '',
    published_by     TEXT        NOT NULL DEFAULT '',
    published_at     TIMESTAMPTZ,
    status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published', 'deprecated')),
    reviewed_by      TEXT,
    reviewed_at      TIMESTAMPTZ,
    review_reason    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_marketplace_items_version
    ON workflow_marketplace_items (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, key, version);
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_items_kind
    ON workflow_marketplace_items (kind);
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_items_category
    ON workflow_marketplace_items (category);
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_items_tenant
    ON workflow_marketplace_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_items_global
    ON workflow_marketplace_items (kind, category)
    WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_items_key_semver
    ON workflow_marketplace_items (kind, key, version_major DESC, version_minor DESC, version_patch DESC);

CREATE TABLE IF NOT EXISTS workflow_marketplace_installs (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    marketplace_item_id UUID        NOT NULL,
    kind                TEXT        NOT NULL DEFAULT 'template'
                        CHECK (kind IN ('template', 'connector')),
    item_key            TEXT        NOT NULL DEFAULT '',
    item_version        TEXT        NOT NULL DEFAULT '',
    definition_id       UUID,
    connector_key       TEXT,
    installed_by        TEXT        NOT NULL DEFAULT '',
    installed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_marketplace_installs_item
    ON workflow_marketplace_installs (tenant_id, marketplace_item_id);
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_installs_tenant_key
    ON workflow_marketplace_installs (tenant_id, kind, item_key);
CREATE INDEX IF NOT EXISTS idx_workflow_marketplace_installs_definition
    ON workflow_marketplace_installs (definition_id)
    WHERE definition_id IS NOT NULL;

ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS marketplace_item_id UUID;
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS marketplace_item_version TEXT;

-- ============================================================
-- Transactional event outbox (LOSSLESS non-promotion audit) — migration 000019.
--
-- A lifecycle state transition (complete/fail/cancel/suspend/resume/retry) now
-- stages its workflow.* audit event into this table IN THE SAME TRANSACTION as the
-- state change (repository.CommitInstanceStateWithEvent), so the event commits
-- atomically with the state and the relay delivers it exactly-once to
-- platform.workflow.events — a committed transition can no longer lose its audit
-- event when the broker is down. Kept BYTE-FOR-BYTE in sync with
-- internal/events/outbox/schema.go (schemaDDL) and
-- migrations/platform_core/000015_event_outbox.up.sql so the standalone
-- workflow-engine (which also calls outbox.EnsureSchema at boot) and every
-- embedding suite that boots via SchemaSQL converge on the same table. Every
-- statement is idempotent; NOT RLS-forced (the relay claims cross-tenant and the
-- table carries its own tenant_id column for triage).
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
`

// RunMigration executes all CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT
// EXISTS statements for the workflow engine schema. It is idempotent.
func RunMigration(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, SchemaSQL)
	if err != nil {
		return fmt.Errorf("running workflow schema migration: %w", err)
	}
	return nil
}
