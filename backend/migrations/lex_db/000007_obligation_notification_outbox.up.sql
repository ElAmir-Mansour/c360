CREATE TABLE IF NOT EXISTS legal_obligation_notification_outbox (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    obligation_id       UUID        NOT NULL REFERENCES legal_obligations(id) ON DELETE CASCADE,
    event_id            UUID        NOT NULL,
    event_type          TEXT        NOT NULL CHECK (event_type IN ('reminder', 'escalation')),
    lead_days           INT         NOT NULL DEFAULT 0 CHECK (lead_days >= 0 AND lead_days <= 3650),
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

CREATE INDEX IF NOT EXISTS idx_legal_obligation_notification_outbox_status
    ON legal_obligation_notification_outbox (tenant_id, status, scheduled_at, created_at);
CREATE INDEX IF NOT EXISTS idx_legal_obligation_notification_outbox_obligation
    ON legal_obligation_notification_outbox (tenant_id, obligation_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_obligation_notification_outbox_active_unique
    ON legal_obligation_notification_outbox (tenant_id, obligation_id, channel, scheduled_date)
    WHERE status IN ('pending', 'sent');

ALTER TABLE legal_obligation_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_obligation_notification_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_obligation_notification_outbox
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_obligation_notification_outbox
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_obligation_notification_outbox
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_obligation_notification_outbox
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
