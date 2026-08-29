-- =============================================================================
-- Rollback for migration 000034: DSPM Access Remediation
-- =============================================================================

DROP TABLE IF EXISTS dspm_access_remediation_actions;

DROP INDEX IF EXISTS idx_dspm_access_remediation_status;

ALTER TABLE dspm_access_mappings
    DROP COLUMN IF EXISTS remediation_status,
    DROP COLUMN IF EXISTS remediation_note,
    DROP COLUMN IF EXISTS remediated_by,
    DROP COLUMN IF EXISTS remediated_at;
