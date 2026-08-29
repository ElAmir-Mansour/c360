-- Row-Level Security scaffolding for the tenant-scoped lex_db tables.
--
-- IMPORTANT — READ BEFORE RELYING ON THESE POLICIES FOR ISOLATION:
-- These ENABLE + FORCE statements and per-tenant policies (keyed on the
-- `app.current_tenant_id` GUC) are ASPIRATIONAL / INERT as deployed today.
-- They provide NO runtime tenant isolation in the current configuration. The
-- live tenant-isolation control is the explicit `WHERE tenant_id = $1` filter
-- every lex repository applies in Go — not these policies.
--
-- Two independent reasons they are inert:
--   1. Superuser pool. The lex service connects as the table owner / a
--      superuser (BYPASSRLS) role. A superuser/BYPASSRLS role bypasses RLS
--      entirely, even under FORCE ROW LEVEL SECURITY — so every policy below
--      is skipped for the live connection.
--   2. GUC almost never set. Enforcement also requires each transaction to
--      `SET LOCAL app.current_tenant_id = '<uuid>'`. Only a handful of code
--      paths do this (via database.RunWithTenant); the vast majority of lex
--      reads/writes never set the GUC, so `current_setting('app.current_tenant_id', true)`
--      returns NULL and the policy predicate (`tenant_id = NULL::uuid`) would
--      match zero rows — meaning flipping to a non-superuser role today would
--      fail closed and take the suite down rather than isolate it.
--
-- To make these policies actually enforce isolation, in this order:
--   (a) route ALL lex reads/writes through database.RunWithTenant so the GUC is
--       always set within the transaction; THEN
--   (b) demote the lex connection-pool role to a non-superuser, non-BYPASSRLS
--       role (migrations still run as an owner/BYPASSRLS role:
--       `ALTER ROLE migrator_role BYPASSRLS;`).
-- Until BOTH are done, treat everything below as defense-in-depth scaffolding,
-- not the enforced control. See 000080 for the one table (reference_library)
-- that intentionally ships a permissive read policy for this same reason.

-- =============================================================================
-- TABLE: contracts
-- =============================================================================

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contracts
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON contracts
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON contracts
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON contracts
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- TABLE: contract_versions
-- =============================================================================

ALTER TABLE contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contract_versions
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON contract_versions
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON contract_versions
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON contract_versions
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- TABLE: contract_clauses
-- =============================================================================

ALTER TABLE contract_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_clauses FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contract_clauses
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON contract_clauses
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON contract_clauses
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON contract_clauses
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- TABLE: contract_analyses
-- =============================================================================

ALTER TABLE contract_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_analyses FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contract_analyses
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON contract_analyses
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON contract_analyses
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON contract_analyses
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- TABLE: legal_documents
-- =============================================================================

ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_documents
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_documents
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_documents
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_documents
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- TABLE: document_versions
-- =============================================================================

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON document_versions
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON document_versions
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON document_versions
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON document_versions
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- TABLE: compliance_rules
-- =============================================================================

ALTER TABLE compliance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON compliance_rules
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON compliance_rules
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON compliance_rules
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON compliance_rules
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- TABLE: compliance_alerts
-- =============================================================================

ALTER TABLE compliance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_alerts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON compliance_alerts
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON compliance_alerts
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON compliance_alerts
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON compliance_alerts
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- TABLE: expiry_notifications
-- =============================================================================

ALTER TABLE expiry_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE expiry_notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON expiry_notifications
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON expiry_notifications
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON expiry_notifications
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON expiry_notifications
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
