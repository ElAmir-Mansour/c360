-- Phase 3 — Plaintiff & Defendant Litigation Flows (CAP-052..073).
--
-- Numbered 000027 (after 000026_legal_case_management). DEPENDS ON 000026
-- (legal_cases, legal_case_hearings) and 000004 (legal_obligations); sorts after both.
--
-- These tables EXTEND the Phase-2 LegalCase aggregate: pleadings, expert
-- assignments, judgments and defendant cases FK back to legal_cases(id); hearing
-- reports FK back to legal_case_hearings(id). Documents land via the Files service
-- (entity_type='legal_pleading' / 'legal_hearing_report' / 'legal_expert_assignment'
-- / 'legal_defendant_case', suite='lex').
--
-- Conventions (mirroring 000026 / 000004):
--   * tenant_id FIRST on every table; tenant-leading partial indexes.
--   * tenant-leading partial-unique numbers WHERE deleted_at IS NULL; soft-delete.
--   * ENABLE + FORCE RLS with 4 tenant policies on current_setting('app.current_tenant_id').
--   * version tables INSERT-only/dedup (no UPDATE/DELETE policy).
--   * gen_random_uuid(), created_by, created_at/updated_at timestamps.

-- =============================================================================
-- legal_obligations EXTENSION: case_id link + relaxed link CHECK so a judgment
-- objection-deadline obligation (CAP-066) is valid WITHOUT a contract/matter link.
-- The EXISTING obligation reminder outbox dispatches these rows — no new timer.
-- =============================================================================
ALTER TABLE legal_obligations
    ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES legal_cases(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_legal_obligations_case
    ON legal_obligations (tenant_id, case_id)
    WHERE case_id IS NOT NULL AND deleted_at IS NULL;

-- Replace the (contract_id OR matter_id) link CHECK with one that also accepts a
-- case_id link. Drop-if-exists keeps this idempotent across re-runs.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'legal_obligations'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%contract_id IS NOT NULL OR matter_id IS NOT NULL%'
    ) THEN
        EXECUTE (
            SELECT 'ALTER TABLE legal_obligations DROP CONSTRAINT ' || quote_ident(conname)
            FROM pg_constraint
            WHERE conrelid = 'legal_obligations'::regclass
              AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%contract_id IS NOT NULL OR matter_id IS NOT NULL%'
            LIMIT 1
        );
    END IF;
END $$;

ALTER TABLE legal_obligations
    ADD CONSTRAINT chk_legal_obligations_link
    CHECK (contract_id IS NOT NULL OR matter_id IS NOT NULL OR case_id IS NOT NULL);

-- =============================================================================
-- legal_pleadings — plaintiff pleadings / statement-of-claim (CAP-052..055)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_pleadings (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL,
    case_id              UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    pleading_number      TEXT        NOT NULL,
    type                 TEXT        NOT NULL DEFAULT 'statement_of_claim' CHECK (type IN (
        'statement_of_claim', 'reply', 'brief', 'other'
    )),
    title                TEXT        NOT NULL,
    body                 TEXT        NOT NULL DEFAULT '',
    status               TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'in_approval', 'approved', 'rejected', 'filed'
    )),
    ai_generated         BOOLEAN     NOT NULL DEFAULT false,
    current_version      INT         NOT NULL DEFAULT 1 CHECK (current_version >= 1),
    workflow_instance_id UUID,
    approved_by          UUID,
    approved_at          TIMESTAMPTZ,
    filed_at             TIMESTAMPTZ,
    metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by           UUID        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_pleadings_number_unique
    ON legal_pleadings (tenant_id, pleading_number)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_pleadings_case_status
    ON legal_pleadings (tenant_id, case_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_pleadings_workflow
    ON legal_pleadings (tenant_id, workflow_instance_id)
    WHERE workflow_instance_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_pleadings ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_pleadings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_pleadings
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_pleadings
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_pleadings
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_pleadings
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- legal_pleading_attachments — Files-service object links (CAP-053)
CREATE TABLE IF NOT EXISTS legal_pleading_attachments (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    pleading_id UUID        NOT NULL REFERENCES legal_pleadings(id) ON DELETE CASCADE,
    file_id     UUID,
    file_name   TEXT        NOT NULL,
    caption     TEXT        NOT NULL DEFAULT '',
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legal_pleading_attachments_pleading
    ON legal_pleading_attachments (tenant_id, pleading_id);

ALTER TABLE legal_pleading_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_pleading_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_pleading_attachments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_pleading_attachments
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_pleading_attachments
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_pleading_attachments
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- legal_pleading_versions — immutable draft snapshots (CAP-054). INSERT-only.
CREATE TABLE IF NOT EXISTS legal_pleading_versions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    pleading_id   UUID        NOT NULL REFERENCES legal_pleadings(id) ON DELETE CASCADE,
    version       INT         NOT NULL CHECK (version >= 1),
    title         TEXT        NOT NULL DEFAULT '',
    body          TEXT        NOT NULL DEFAULT '',
    ai_generated  BOOLEAN     NOT NULL DEFAULT false,
    change_reason TEXT        NOT NULL DEFAULT '',
    created_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_legal_pleading_versions UNIQUE (pleading_id, version)
);
CREATE INDEX IF NOT EXISTS idx_legal_pleading_versions_pleading
    ON legal_pleading_versions (tenant_id, pleading_id, version DESC);

ALTER TABLE legal_pleading_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_pleading_versions FORCE ROW LEVEL SECURITY;
-- Append-only: tenant isolation + insert ONLY (CAP-054 immutable drafts).
CREATE POLICY tenant_isolation ON legal_pleading_versions
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_pleading_versions
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_hearing_reports — hearing reports / minutes ضبط الجلسة (CAP-056..059)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_hearing_reports (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    case_id     UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    hearing_id  UUID        NOT NULL REFERENCES legal_case_hearings(id) ON DELETE CASCADE,
    type        TEXT        NOT NULL DEFAULT 'minutes' CHECK (type IN ('minutes', 'decision', 'report')),
    title       TEXT        NOT NULL,
    body        TEXT        NOT NULL DEFAULT '',
    decision    TEXT        NOT NULL DEFAULT '',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    file_id     UUID,
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_legal_hearing_reports_hearing
    ON legal_hearing_reports (tenant_id, hearing_id, recorded_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_hearing_reports_case
    ON legal_hearing_reports (tenant_id, case_id, recorded_at DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_hearing_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_hearing_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_hearing_reports
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_hearing_reports
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_hearing_reports
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_hearing_reports
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_expert_assignments — court-expert appointments ندب خبير (CAP-060..062)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_expert_assignments (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL,
    case_id            UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    expert_name        TEXT        NOT NULL,
    specialization     TEXT        NOT NULL DEFAULT '',
    contact_info       TEXT,
    mandate            TEXT        NOT NULL DEFAULT '',
    status             TEXT        NOT NULL DEFAULT 'requested' CHECK (status IN (
        'requested', 'appointed', 'report_received', 'closed', 'cancelled'
    )),
    appointed_at       DATE,
    report_due_date    DATE,
    report_received_at DATE,
    metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by         UUID        NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_legal_expert_assignments_case
    ON legal_expert_assignments (tenant_id, case_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_expert_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_expert_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_expert_assignments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_expert_assignments
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_expert_assignments
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_expert_assignments
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- legal_expert_documents — documents furnished to the expert (CAP-062)
CREATE TABLE IF NOT EXISTS legal_expert_documents (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    assignment_id UUID        NOT NULL REFERENCES legal_expert_assignments(id) ON DELETE CASCADE,
    file_id       UUID,
    file_name     TEXT        NOT NULL,
    caption       TEXT        NOT NULL DEFAULT '',
    created_by    UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legal_expert_documents_assignment
    ON legal_expert_documents (tenant_id, assignment_id);

ALTER TABLE legal_expert_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_expert_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_expert_documents
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_expert_documents
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_expert_documents
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_expert_documents
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_judgments — recorded + studied judgments (CAP-063..066)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_judgments (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL,
    case_id            UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    judgment_ref       TEXT        NOT NULL,
    judgment_date      DATE,
    outcome            TEXT        CHECK (outcome IS NULL OR outcome IN ('won', 'lost', 'partial', 'other')),
    summary            TEXT        NOT NULL DEFAULT '',
    study_notes        TEXT        NOT NULL DEFAULT '',
    recommendation     TEXT        NOT NULL DEFAULT 'pending' CHECK (recommendation IN ('pending', 'object', 'accept')),
    objection_deadline DATE,
    -- linked legal_obligations row whose reminder outbox fires the objection
    -- deadline (CAP-066). LOOSE reference (no hard FK) so an obligation can be
    -- soft-deleted independently.
    obligation_id      UUID,
    studied_by         UUID,
    studied_at         TIMESTAMPTZ,
    file_id            UUID,
    metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by         UUID        NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_legal_judgments_case
    ON legal_judgments (tenant_id, case_id, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_judgments_objection_deadline
    ON legal_judgments (tenant_id, objection_deadline)
    WHERE objection_deadline IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_judgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_judgments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_judgments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_judgments
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_judgments
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_judgments
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_defendant_cases — incoming-lawsuit (defendant-side) registrations
-- (CAP-067..073)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_defendant_cases (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    case_id               UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    plaintiff_name        TEXT        NOT NULL,
    court_name            TEXT,
    notification_date     DATE,
    company_representative TEXT,
    najiz_status          TEXT        NOT NULL DEFAULT 'manual' CHECK (najiz_status IN ('manual', 'synced', 'failed')),
    najiz_reference       TEXT,
    concerned_department  TEXT,
    dept_notified_at      TIMESTAMPTZ,
    response_memo         TEXT        NOT NULL DEFAULT '',
    response_memo_ai      BOOLEAN     NOT NULL DEFAULT false,
    status                TEXT        NOT NULL DEFAULT 'registered' CHECK (status IN (
        'registered', 'notified_dept', 'response_drafting', 'response_in_review',
        'response_approved', 'response_rejected', 'closed', 'cancelled'
    )),
    workflow_instance_id  UUID,
    response_approved_by  UUID,
    response_approved_at  TIMESTAMPTZ,
    metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by            UUID        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_legal_defendant_cases_case
    ON legal_defendant_cases (tenant_id, case_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_defendant_cases_workflow
    ON legal_defendant_cases (tenant_id, workflow_instance_id)
    WHERE workflow_instance_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_defendant_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_defendant_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_defendant_cases
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_defendant_cases
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_defendant_cases
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_defendant_cases
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- legal_defendant_attachments — served statement of claim / supporting docs (CAP-070)
CREATE TABLE IF NOT EXISTS legal_defendant_attachments (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    defendant_case_id UUID        NOT NULL REFERENCES legal_defendant_cases(id) ON DELETE CASCADE,
    file_id           UUID,
    file_name         TEXT        NOT NULL,
    caption           TEXT        NOT NULL DEFAULT '',
    kind              TEXT        NOT NULL DEFAULT 'statement_of_claim',
    created_by        UUID        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legal_defendant_attachments_case
    ON legal_defendant_attachments (tenant_id, defendant_case_id);

ALTER TABLE legal_defendant_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_defendant_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_defendant_attachments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_defendant_attachments
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_defendant_attachments
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_defendant_attachments
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- Seeds: these litigation tables are OPERATIONAL (no reference taxonomy to seed).
-- The shared workflow definitions ("Lex Litigation Pleading Approval" and "Lex
-- Defendant Response Memo Review") are created lazily per tenant on first use by
-- the services (mirroring RequestApprovalService.ensureDefinition), so NO seed
-- rows are required here. The seed loop convention is preserved below as a no-op
-- documenting that per-tenant litigation reference data, if any is added later,
-- MUST loop over SELECT id FROM tenants.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id FROM tenants LOOP
        -- no-op: litigation flows seed no per-tenant reference rows today.
        PERFORM t.id;
    END LOOP;
END $$;
