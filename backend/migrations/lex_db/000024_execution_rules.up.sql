-- Execution-Rules engine (CAP-022..CAP-029).
--
-- This module owns the per-request execution CLOCK. The clock starts ONLY when
-- the provider confirms a COMPLETE request (every required requirement item
-- satisfied) — at which point a clock-start CloudEvent is emitted for the SLA
-- module to consume. Execution and SLA coordinate via legal_requests columns +
-- events, never by importing each other (no FK from this side into SLA tables).
--
-- Tables:
--   legal_request_execution_state              singleton per request (clock + completeness + review count)
--   legal_request_requirement_item             per-request required attachment/data checklist
--   legal_request_review_round                 return-incomplete review cycles (CAP-025/026)
--   legal_request_delivery_confirmation        post-delivery confirm/deny handshake (CAP-027/028)
--   legal_request_delivery_confirmation_outbox notification outbox (000007 dedup pattern)
--   legal_request_execution_audit_log          append-only audit trail (CAP-024)
--
-- Every table: tenant_id FIRST, tenant-leading partial indexes, ENABLE+FORCE RLS
-- with 4 tenant policies on current_setting('app.current_tenant_id'). The audit
-- log is append-only (INSERT-only RLS: no UPDATE/DELETE policy).

-- =============================================================================
-- legal_request_execution_state — singleton per legal_request
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_request_execution_state (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 UUID        NOT NULL,
    legal_request_id          UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    status                    TEXT        NOT NULL DEFAULT 'awaiting_completeness' CHECK (status IN (
        'awaiting_completeness', 'in_progress', 'delivered', 'returned', 'auto_closed', 'closed'
    )),
    clock_started_at          TIMESTAMPTZ,
    completeness_confirmed_at TIMESTAMPTZ,
    sla_target_seconds        BIGINT      CHECK (sla_target_seconds IS NULL OR sla_target_seconds >= 0),
    working_calendar_id       UUID,
    review_round_count        INT         NOT NULL DEFAULT 0 CHECK (review_round_count >= 0),
    max_review_rounds         INT         NOT NULL DEFAULT 2 CHECK (max_review_rounds >= 1),
    cloned_from_request_id    UUID,
    clone_request_id          UUID,
    delivered_at              TIMESTAMPTZ,
    closed_at                 TIMESTAMPTZ,
    metadata                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by                UUID        NOT NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One execution-state row per request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_request_execution_state_request_unique
    ON legal_request_execution_state (tenant_id, legal_request_id);
CREATE INDEX IF NOT EXISTS idx_legal_request_execution_state_status
    ON legal_request_execution_state (tenant_id, status, updated_at DESC);

ALTER TABLE legal_request_execution_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_execution_state FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_execution_state
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_execution_state
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_request_execution_state
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_request_execution_state
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_request_requirement_item — per-request required attachment/data items
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_request_requirement_item (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    legal_request_id UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    code             TEXT        NOT NULL,
    label            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    kind             TEXT        NOT NULL DEFAULT 'attachment' CHECK (kind IN ('attachment', 'data')),
    required         BOOLEAN     NOT NULL DEFAULT true,
    satisfied        BOOLEAN     NOT NULL DEFAULT false,
    file_id          UUID,
    data_value       TEXT,
    satisfied_by     UUID,
    satisfied_at     TIMESTAMPTZ,
    sort_order       INT         NOT NULL DEFAULT 0,
    metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by       UUID        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Requirement codes are unique within a request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_request_requirement_item_code_unique
    ON legal_request_requirement_item (tenant_id, legal_request_id, code);
CREATE INDEX IF NOT EXISTS idx_legal_request_requirement_item_request
    ON legal_request_requirement_item (tenant_id, legal_request_id, sort_order);
-- Fast completeness check: outstanding required-but-unsatisfied items.
CREATE INDEX IF NOT EXISTS idx_legal_request_requirement_item_outstanding
    ON legal_request_requirement_item (tenant_id, legal_request_id)
    WHERE required AND NOT satisfied;

ALTER TABLE legal_request_requirement_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_requirement_item FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_requirement_item
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_requirement_item
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_request_requirement_item
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_request_requirement_item
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_request_review_round — return-incomplete review cycles (CAP-025/026)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_request_review_round (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    legal_request_id UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    round_no         INT         NOT NULL CHECK (round_no >= 1),
    reason           TEXT        NOT NULL DEFAULT '',
    outcome          TEXT        CHECK (outcome IS NULL OR outcome IN ('accepted', 'returned', 'auto_closed')),
    opened_by        UUID        NOT NULL,
    opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_by        UUID,
    closed_at        TIMESTAMPTZ,
    metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Round numbers are unique within a request (1, 2, ...).
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_request_review_round_no_unique
    ON legal_request_review_round (tenant_id, legal_request_id, round_no);
CREATE INDEX IF NOT EXISTS idx_legal_request_review_round_request
    ON legal_request_review_round (tenant_id, legal_request_id, opened_at DESC);

ALTER TABLE legal_request_review_round ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_review_round FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_review_round
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_review_round
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_request_review_round
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_request_review_round
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_request_delivery_confirmation — confirm/deny handshake (CAP-027/028)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_request_delivery_confirmation (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    legal_request_id UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    status           TEXT        NOT NULL DEFAULT 'requested' CHECK (status IN (
        'requested', 'confirmed', 'denied', 'expired'
    )),
    requested_by     UUID        NOT NULL,
    requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    auto_close_at    TIMESTAMPTZ NOT NULL,
    responded_by     UUID,
    responded_at     TIMESTAMPTZ,
    response_note    TEXT,
    metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by       UUID        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one OPEN ('requested') confirmation per request at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_request_delivery_confirmation_open_unique
    ON legal_request_delivery_confirmation (tenant_id, legal_request_id)
    WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS idx_legal_request_delivery_confirmation_request
    ON legal_request_delivery_confirmation (tenant_id, legal_request_id, requested_at DESC);
-- Sweeper index: open confirmations ordered by their auto-close deadline.
CREATE INDEX IF NOT EXISTS idx_legal_request_delivery_confirmation_autoclose
    ON legal_request_delivery_confirmation (tenant_id, auto_close_at)
    WHERE status = 'requested';

ALTER TABLE legal_request_delivery_confirmation ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_delivery_confirmation FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_delivery_confirmation
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_delivery_confirmation
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_request_delivery_confirmation
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_request_delivery_confirmation
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_request_delivery_confirmation_outbox — notification outbox (000007)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_request_delivery_confirmation_outbox (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    legal_request_id    UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    confirmation_id     UUID        NOT NULL REFERENCES legal_request_delivery_confirmation(id) ON DELETE CASCADE,
    event_id            UUID        NOT NULL,
    event_type          TEXT        NOT NULL CHECK (event_type IN ('delivery_confirmation_requested', 'delivery_confirmation_reminder')),
    channel             TEXT        NOT NULL CHECK (channel IN ('email', 'calendar', 'in_app')),
    recipient_user_id   UUID,
    recipient_name      TEXT        NOT NULL DEFAULT '',
    recipient_contact   TEXT,
    scheduled_at        TIMESTAMPTZ NOT NULL,
    scheduled_date      DATE        NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_legal_request_delivery_confirmation_outbox_status
    ON legal_request_delivery_confirmation_outbox (tenant_id, status, scheduled_at, created_at);
CREATE INDEX IF NOT EXISTS idx_legal_request_delivery_confirmation_outbox_confirmation
    ON legal_request_delivery_confirmation_outbox (tenant_id, confirmation_id, created_at DESC);

-- Dedup: one active (pending|sent) notification per (confirmation, channel, day).
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_request_delivery_confirmation_outbox_active_unique
    ON legal_request_delivery_confirmation_outbox (tenant_id, confirmation_id, channel, scheduled_date)
    WHERE status IN ('pending', 'sent');

ALTER TABLE legal_request_delivery_confirmation_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_delivery_confirmation_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_delivery_confirmation_outbox
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_delivery_confirmation_outbox
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_request_delivery_confirmation_outbox
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_request_delivery_confirmation_outbox
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_request_execution_audit_log — append-only audit trail (CAP-024)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_request_execution_audit_log (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    legal_request_id UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    action           TEXT        NOT NULL,
    from_status      TEXT,
    to_status        TEXT,
    detail           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id    UUID        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_request_execution_audit_log_request
    ON legal_request_execution_audit_log (tenant_id, legal_request_id, created_at ASC);

ALTER TABLE legal_request_execution_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_execution_audit_log FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation + insert ONLY. No UPDATE/DELETE policies so the
-- execution audit trail is immutable (CAP-024).
CREATE POLICY tenant_isolation ON legal_request_execution_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_execution_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- NOTE: no reference/seed data. Execution-rules tables are purely per-request
-- operational state, materialized at runtime from the request spine + the
-- service-catalog required-attachment config. There is nothing tenant-scoped to
-- seed here (the AI-governance "loop over tenants" convention does not apply to
-- per-request operational tables).
