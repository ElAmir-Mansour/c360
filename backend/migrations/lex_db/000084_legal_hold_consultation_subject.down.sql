-- Revert 000084: narrow the legal-hold subject_type CHECK back to the original
-- three values. Any 'consultation' holds must be released/removed first or this
-- will fail (the constraint is validated against existing rows).
ALTER TABLE legal_holds DROP CONSTRAINT IF EXISTS legal_holds_subject_type_check;

ALTER TABLE legal_holds
    ADD CONSTRAINT legal_holds_subject_type_check
    CHECK (subject_type IN ('contract', 'matter', 'document'));
