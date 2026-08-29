-- 000086 may already be deployed from before employee mapping was added to the
-- import summary. Keep the upgrade additive for those databases.
ALTER TABLE legal_org_import_jobs
    ADD COLUMN IF NOT EXISTS employee_count INTEGER NOT NULL DEFAULT 0;
