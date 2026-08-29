-- Reverse 000016_approval_policy_governance.up.sql.

ALTER TABLE lex_approval_policies
    DROP CONSTRAINT IF EXISTS fk_lex_approval_policies_template;

DROP TABLE IF EXISTS lex_approval_policy_templates;
DROP TABLE IF EXISTS lex_approval_policy_audit_log;
DROP TABLE IF EXISTS lex_approval_policy_versions;

DROP INDEX IF EXISTS idx_lex_approval_policies_window;

ALTER TABLE lex_approval_policies
    DROP CONSTRAINT IF EXISTS chk_lex_approval_policies_window;
ALTER TABLE lex_approval_policies
    DROP CONSTRAINT IF EXISTS chk_lex_approval_policies_version;

ALTER TABLE lex_approval_policies
    DROP COLUMN IF EXISTS template_id,
    DROP COLUMN IF EXISTS valid_until,
    DROP COLUMN IF EXISTS valid_from,
    DROP COLUMN IF EXISTS version;
