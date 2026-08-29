DROP TABLE IF EXISTS signature_custody_evidence;

ALTER TABLE signature_events
    DROP CONSTRAINT IF EXISTS signature_events_event_type_check;

ALTER TABLE signature_events
    ADD CONSTRAINT signature_events_event_type_check CHECK (event_type IN (
        'created', 'sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled'
    ));
