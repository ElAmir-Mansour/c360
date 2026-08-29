-- 000084: register "consultation" as a legal-hold subject type.
--
-- The consultation service has always used subject_type = 'consultation' for its
-- legal-hold guards and the GET /consultations/{id}/legal-hold status endpoint,
-- but the original CHECK (migration 000015) only admitted contract/matter/document.
-- The result: hold creation on a consultation was rejected by the constraint and
-- the status endpoint 500'd (model Valid() rejected the value). Widen the CHECK so
-- the value the code already emits is a first-class, insertable subject type.
ALTER TABLE legal_holds DROP CONSTRAINT IF EXISTS legal_holds_subject_type_check;

ALTER TABLE legal_holds
    ADD CONSTRAINT legal_holds_subject_type_check
    CHECK (subject_type IN ('contract', 'matter', 'document', 'consultation'));
