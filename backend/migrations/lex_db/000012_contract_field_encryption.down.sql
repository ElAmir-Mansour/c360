-- Reverse the documentation-only column comments from 000012.
COMMENT ON COLUMN contracts.document_text IS NULL;
COMMENT ON COLUMN contracts.party_b_entity IS NULL;
COMMENT ON COLUMN contracts.party_b_contact IS NULL;
COMMENT ON COLUMN contracts.payment_terms IS NULL;
