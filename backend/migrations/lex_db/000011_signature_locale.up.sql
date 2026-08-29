-- WTQ-SIG-01: make native e-signature bilingual (Arabic/English). Envelopes
-- carry a default language plus Arabic subject/message and bilingual legal
-- consent notices; recipients may override the language per person.
ALTER TABLE signature_envelopes
    ADD COLUMN IF NOT EXISTS language         TEXT NOT NULL DEFAULT 'en'
        CHECK (language IN ('en', 'ar', 'bilingual')),
    ADD COLUMN IF NOT EXISTS subject_ar       TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS message_ar       TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS legal_consent_en TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS legal_consent_ar TEXT NOT NULL DEFAULT '';

ALTER TABLE signature_recipients
    ADD COLUMN IF NOT EXISTS language TEXT
        CHECK (language IS NULL OR language IN ('en', 'ar', 'bilingual'));
