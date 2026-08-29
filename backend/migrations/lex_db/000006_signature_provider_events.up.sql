ALTER TABLE signature_events
    ADD COLUMN IF NOT EXISTS provider TEXT CHECK (provider IN ('native', 'nafath', 'external')),
    ADD COLUMN IF NOT EXISTS provider_status TEXT,
    ADD COLUMN IF NOT EXISTS provider_event_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_envelope_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_recipient_id TEXT;

CREATE INDEX IF NOT EXISTS idx_signature_events_provider_event
    ON signature_events (tenant_id, provider, provider_event_id)
    WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signature_events_provider_envelope
    ON signature_events (tenant_id, provider, provider_envelope_id)
    WHERE provider_envelope_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signature_events_provider_recipient
    ON signature_events (tenant_id, provider, provider_recipient_id)
    WHERE provider_recipient_id IS NOT NULL;
