ALTER TABLE legal_investigations DROP CONSTRAINT IF EXISTS legal_investigation_late_justification_complete;
ALTER TABLE legal_investigations
    DROP COLUMN IF EXISTS late_justification_manager_role,
    DROP COLUMN IF EXISTS late_justification_submitted_at,
    DROP COLUMN IF EXISTS late_justification_submitted_by,
    DROP COLUMN IF EXISTS late_justification;

ALTER TABLE legal_cases DROP CONSTRAINT IF EXISTS legal_case_late_justification_complete;
ALTER TABLE legal_cases
    DROP COLUMN IF EXISTS late_justification_manager_role,
    DROP COLUMN IF EXISTS late_justification_submitted_at,
    DROP COLUMN IF EXISTS late_justification_submitted_by,
    DROP COLUMN IF EXISTS late_justification;

ALTER TABLE legal_consultations DROP CONSTRAINT IF EXISTS legal_consultation_late_justification_complete;
ALTER TABLE legal_consultations
    DROP COLUMN IF EXISTS late_justification_manager_role,
    DROP COLUMN IF EXISTS late_justification_submitted_at,
    DROP COLUMN IF EXISTS late_justification_submitted_by,
    DROP COLUMN IF EXISTS late_justification;

ALTER TABLE legal_request_delivery_confirmation DROP CONSTRAINT IF EXISTS legal_delivery_late_justification_complete;
ALTER TABLE legal_request_delivery_confirmation
    DROP COLUMN IF EXISTS late_justification_manager_role,
    DROP COLUMN IF EXISTS late_justification_submitted_at,
    DROP COLUMN IF EXISTS late_justification_submitted_by,
    DROP COLUMN IF EXISTS late_justification;
