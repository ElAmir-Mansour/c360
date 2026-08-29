CREATE TABLE IF NOT EXISTS signature_envelopes (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    target_type         TEXT        NOT NULL CHECK (target_type IN ('contract', 'document')),
    contract_id         UUID        REFERENCES contracts(id) ON DELETE CASCADE,
    document_id         UUID        REFERENCES legal_documents(id) ON DELETE CASCADE,
    title               TEXT        NOT NULL,
    subject             TEXT        NOT NULL DEFAULT '',
    message             TEXT        NOT NULL DEFAULT '',
    status              TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled'
    )),
    provider            TEXT        NOT NULL DEFAULT 'native' CHECK (provider IN ('native', 'nafath', 'external')),
    method              TEXT        NOT NULL DEFAULT 'otp' CHECK (method IN ('otp', 'nafath', 'certificate', 'wet_signature')),
    due_at              TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    sent_at             TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        UUID,
    cancellation_reason TEXT,
    evidence_hash       TEXT,
    evidence_metadata   JSONB       NOT NULL DEFAULT '{}',
    created_by          UUID        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    CHECK (
        (target_type = 'contract' AND contract_id IS NOT NULL AND document_id IS NULL)
        OR
        (target_type = 'document' AND document_id IS NOT NULL AND contract_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_signature_envelopes_tenant_status
    ON signature_envelopes (tenant_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_signature_envelopes_contract
    ON signature_envelopes (tenant_id, contract_id)
    WHERE contract_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_signature_envelopes_document
    ON signature_envelopes (tenant_id, document_id)
    WHERE document_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_signature_envelopes_expiry
    ON signature_envelopes (tenant_id, expires_at)
    WHERE expires_at IS NOT NULL AND status IN ('sent', 'viewed') AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS signature_recipients (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    envelope_id           UUID        NOT NULL REFERENCES signature_envelopes(id) ON DELETE CASCADE,
    user_id               UUID,
    name                  TEXT        NOT NULL,
    email                 TEXT,
    phone                 TEXT,
    role                  TEXT        NOT NULL DEFAULT 'signer' CHECK (role IN ('signer', 'approver', 'carbon_copy')),
    status                TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled'
    )),
    provider              TEXT        NOT NULL DEFAULT 'native' CHECK (provider IN ('native', 'nafath', 'external')),
    method                TEXT        NOT NULL DEFAULT 'otp' CHECK (method IN ('otp', 'nafath', 'certificate', 'wet_signature')),
    signing_order         INT         NOT NULL DEFAULT 1 CHECK (signing_order >= 0),
    provider_recipient_id TEXT,
    viewed_at             TIMESTAMPTZ,
    signed_at             TIMESTAMPTZ,
    declined_at           TIMESTAMPTZ,
    decline_reason        TEXT,
    evidence_hash         TEXT,
    evidence_metadata     JSONB       NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (email IS NOT NULL OR phone IS NOT NULL OR user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_signature_recipients_envelope
    ON signature_recipients (tenant_id, envelope_id, signing_order, created_at);
CREATE INDEX IF NOT EXISTS idx_signature_recipients_user
    ON signature_recipients (tenant_id, user_id, status)
    WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signature_events (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    envelope_id       UUID        NOT NULL REFERENCES signature_envelopes(id) ON DELETE CASCADE,
    recipient_id      UUID        REFERENCES signature_recipients(id) ON DELETE SET NULL,
    event_type        TEXT        NOT NULL CHECK (event_type IN (
        'created', 'sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled'
    )),
    actor_user_id     UUID,
    actor_name        TEXT,
    actor_email       TEXT,
    ip_address        TEXT,
    user_agent        TEXT,
    evidence_hash     TEXT,
    evidence_metadata JSONB       NOT NULL DEFAULT '{}',
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signature_events_envelope
    ON signature_events (tenant_id, envelope_id, occurred_at, created_at);
CREATE INDEX IF NOT EXISTS idx_signature_events_recipient
    ON signature_events (tenant_id, recipient_id)
    WHERE recipient_id IS NOT NULL;

ALTER TABLE signature_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_envelopes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON signature_envelopes
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON signature_envelopes
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON signature_envelopes
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON signature_envelopes
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE signature_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_recipients FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON signature_recipients
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON signature_recipients
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON signature_recipients
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON signature_recipients
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE signature_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON signature_events
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON signature_events
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON signature_events
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON signature_events
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
