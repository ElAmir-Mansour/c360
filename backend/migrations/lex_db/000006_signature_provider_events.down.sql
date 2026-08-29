DROP INDEX IF EXISTS idx_signature_events_provider_recipient;
DROP INDEX IF EXISTS idx_signature_events_provider_envelope;
DROP INDEX IF EXISTS idx_signature_events_provider_event;

ALTER TABLE signature_events
    DROP COLUMN IF EXISTS provider_recipient_id,
    DROP COLUMN IF EXISTS provider_envelope_id,
    DROP COLUMN IF EXISTS provider_event_id,
    DROP COLUMN IF EXISTS provider_status,
    DROP COLUMN IF EXISTS provider;
