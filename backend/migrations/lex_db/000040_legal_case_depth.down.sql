-- Down-migration for 000038_legal_case_depth.

DROP TABLE IF EXISTS legal_case_sub_audit_log;

DROP INDEX IF EXISTS idx_legal_cases_tenant_on_hold;

-- Restore the original status CHECK (without on_hold). Any rows still in on_hold
-- must be moved out before this runs; the DROP/ADD is otherwise a no-op-safe.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'legal_cases_status_check'
          AND conrelid = 'legal_cases'::regclass
    ) THEN
        ALTER TABLE legal_cases DROP CONSTRAINT legal_cases_status_check;
    END IF;
END$$;

ALTER TABLE legal_cases
    ADD CONSTRAINT legal_cases_status_check CHECK (status IN (
        'intake', 'phase1', 'phase2', 'open', 'under_procedure', 'closed', 'cancelled'
    ));

ALTER TABLE legal_cases DROP COLUMN IF EXISTS hold_reason;
ALTER TABLE legal_cases DROP COLUMN IF EXISTS hold_category;
ALTER TABLE legal_cases DROP COLUMN IF EXISTS clock_started_at;
ALTER TABLE legal_cases DROP COLUMN IF EXISTS lock_version;
