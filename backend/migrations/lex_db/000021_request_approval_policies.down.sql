-- Reverse of request_approval_policies.up.sql. Drop in reverse FK order:
-- the template FK first, then the child governance tables, then the parent.
ALTER TABLE IF EXISTS legal_request_approval_policies
    DROP CONSTRAINT IF EXISTS fk_legal_request_approval_policies_template;

DROP TABLE IF EXISTS legal_request_approval_policy_templates;
DROP TABLE IF EXISTS legal_request_approval_policy_audit_log;
DROP TABLE IF EXISTS legal_request_approval_policy_versions;
DROP TABLE IF EXISTS legal_request_approval_policies;
