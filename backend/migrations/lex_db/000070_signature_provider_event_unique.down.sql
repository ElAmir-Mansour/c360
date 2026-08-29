-- Revert GAP 3: restore the original NON-unique partial dedup index.
-- The de-duplication of rows in the up migration is NOT reversible (deleted
-- duplicate rows are gone); only the index uniqueness is rolled back here.

DROP INDEX IF EXISTS idx_signature_events_provider_event;

CREATE INDEX IF NOT EXISTS idx_signature_events_provider_event
    ON signature_events (tenant_id, provider, provider_event_id)
    WHERE provider_event_id IS NOT NULL;
