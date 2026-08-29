ALTER TABLE signature_events
    DROP CONSTRAINT IF EXISTS signature_events_event_type_check;

ALTER TABLE signature_events
    ADD CONSTRAINT signature_events_event_type_check CHECK (event_type IN (
        'created', 'sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled', 'custody_recorded'
    ));

CREATE TABLE IF NOT EXISTS signature_custody_evidence (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    envelope_id         UUID        NOT NULL REFERENCES signature_envelopes(id) ON DELETE CASCADE,
    file_id             TEXT        NOT NULL,
    file_name           TEXT        NOT NULL,
    file_size_bytes     BIGINT      NOT NULL CHECK (file_size_bytes >= 0),
    content_hash        TEXT        NOT NULL,
    seal_hash           TEXT,
    evidence_hash       TEXT,
    provider            TEXT        NOT NULL DEFAULT 'native' CHECK (provider IN ('native', 'nafath', 'external')),
    signed_at           TIMESTAMPTZ NOT NULL,
    retention_metadata  JSONB       NOT NULL DEFAULT '{}',
    custody_metadata    JSONB       NOT NULL DEFAULT '{}',
    created_by          UUID        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (btrim(file_id) <> ''),
    CHECK (btrim(file_name) <> ''),
    CHECK (btrim(content_hash) <> ''),
    CHECK (
        (seal_hash IS NOT NULL AND btrim(seal_hash) <> '')
        OR
        (evidence_hash IS NOT NULL AND btrim(evidence_hash) <> '')
    )
);

CREATE INDEX IF NOT EXISTS idx_signature_custody_evidence_envelope
    ON signature_custody_evidence (tenant_id, envelope_id, signed_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signature_custody_evidence_file
    ON signature_custody_evidence (tenant_id, file_id, content_hash);

ALTER TABLE signature_custody_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_custody_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON signature_custody_evidence
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON signature_custody_evidence
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON signature_custody_evidence
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON signature_custody_evidence
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
