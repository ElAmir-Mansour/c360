-- Notification Triggers + in-app inbox (CAP-156..164).
--
-- lex_notification_inbox        : durable, per-recipient in-app inbox. The lex
--                                 consumer (request/case/judgment events) and the
--                                 ProximityMonitor (hearing reminders) write rows
--                                 here directly — the lex-side alternative to the
--                                 platform notification-service RuleEngine. Email
--                                 copies are fanned out through the shared
--                                 obligation-reminder dispatcher seam (CAP-157), so
--                                 NO new channel table is introduced.
-- lex_notification_subscription : per-user (category, channel) opt-out overrides.
-- lex_hearing_proximity_marker  : append-only dedup ledger so the idempotent
--                                 ProximityMonitor reminds at most once per
--                                 (hearing, horizon).
--
-- Multitenancy: tenant_id is the FIRST column; every table carries ENABLE + FORCE
-- RLS with the 4-policy app.current_tenant_id template; partial-unique dedup
-- indexes mirror the SLA/obligation outbox idiom (000007/000023). Bilingual
-- title/body are JSONB (forms.LocalizedText). Soft-delete via deleted_at on the
-- inbox. Seeds loop over tenants (AI-governance seeding convention).

-- ---------------------------------------------------------------------------
-- lex_notification_inbox
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_notification_inbox (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    recipient_id UUID        NOT NULL,
    category     TEXT        NOT NULL DEFAULT 'general' CHECK (category IN (
        'request', 'case', 'hearing', 'judgment', 'contract', 'general'
    )),
    title        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    body         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- LOOSE reference to the originating resource (no hard FK so the inbox row
    -- survives source soft-deletes).
    entity_type  TEXT,
    entity_id    UUID,
    action_url   TEXT,
    -- Originating CloudEvents id (NULL for monitor-authored rows).
    event_id     UUID,
    -- Idempotency key; NULL rows are never deduped.
    dedup_key    TEXT,
    metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    read_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);

-- Inbox list scan: a recipient's rows newest-first.
CREATE INDEX IF NOT EXISTS idx_lex_notification_inbox_recipient
    ON lex_notification_inbox (tenant_id, recipient_id, created_at DESC)
    WHERE deleted_at IS NULL;
-- Unread-badge scan.
CREATE INDEX IF NOT EXISTS idx_lex_notification_inbox_unread
    ON lex_notification_inbox (tenant_id, recipient_id)
    WHERE read_at IS NULL AND deleted_at IS NULL;
-- Category filter.
CREATE INDEX IF NOT EXISTS idx_lex_notification_inbox_category
    ON lex_notification_inbox (tenant_id, recipient_id, category, created_at DESC)
    WHERE deleted_at IS NULL;
-- Dedup: at most one live row per (recipient, dedup_key) so a re-fired
-- event/monitor pass is swallowed (mirrors 000007/000023 partial-unique dedup).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_notification_inbox_dedup
    ON lex_notification_inbox (tenant_id, recipient_id, dedup_key)
    WHERE dedup_key IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- lex_notification_subscription  (per-user opt-out overrides)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_notification_subscription (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL,
    user_id    UUID        NOT NULL,
    category   TEXT        NOT NULL CHECK (category IN (
        'request', 'case', 'hearing', 'judgment', 'contract', 'general'
    )),
    channel    TEXT        NOT NULL CHECK (channel IN ('in_app', 'email')),
    enabled    BOOLEAN     NOT NULL DEFAULT true,
    created_by UUID        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Natural key for the Upsert ON CONFLICT target.
    CONSTRAINT uq_lex_notification_subscription_natural UNIQUE (tenant_id, user_id, category, channel)
);

CREATE INDEX IF NOT EXISTS idx_lex_notification_subscription_user
    ON lex_notification_subscription (tenant_id, user_id);

-- ---------------------------------------------------------------------------
-- lex_hearing_proximity_marker  (append-only dedup ledger, CAP-162)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_hearing_proximity_marker (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    case_id      UUID        NOT NULL,
    hearing_id   UUID        NOT NULL,
    horizon_days INT         NOT NULL CHECK (horizon_days >= 0),
    hearing_date TIMESTAMPTZ NOT NULL,
    fired_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   UUID        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Dedup: at most one marker per (hearing, horizon) so the monitor reminds once.
    CONSTRAINT uq_lex_hearing_proximity_marker UNIQUE (tenant_id, hearing_id, horizon_days)
);

CREATE INDEX IF NOT EXISTS idx_lex_hearing_proximity_marker_case
    ON lex_hearing_proximity_marker (tenant_id, case_id, hearing_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security (ENABLE + FORCE + 4 policies on app.current_tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE lex_notification_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_notification_inbox FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_notification_inbox
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_notification_inbox
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_notification_inbox
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_notification_inbox
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE lex_notification_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_notification_subscription FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_notification_subscription
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_notification_subscription
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_notification_subscription
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_notification_subscription
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE lex_hearing_proximity_marker ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_hearing_proximity_marker FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_hearing_proximity_marker
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_hearing_proximity_marker
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_hearing_proximity_marker
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_hearing_proximity_marker
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- Seed: default notification subscriptions are OPT-OUT (absence of a row =>
-- channel enabled), so there is NOTHING to seed for the opt-out model. The DO
-- block is retained to assert the tenants-table guard convention and to make the
-- intentional no-op explicit for future maintainers; if the product later moves
-- to opt-IN defaults, seed per-tenant enabled=true rows here (loop over tenants).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.tenants') IS NULL THEN
        RAISE NOTICE 'tenants table absent in lex_db; notification subscriptions use opt-out defaults (no seed needed)';
        RETURN;
    END IF;
    -- Opt-out model: no default rows. Intentional no-op.
    RAISE NOTICE 'lex_notification_subscription uses opt-out defaults; no seed rows inserted';
END $$;
