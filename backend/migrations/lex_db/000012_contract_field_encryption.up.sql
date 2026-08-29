-- WTQ-SEC-04 (at-rest, lex portion): sensitive contract fields are encrypted at
-- the application layer with AES-256-GCM, stored as "enc:v1:<base64>" strings.
-- The affected columns are already TEXT (unbounded), so no type change is
-- required; ciphertext is longer than plaintext but fits. This migration only
-- records the at-rest encryption contract via column comments so operators and
-- future readers understand why these columns may contain opaque ciphertext.
-- Reads remain backward compatible: values without the "enc:v1:" prefix are
-- treated as legacy plaintext.

COMMENT ON COLUMN contracts.document_text IS
    'Contract body text. May be encrypted at rest (enc:v1: prefix, AES-256-GCM) when LEX_CONTRACT_FIELD_ENCRYPTION_MODE=software. Legacy plaintext values (no prefix) read transparently.';
COMMENT ON COLUMN contracts.party_b_entity IS
    'Counterparty legal entity (PII). May be encrypted at rest (enc:v1: prefix).';
COMMENT ON COLUMN contracts.party_b_contact IS
    'Counterparty contact details (PII). May be encrypted at rest (enc:v1: prefix).';
COMMENT ON COLUMN contracts.payment_terms IS
    'Commercially sensitive payment terms. May be encrypted at rest (enc:v1: prefix).';
