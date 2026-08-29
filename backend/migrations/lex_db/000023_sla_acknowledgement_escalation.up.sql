-- SLA, Acknowledgement & Escalation (CAP-012, CAP-013, CAP-014, CAP-016, CAP-017,
-- CAP-018, CAP-019).
--
-- legal_sla_targets       : admin per-(service_code, priority) SLA policy catalogue.
-- legal_sla_clocks        : per-request materialised ack + turnaround + L1/L2/L3
--                           escalation deadlines (computed via calendar.Calculator).
-- legal_sla_notification_outbox : append-only outbox (mirrors 000007) with status
--                           machine + partial-unique dedup so the idempotent
--                           sla_monitor never double-emits ack/breach/escalation.
--
-- SLA owns sla_clocks/breach/escalation; Execution owns clock_started_at and
-- materialises a clock by signalling completeness (no cross-package import; the
-- coupling is through legal_requests columns + CloudEvents).

-- ---------------------------------------------------------------------------
-- legal_sla_targets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_sla_targets (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID        NOT NULL,
    service_code            TEXT        NOT NULL,
    priority                TEXT        NOT NULL CHECK (priority IN ('urgent', 'normal')),
    turnaround_working_days INT         NOT NULL DEFAULT 0 CHECK (turnaround_working_days >= 0 AND turnaround_working_days <= 3650),
    ack_window_value        INT         NOT NULL DEFAULT 0 CHECK (ack_window_value >= 0 AND ack_window_value <= 3650),
    ack_window_unit         TEXT        NOT NULL DEFAULT 'working_days' CHECK (ack_window_unit IN ('working_days', 'working_hours')),
    escalation_l1_days      INT         NOT NULL DEFAULT 2 CHECK (escalation_l1_days = 2),
    escalation_l2_days      INT         NOT NULL DEFAULT 4 CHECK (escalation_l2_days = 4),
    escalation_l3_days      INT         NOT NULL DEFAULT 6 CHECK (escalation_l3_days = 6),
    active                  BOOLEAN     NOT NULL DEFAULT true,
    metadata                JSONB       NOT NULL DEFAULT '{}',
    created_by              UUID        NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,
    CHECK (
        (priority = 'urgent' AND ack_window_unit = 'working_hours' AND ack_window_value BETWEEN 0 AND 4)
        OR
        (priority = 'normal' AND ack_window_unit = 'working_days' AND ack_window_value BETWEEN 0 AND 1)
    ),
    CHECK (escalation_l1_days = 2 AND escalation_l2_days = 4 AND escalation_l3_days = 6)
);

-- One active target per (service_code, priority) per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_sla_targets_code_priority_unique
    ON legal_sla_targets (tenant_id, lower(service_code), priority)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_sla_targets_tenant
    ON legal_sla_targets (tenant_id, active, updated_at DESC)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- legal_sla_clocks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_sla_clocks (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    legal_request_id      UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    sla_target_id         UUID        REFERENCES legal_sla_targets(id) ON DELETE SET NULL,
    service_code          TEXT        NOT NULL,
    priority              TEXT        NOT NULL CHECK (priority IN ('urgent', 'normal')),
    beneficiary_entity_id UUID,
    -- clock_started_at is OWNED by Execution (recorded here at materialisation).
    clock_started_at      TIMESTAMPTZ NOT NULL,
    ack_due_at            TIMESTAMPTZ NOT NULL,
    turnaround_due_at     TIMESTAMPTZ NOT NULL,
    escalation_l1_due_at  TIMESTAMPTZ NOT NULL,
    escalation_l2_due_at  TIMESTAMPTZ NOT NULL,
    escalation_l3_due_at  TIMESTAMPTZ NOT NULL,
    ack_done              BOOLEAN     NOT NULL DEFAULT false,
    ack_done_at           TIMESTAMPTZ,
    escalation_level      INT         NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3),
    breached              BOOLEAN     NOT NULL DEFAULT false,
    breached_at           TIMESTAMPTZ,
    outcome               TEXT        NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'on_time', 'breached')),
    resolved_at           TIMESTAMPTZ,
    metadata              JSONB       NOT NULL DEFAULT '{}',
    created_by            UUID        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one clock per request (idempotent re-materialisation via ON CONFLICT).
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_sla_clocks_request_unique
    ON legal_sla_clocks (tenant_id, legal_request_id);
-- Monitor scan: unresolved clocks ordered by the next deadline.
CREATE INDEX IF NOT EXISTS idx_legal_sla_clocks_due
    ON legal_sla_clocks (tenant_id, turnaround_due_at)
    WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_sla_clocks_ack_due
    ON legal_sla_clocks (tenant_id, ack_due_at)
    WHERE resolved_at IS NULL AND ack_done = false;

-- ---------------------------------------------------------------------------
-- legal_sla_notification_outbox  (append-only, mirrors 000007)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_sla_notification_outbox (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    sla_clock_id        UUID        NOT NULL REFERENCES legal_sla_clocks(id) ON DELETE CASCADE,
    legal_request_id    UUID        NOT NULL,
    event_id            UUID        NOT NULL,
    event_type          TEXT        NOT NULL CHECK (event_type IN ('ack_due', 'breach', 'escalation')),
    escalation_level    INT         NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3),
    channel             TEXT        NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'calendar', 'in_app')),
    recipient_user_id   UUID,
    recipient_name      TEXT        NOT NULL DEFAULT '',
    recipient_contact   TEXT,
    scheduled_at        TIMESTAMPTZ NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    provider            TEXT        NOT NULL DEFAULT '',
    provider_message_id TEXT,
    provider_metadata   JSONB       NOT NULL DEFAULT '{}',
    error_message       TEXT,
    attempt_count       INT         NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at     TIMESTAMPTZ,
    sent_at             TIMESTAMPTZ,
    created_by          UUID        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_sla_notification_outbox_status
    ON legal_sla_notification_outbox (tenant_id, status, scheduled_at, created_at);
CREATE INDEX IF NOT EXISTS idx_legal_sla_notification_outbox_clock
    ON legal_sla_notification_outbox (tenant_id, sla_clock_id, created_at DESC);

-- Dedup: at most one live ack/breach/escalation row per (clock, type, level) so the
-- idempotent monitor never double-queues a notification (mirrors 000007 partial-unique).
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_sla_notification_outbox_active_unique
    ON legal_sla_notification_outbox (tenant_id, sla_clock_id, event_type, escalation_level)
    WHERE status IN ('pending', 'sent');

-- ---------------------------------------------------------------------------
-- Row-Level Security (ENABLE + FORCE + 4 policies on app.current_tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE legal_sla_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_sla_targets FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_sla_targets
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_sla_targets
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_sla_targets
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_sla_targets
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE legal_sla_clocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_sla_clocks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_sla_clocks
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_sla_clocks
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_sla_clocks
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_sla_clocks
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE legal_sla_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_sla_notification_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_sla_notification_outbox
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_sla_notification_outbox
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_sla_notification_outbox
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_sla_notification_outbox
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- Seed default SLA targets per Service Catalog & SLA sheet (CAP-012).
-- Seeds are applied to ALL existing tenants (AI-governance seeding convention).
-- Guarded by to_regclass because lex_db may not host a tenants table; when absent
-- (separate DB), targets are provisioned per-tenant via the admin API instead.
-- The conservative end of each documented working-day range is used as the SLA.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    seed_tenant UUID;
    seed_row    RECORD;
    seed_actor  UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    IF to_regclass('public.tenants') IS NULL THEN
        RAISE NOTICE 'tenants table absent in lex_db; skipping SLA target seed (provision per-tenant via API)';
        RETURN;
    END IF;

    FOR seed_tenant IN SELECT id FROM tenants LOOP
        FOR seed_row IN
            SELECT * FROM (VALUES
                ('legal_consultation', 'urgent', 4,  4, 'working_hours'),
                ('legal_consultation', 'normal', 6,  1, 'working_days'),
                ('contract_review',    'urgent', 3,  4, 'working_hours'),
                ('contract_review',    'normal', 5,  1, 'working_days'),
                ('contract_drafting',  'urgent', 5,  4, 'working_hours'),
                ('contract_drafting',  'normal', 8,  1, 'working_days'),
                ('legal_opinion',      'urgent', 4,  4, 'working_hours'),
                ('legal_opinion',      'normal', 7,  1, 'working_days'),
                ('regulatory_compliance', 'urgent', 4, 4, 'working_hours'),
                ('regulatory_compliance', 'normal', 7, 1, 'working_days'),
                ('power_of_attorney',   'urgent', 3,  4, 'working_hours'),
                ('power_of_attorney',   'normal', 5,  1, 'working_days'),
                ('litigation_support', 'urgent', 3,  4, 'working_hours'),
                ('litigation_support', 'normal', 6,  1, 'working_days'),
                ('general_legal_request', 'urgent', 5, 4, 'working_hours'),
                ('general_legal_request', 'normal', 8, 1, 'working_days')
            ) AS v(service_code, priority, turnaround_days, ack_value, ack_unit)
        LOOP
            INSERT INTO legal_sla_targets (
                tenant_id, service_code, priority, turnaround_working_days,
                ack_window_value, ack_window_unit,
                escalation_l1_days, escalation_l2_days, escalation_l3_days,
                active, created_by
            ) VALUES (
                seed_tenant, seed_row.service_code, seed_row.priority, seed_row.turnaround_days,
                seed_row.ack_value, seed_row.ack_unit,
                2, 4, 6,
                true, seed_actor
            )
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;
