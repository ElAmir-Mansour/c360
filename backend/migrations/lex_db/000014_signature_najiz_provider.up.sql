-- Najiz (Saudi MOJ e-sign portal) provider support for FR-WATHEEQ-004.
-- Adds 'najiz' to the signature provider CHECK constraints across the envelope,
-- recipient, event, and custody tables so a Najiz-issued envelope, its recipient
-- rows, provider events, and signed-file custody records all persist under the
-- existing RLS-protected schema. No new columns are introduced: Najiz reuses the
-- generic provider/provider_event/custody data shapes already in place.

ALTER TABLE signature_envelopes
    DROP CONSTRAINT IF EXISTS signature_envelopes_provider_check;
ALTER TABLE signature_envelopes
    ADD CONSTRAINT signature_envelopes_provider_check
        CHECK (provider IN ('native', 'nafath', 'najiz', 'external'));

ALTER TABLE signature_recipients
    DROP CONSTRAINT IF EXISTS signature_recipients_provider_check;
ALTER TABLE signature_recipients
    ADD CONSTRAINT signature_recipients_provider_check
        CHECK (provider IN ('native', 'nafath', 'najiz', 'external'));

ALTER TABLE signature_events
    DROP CONSTRAINT IF EXISTS signature_events_provider_check;
ALTER TABLE signature_events
    ADD CONSTRAINT signature_events_provider_check
        CHECK (provider IN ('native', 'nafath', 'najiz', 'external'));

ALTER TABLE signature_custody_evidence
    DROP CONSTRAINT IF EXISTS signature_custody_evidence_provider_check;
ALTER TABLE signature_custody_evidence
    ADD CONSTRAINT signature_custody_evidence_provider_check
        CHECK (provider IN ('native', 'nafath', 'najiz', 'external'));
