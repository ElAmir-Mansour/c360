-- Litigation Case Management — first-class LegalCase aggregate (CAP-032..051).
--
-- legal_cases is a FIRST-CLASS litigation aggregate (NOT a thin Matter): a clean,
-- extensible BASE table. Phase 3 plaintiff/defendant flows extend this module —
-- pleadings/judgments/expert tables FK back to legal_cases, and additional rows
-- hang off legal_case_parties / legal_case_hearings. legal_cases.request_id
-- back-links the legal_requests spine; classification_id is a LOOSE uuid ref to
-- legal_case_classifications (no hard FK between the case row and the taxonomy so
-- the taxonomy can evolve independently).
--
-- Conventions (mirroring the neighbouring lex migrations):
--   * tenant_id FIRST on every table; tenant-leading partial indexes.
--   * partial-unique case_number per tenant WHERE deleted_at IS NULL; soft-delete.
--   * ENABLE + FORCE RLS with 4 tenant policies on current_setting('app.current_tenant_id').
--   * governance audit log + version history are INSERT-only (no UPDATE/DELETE policy).
--   * gen_random_uuid(), created_by, created_at/updated_at timestamps.


-- NOTE (integrator): the legal_case_classifications taxonomy table + its per-tenant
-- seed live in 000025_case_classification_taxonomy (the authoritative owner). This
-- migration depends on 000025 and references classification_id as a LOOSE uuid (no FK).

-- =============================================================================
-- legal_cases — the first-class litigation aggregate root
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_cases (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL,
    case_number          TEXT        NOT NULL,
    court_number         TEXT,
    case_type            TEXT        NOT NULL,
    -- LOOSE reference to legal_case_classifications (no hard FK by design).
    classification_id    UUID,
    company_status       TEXT        NOT NULL CHECK (company_status IN ('plaintiff', 'defendant')),
    competent_court      TEXT,
    title                JSONB       NOT NULL DEFAULT '{}'::jsonb,
    description          TEXT        NOT NULL DEFAULT '',
    strength             TEXT        CHECK (strength IS NULL OR strength IN ('strong', 'weak')),
    status               TEXT        NOT NULL DEFAULT 'intake' CHECK (status IN (
        'intake', 'phase1', 'phase2', 'open', 'under_procedure', 'closed', 'cancelled'
    )),
    priority             TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    section_manager_id   UUID,
    supervisor_id        UUID,
    handling_officer_id  UUID,
    responsible_lawyer   TEXT,
    department           TEXT,
    -- spine back-link (decoupled uuid; the spine row references the case via
    -- subject_type='legal_case' / subject_id).
    request_id           UUID,
    workflow_instance_id UUID,
    metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by           UUID        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_cases_number_unique
    ON legal_cases (tenant_id, case_number)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_cases_tenant_status
    ON legal_cases (tenant_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_cases_tenant_company_status
    ON legal_cases (tenant_id, company_status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_cases_tenant_priority
    ON legal_cases (tenant_id, priority, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_cases_classification
    ON legal_cases (tenant_id, classification_id)
    WHERE classification_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_cases_section_manager
    ON legal_cases (tenant_id, section_manager_id)
    WHERE section_manager_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_cases_handling_officer
    ON legal_cases (tenant_id, handling_officer_id)
    WHERE handling_officer_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_cases_request
    ON legal_cases (tenant_id, request_id)
    WHERE request_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_cases_workflow
    ON legal_cases (tenant_id, workflow_instance_id)
    WHERE workflow_instance_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_cases FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_cases
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_cases
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_cases
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_cases
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_case_parties — case participants (CAP-043). BASE table; Phase 3 extends.
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_case_parties (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL,
    case_id    UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    role       TEXT        NOT NULL CHECK (role IN ('plaintiff', 'defendant', 'lawyer', 'witness', 'expert', 'other')),
    name       TEXT        NOT NULL,
    identifier TEXT,
    contact    TEXT,
    metadata   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_case_parties_case
    ON legal_case_parties (tenant_id, case_id, role)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_case_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_parties FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_case_parties
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_parties
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_case_parties
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_case_parties
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_case_hearings — scheduled/recorded hearings (CAP-044). BASE table;
-- Phase 3 extends hearings with reports/minutes (documents land via the Files
-- service with entity_type='legal_case_hearing').
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_case_hearings (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    case_id      UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    hearing_date TIMESTAMPTZ NOT NULL,
    location     TEXT,
    notes        TEXT        NOT NULL DEFAULT '',
    decision     TEXT,
    metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by   UUID        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_case_hearings_case
    ON legal_case_hearings (tenant_id, case_id, hearing_date)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_case_hearings ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_hearings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_case_hearings
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_hearings
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_case_hearings
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_case_hearings
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_case_tasks — case work items (CAP-040)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_case_tasks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    case_id     UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    title       TEXT        NOT NULL,
    assignee_id UUID,
    priority    TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
    due_date    DATE,
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_case_tasks_case
    ON legal_case_tasks (tenant_id, case_id, status)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_case_tasks_assignee
    ON legal_case_tasks (tenant_id, assignee_id, status)
    WHERE assignee_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_case_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_case_tasks
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_tasks
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_case_tasks
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_case_tasks
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_case_intakes — singleton-per-case two-phase intake tracking
-- (CAP-032..036). Phase 1 directive chain (CEO directive + DoA authority
-- evidence refs + strength assessment); Phase 2 handoff (task estimation +
-- officer/supervisor assignment).
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_case_intakes (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL,
    case_id              UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    phase                TEXT        NOT NULL DEFAULT 'phase1' CHECK (phase IN ('phase1', 'phase2', 'complete')),
    phase1_started_at    TIMESTAMPTZ,
    phase1_completed_at  TIMESTAMPTZ,
    phase2_started_at    TIMESTAMPTZ,
    phase2_completed_at  TIMESTAMPTZ,
    ceo_directive_ref    TEXT,
    doa_authority_ref    TEXT,
    strength_assessment  TEXT        CHECK (strength_assessment IS NULL OR strength_assessment IN ('strong', 'weak')),
    task_estimate        TEXT,
    workflow_instance_id UUID,
    metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by           UUID        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_case_intakes_case_unique
    ON legal_case_intakes (tenant_id, case_id);

ALTER TABLE legal_case_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_intakes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_case_intakes
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_intakes
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_case_intakes
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_case_intakes
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_case_audit_log — append-only governance audit trail (CAP-051)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_case_audit_log (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    case_id       UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    action        TEXT        NOT NULL,
    from_status   TEXT,
    to_status     TEXT,
    detail        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_case_audit_log_case
    ON legal_case_audit_log (tenant_id, case_id, created_at ASC);

ALTER TABLE legal_case_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_audit_log FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation + insert ONLY. No UPDATE/DELETE policies so the
-- case governance audit trail is immutable (CAP-051).
CREATE POLICY tenant_isolation ON legal_case_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_case_versions — immutable case snapshot history (CAP-051)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_case_versions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    case_id       UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    version       INT         NOT NULL CHECK (version >= 1),
    snapshot      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    change_reason TEXT        NOT NULL DEFAULT '',
    created_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_legal_case_versions_case_version UNIQUE (case_id, version)
);

CREATE INDEX IF NOT EXISTS idx_legal_case_versions_case
    ON legal_case_versions (tenant_id, case_id, version DESC);

ALTER TABLE legal_case_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_versions FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation + insert ONLY. No UPDATE/DELETE policies so the
-- case version history is immutable (CAP-051).
CREATE POLICY tenant_isolation ON legal_case_versions
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_versions
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

