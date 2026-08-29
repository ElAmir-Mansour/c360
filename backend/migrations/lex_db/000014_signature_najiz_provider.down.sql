-- Revert Najiz provider support. Rows already persisted with provider='najiz'
-- would violate the restored constraint, so re-map them to the generic 'external'
-- provider before reinstating the original CHECK set.
UPDATE signature_events SET provider = 'external' WHERE provider = 'najiz';
UPDATE signature_custody_evidence SET provider = 'external' WHERE provider = 'najiz';
UPDATE signature_recipients SET provider = 'external' WHERE provider = 'najiz';
UPDATE signature_envelopes SET provider = 'external' WHERE provider = 'najiz';

ALTER TABLE signature_custody_evidence
    DROP CONSTRAINT IF EXISTS signature_custody_evidence_provider_check;
ALTER TABLE signature_custody_evidence
    ADD CONSTRAINT signature_custody_evidence_provider_check
        CHECK (provider IN ('native', 'nafath', 'external'));

ALTER TABLE signature_events
    DROP CONSTRAINT IF EXISTS signature_events_provider_check;
ALTER TABLE signature_events
    ADD CONSTRAINT signature_events_provider_check
        CHECK (provider IN ('native', 'nafath', 'external'));

ALTER TABLE signature_recipients
    DROP CONSTRAINT IF EXISTS signature_recipients_provider_check;
ALTER TABLE signature_recipients
    ADD CONSTRAINT signature_recipients_provider_check
        CHECK (provider IN ('native', 'nafath', 'external'));

ALTER TABLE signature_envelopes
    DROP CONSTRAINT IF EXISTS signature_envelopes_provider_check;
ALTER TABLE signature_envelopes
    ADD CONSTRAINT signature_envelopes_provider_check
        CHECK (provider IN ('native', 'nafath', 'external'));
