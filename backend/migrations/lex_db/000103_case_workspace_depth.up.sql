-- Case workspace depth for the case-detail, timeline, evidence, memorandums and
-- judicial-decisions surfaces. All new data remains tenant-scoped and follows the
-- existing legal-case soft-delete, RLS and append-only sub-resource audit patterns.

ALTER TABLE legal_cases
    ADD COLUMN IF NOT EXISTS chamber TEXT,
    ADD COLUMN IF NOT EXISTS filing_date DATE,
    ADD COLUMN IF NOT EXISTS claim_amount NUMERIC(18,2),
    ADD COLUMN IF NOT EXISTS court_fees NUMERIC(18,2),
    ADD COLUMN IF NOT EXISTS legal_fees NUMERIC(18,2),
    ADD COLUMN IF NOT EXISTS currency CHAR(3),
    ADD COLUMN IF NOT EXISTS expected_resolution_date DATE;

ALTER TABLE legal_cases
    DROP CONSTRAINT IF EXISTS legal_cases_claim_amount_nonnegative,
    ADD CONSTRAINT legal_cases_claim_amount_nonnegative
        CHECK (claim_amount IS NULL OR claim_amount >= 0),
    DROP CONSTRAINT IF EXISTS legal_cases_court_fees_nonnegative,
    ADD CONSTRAINT legal_cases_court_fees_nonnegative
        CHECK (court_fees IS NULL OR court_fees >= 0),
    DROP CONSTRAINT IF EXISTS legal_cases_legal_fees_nonnegative,
    ADD CONSTRAINT legal_cases_legal_fees_nonnegative
        CHECK (legal_fees IS NULL OR legal_fees >= 0),
    DROP CONSTRAINT IF EXISTS legal_cases_currency_format,
    ADD CONSTRAINT legal_cases_currency_format
        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');

CREATE INDEX IF NOT EXISTS idx_legal_cases_expected_resolution
    ON legal_cases (tenant_id, expected_resolution_date)
    WHERE expected_resolution_date IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS legal_case_milestones (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL,
    case_id            UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    title              TEXT        NOT NULL,
    description        TEXT        NOT NULL DEFAULT '',
    milestone_type     TEXT        NOT NULL DEFAULT 'custom' CHECK (milestone_type IN (
        'filing', 'hearing', 'submission', 'decision', 'deadline', 'custom'
    )),
    status             TEXT        NOT NULL DEFAULT 'planned' CHECK (status IN (
        'planned', 'completed', 'cancelled'
    )),
    milestone_date     TIMESTAMPTZ NOT NULL,
    completed_at       TIMESTAMPTZ,
    owner_id           UUID,
    source             TEXT        NOT NULL DEFAULT 'manual',
    source_reference   TEXT,
    metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by         UUID        NOT NULL,
    updated_by         UUID,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ,
    CONSTRAINT legal_case_milestones_completed_at_check CHECK (
        status <> 'completed' OR completed_at IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_legal_case_milestones_case_date
    ON legal_case_milestones (tenant_id, case_id, milestone_date, created_at)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_case_milestones_owner
    ON legal_case_milestones (tenant_id, owner_id, status, milestone_date)
    WHERE owner_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_case_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_milestones FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_case_milestones
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_milestones
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_case_milestones
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_case_milestones
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'legal_case_sub_audit_log_resource_type_check'
          AND conrelid = 'legal_case_sub_audit_log'::regclass
    ) THEN
        ALTER TABLE legal_case_sub_audit_log
            DROP CONSTRAINT legal_case_sub_audit_log_resource_type_check;
    END IF;
END$$;
ALTER TABLE legal_case_sub_audit_log
    ADD CONSTRAINT legal_case_sub_audit_log_resource_type_check
    CHECK (resource_type IN ('party', 'hearing', 'task', 'comment', 'document_link', 'milestone'));

ALTER TABLE legal_case_documents
    ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS court_reference TEXT,
    ADD COLUMN IF NOT EXISTS submitted_by UUID,
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_by UUID,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE legal_case_documents
    DROP CONSTRAINT IF EXISTS legal_case_documents_evidence_status_check,
    ADD CONSTRAINT legal_case_documents_evidence_status_check CHECK (evidence_status IN (
        'pending', 'submitted', 'admitted', 'rejected', 'withdrawn'
    ));
CREATE INDEX IF NOT EXISTS idx_legal_case_documents_evidence_status
    ON legal_case_documents (tenant_id, case_id, evidence_status, created_at DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_pleadings
    ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outgoing',
    ADD COLUMN IF NOT EXISTS recipient TEXT,
    ADD COLUMN IF NOT EXISTS court_reference TEXT,
    ADD COLUMN IF NOT EXISTS response_deadline DATE,
    ADD COLUMN IF NOT EXISTS response_owner_id UUID;
ALTER TABLE legal_pleadings
    DROP CONSTRAINT IF EXISTS legal_pleadings_direction_check,
    ADD CONSTRAINT legal_pleadings_direction_check CHECK (direction IN (
        'incoming', 'outgoing', 'internal'
    )),
    DROP CONSTRAINT IF EXISTS legal_pleadings_type_check,
    ADD CONSTRAINT legal_pleadings_type_check CHECK (type IN (
        'statement_of_claim', 'reply', 'brief', 'memorandum', 'motion',
        'petition', 'appeal', 'notice', 'request', 'other'
    ));
CREATE INDEX IF NOT EXISTS idx_legal_pleadings_response_deadline
    ON legal_pleadings (tenant_id, response_deadline, response_owner_id)
    WHERE response_deadline IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_judgments
    ADD COLUMN IF NOT EXISTS decision_type TEXT NOT NULL DEFAULT 'other',
    ADD COLUMN IF NOT EXISTS impact TEXT,
    ADD COLUMN IF NOT EXISTS judge_name TEXT,
    ADD COLUMN IF NOT EXISTS court_name TEXT,
    ADD COLUMN IF NOT EXISTS implications TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS document_reference TEXT,
    ADD COLUMN IF NOT EXISTS next_expected_ruling_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_expected_ruling TEXT;
ALTER TABLE legal_judgments
    DROP CONSTRAINT IF EXISTS legal_judgments_decision_type_check,
    ADD CONSTRAINT legal_judgments_decision_type_check CHECK (decision_type IN (
        'interim', 'first_instance', 'substantive_ruling', 'final', 'appeal',
        'cassation', 'enforcement', 'other'
    )),
    DROP CONSTRAINT IF EXISTS legal_judgments_impact_check,
    ADD CONSTRAINT legal_judgments_impact_check CHECK (
        impact IS NULL OR impact IN ('positive', 'negative', 'neutral', 'mixed')
    );
CREATE INDEX IF NOT EXISTS idx_legal_judgments_next_expected_ruling
    ON legal_judgments (tenant_id, next_expected_ruling_at)
    WHERE next_expected_ruling_at IS NOT NULL AND deleted_at IS NULL;
