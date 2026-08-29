-- Private late-completion justifications for Lex SLA-bearing aggregates. These
-- columns are projected only after role-based redaction by the API handlers.
ALTER TABLE legal_request_delivery_confirmation
    ADD COLUMN IF NOT EXISTS late_justification TEXT,
    ADD COLUMN IF NOT EXISTS late_justification_submitted_by UUID,
    ADD COLUMN IF NOT EXISTS late_justification_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS late_justification_manager_role TEXT;

ALTER TABLE legal_request_delivery_confirmation
    DROP CONSTRAINT IF EXISTS legal_delivery_late_justification_complete;
ALTER TABLE legal_request_delivery_confirmation
    ADD CONSTRAINT legal_delivery_late_justification_complete CHECK (
        (late_justification IS NULL
         AND late_justification_submitted_by IS NULL
         AND late_justification_submitted_at IS NULL
         AND late_justification_manager_role IS NULL)
        OR
        (length(btrim(late_justification)) > 0
         AND late_justification_submitted_by IS NOT NULL
         AND late_justification_submitted_at IS NOT NULL
         AND length(btrim(late_justification_manager_role)) > 0)
    );

ALTER TABLE legal_consultations
    ADD COLUMN IF NOT EXISTS late_justification TEXT,
    ADD COLUMN IF NOT EXISTS late_justification_submitted_by UUID,
    ADD COLUMN IF NOT EXISTS late_justification_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS late_justification_manager_role TEXT;

ALTER TABLE legal_consultations
    DROP CONSTRAINT IF EXISTS legal_consultation_late_justification_complete;
ALTER TABLE legal_consultations
    ADD CONSTRAINT legal_consultation_late_justification_complete CHECK (
        (late_justification IS NULL
         AND late_justification_submitted_by IS NULL
         AND late_justification_submitted_at IS NULL
         AND late_justification_manager_role IS NULL)
        OR
        (length(btrim(late_justification)) > 0
         AND late_justification_submitted_by IS NOT NULL
         AND late_justification_submitted_at IS NOT NULL
         AND length(btrim(late_justification_manager_role)) > 0)
    );

ALTER TABLE legal_cases
    ADD COLUMN IF NOT EXISTS late_justification TEXT,
    ADD COLUMN IF NOT EXISTS late_justification_submitted_by UUID,
    ADD COLUMN IF NOT EXISTS late_justification_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS late_justification_manager_role TEXT;

ALTER TABLE legal_cases
    DROP CONSTRAINT IF EXISTS legal_case_late_justification_complete;
ALTER TABLE legal_cases
    ADD CONSTRAINT legal_case_late_justification_complete CHECK (
        (late_justification IS NULL
         AND late_justification_submitted_by IS NULL
         AND late_justification_submitted_at IS NULL
         AND late_justification_manager_role IS NULL)
        OR
        (length(btrim(late_justification)) > 0
         AND late_justification_submitted_by IS NOT NULL
         AND late_justification_submitted_at IS NOT NULL
         AND length(btrim(late_justification_manager_role)) > 0)
    );

ALTER TABLE legal_investigations
    ADD COLUMN IF NOT EXISTS late_justification TEXT,
    ADD COLUMN IF NOT EXISTS late_justification_submitted_by UUID,
    ADD COLUMN IF NOT EXISTS late_justification_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS late_justification_manager_role TEXT;

ALTER TABLE legal_investigations
    DROP CONSTRAINT IF EXISTS legal_investigation_late_justification_complete;
ALTER TABLE legal_investigations
    ADD CONSTRAINT legal_investigation_late_justification_complete CHECK (
        (late_justification IS NULL
         AND late_justification_submitted_by IS NULL
         AND late_justification_submitted_at IS NULL
         AND late_justification_manager_role IS NULL)
        OR
        (length(btrim(late_justification)) > 0
         AND late_justification_submitted_by IS NOT NULL
         AND late_justification_submitted_at IS NOT NULL
         AND length(btrim(late_justification_manager_role)) > 0)
    );
