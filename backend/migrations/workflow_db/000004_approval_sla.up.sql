-- =============================================================================
-- WP-5 — Approval chains + multi-level SLA/escalation + working-hours.
--
-- Two NEW, RLS-aware tables backing the WP-5 feature set (Design §3.4):
--
--   workflow_sla_policies — definition-level tiered escalation policies
--                           (tiers + reminder cadence), referenced by an
--                           approval_chain / human_task step.
--   workflow_calendars    — per-tenant business calendars (working windows +
--                           holidays + timezone) used by BusinessDeadline.
--
-- Unlike the original workflow_* tables (000001), which are intentionally NOT
-- RLS-forced because their repositories are not yet RunWithTenant-aware, these
-- tables are built RLS-aware from day one and therefore carry FULL per-operation
-- Row-Level Security: SELECT/INSERT/UPDATE/DELETE policies, each with an
-- app.bypass_rls backstop so background workers (scheduler / outbox relay) can
-- operate cross-tenant via SET LOCAL app.bypass_rls = 'on'.
--
-- The application must SET LOCAL app.current_tenant_id = '<uuid>' within each
-- request transaction. The migration role must have BYPASSRLS.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Workflow SLA Policies
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_sla_policies (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    name          TEXT        NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    -- definition_id is nullable so a policy can be reusable (tenant-wide) or
    -- pinned to a specific definition lineage. No FK: definitions live in the
    -- same DB but a policy may outlive a soft-deleted definition.
    definition_id UUID,
    -- tiers: ordered JSON array of {after_seconds, notify, action}.
    --   action ∈ notify | reassign | escalate.
    tiers         JSONB       NOT NULL DEFAULT '[]',
    -- remind_before: JSON array of seconds-before-breach reminder offsets.
    remind_before JSONB       NOT NULL DEFAULT '[]',
    -- calendar_id: optional business calendar used to interpret tier offsets in
    -- business time. NULL means 24x7 (wall-clock) interpretation.
    calendar_id   UUID,
    created_by    UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workflow_sla_policies_tenant
    ON workflow_sla_policies (tenant_id);

CREATE INDEX IF NOT EXISTS idx_workflow_sla_policies_tenant_definition
    ON workflow_sla_policies (tenant_id, definition_id)
    WHERE deleted_at IS NULL;

ALTER TABLE workflow_sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_sla_policies FORCE ROW LEVEL SECURITY;

-- DROP-then-CREATE keeps the migration idempotent (re-appliable as a no-op),
-- matching the workflow_db convention established in 000001 — Postgres has no
-- CREATE POLICY IF NOT EXISTS.
DROP POLICY IF EXISTS tenant_isolation ON workflow_sla_policies;
CREATE POLICY tenant_isolation ON workflow_sla_policies
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_insert ON workflow_sla_policies;
CREATE POLICY tenant_insert ON workflow_sla_policies
    FOR INSERT
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_update ON workflow_sla_policies;
CREATE POLICY tenant_update ON workflow_sla_policies
    FOR UPDATE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_delete ON workflow_sla_policies;
CREATE POLICY tenant_delete ON workflow_sla_policies
    FOR DELETE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );

-- ============================================================
-- Workflow Calendars (business / working-hours calendars)
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_calendars (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    -- timezone: IANA location name (e.g. "Asia/Riyadh"). Windows + holidays are
    -- interpreted in this zone.
    timezone    TEXT        NOT NULL DEFAULT 'UTC',
    -- working_days: JSON object keyed by weekday (0=Sunday..6=Saturday) mapping
    -- to {start_minute, end_minute} minutes-since-local-midnight. Absent days
    -- are non-working.
    working_days JSONB      NOT NULL DEFAULT '{}',
    -- holidays: JSON array of "YYYY-MM-DD" full-day holidays in `timezone`.
    holidays     JSONB      NOT NULL DEFAULT '[]',
    -- is_default: at most one default calendar per tenant; used when a policy
    -- references no explicit calendar.
    is_default   BOOLEAN    NOT NULL DEFAULT false,
    created_by   UUID       NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ,
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workflow_calendars_tenant
    ON workflow_calendars (tenant_id);

-- A tenant may have at most one default calendar (among live rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_calendars_tenant_default
    ON workflow_calendars (tenant_id)
    WHERE is_default = true AND deleted_at IS NULL;

ALTER TABLE workflow_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_calendars FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON workflow_calendars;
CREATE POLICY tenant_isolation ON workflow_calendars
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_insert ON workflow_calendars;
CREATE POLICY tenant_insert ON workflow_calendars
    FOR INSERT
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_update ON workflow_calendars;
CREATE POLICY tenant_update ON workflow_calendars
    FOR UPDATE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_delete ON workflow_calendars;
CREATE POLICY tenant_delete ON workflow_calendars
    FOR DELETE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );

-- Optional soft FK: an SLA policy's calendar must belong to the same tenant.
-- Enforced at the application layer (cross-table RLS validation is brittle); the
-- index above keeps lookups fast.
