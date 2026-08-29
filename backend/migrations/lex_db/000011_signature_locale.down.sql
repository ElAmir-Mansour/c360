ALTER TABLE signature_recipients
    DROP COLUMN IF EXISTS language;

ALTER TABLE signature_envelopes
    DROP COLUMN IF EXISTS language,
    DROP COLUMN IF EXISTS subject_ar,
    DROP COLUMN IF EXISTS message_ar,
    DROP COLUMN IF EXISTS legal_consent_en,
    DROP COLUMN IF EXISTS legal_consent_ar;
