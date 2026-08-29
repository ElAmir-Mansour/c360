-- Legal System Role Matrix (Watheeq / lex) — add a metadata JSONB to roles so the
-- 14 named legal roles can carry the Role Roster org-hierarchy fields
-- ({tier, reports_to, org_unit, escalation_level}) consumed by the role-management
-- UI and the org-RBAC escalation chain. Additive + backward-compatible: existing
-- rows default to an empty object; nothing reads metadata before it is populated.
ALTER TABLE roles
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN roles.metadata IS 'Role metadata JSONB (e.g. legal-affairs {tier, reports_to, org_unit, escalation_level}).';
