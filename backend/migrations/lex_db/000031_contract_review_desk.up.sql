-- =============================================================================
-- Contract review-desk re-baseline (CAP-094..125)
-- =============================================================================
-- Extends the existing contract module WITHOUT touching contract Go files: every
-- table references contracts(id) and carries tenant_id FIRST. Conventions mirror
-- 000004 (table + tenant-leading partial indexes + soft-delete + 4 RLS policies)
-- and the append-only governance pattern from 000026 (INSERT-only policy, no
-- UPDATE/DELETE policy, so the desk audit / correspondence threads are immutable).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- lex_contract_attachment_requirements — the four named document slots (CAP-099)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_contract_attachment_requirements (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    contract_id UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    slot        TEXT        NOT NULL CHECK (slot IN (
        'draft', 'quotation', 'commercial_registration', 'committee_decision'
    )),
    required    BOOLEAN     NOT NULL DEFAULT true,
    label       TEXT        NOT NULL DEFAULT '',
    sort_order  INT         NOT NULL DEFAULT 0,
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_lex_contract_attachment_requirements UNIQUE (tenant_id, contract_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_lex_contract_attachment_requirements_contract
    ON lex_contract_attachment_requirements (tenant_id, contract_id, sort_order);

ALTER TABLE lex_contract_attachment_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_contract_attachment_requirements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_contract_attachment_requirements
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_contract_attachment_requirements
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_contract_attachment_requirements
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_contract_attachment_requirements
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- lex_contract_attachments — uploaded slot documents (CAP-099 / re-upload CAP-115)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_contract_attachments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    contract_id     UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    slot            TEXT        NOT NULL CHECK (slot IN (
        'draft', 'quotation', 'commercial_registration', 'committee_decision'
    )),
    file_id         UUID,
    file_name       TEXT        NOT NULL,
    file_size_bytes BIGINT      NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
    content_hash    TEXT,
    version         INT         NOT NULL DEFAULT 1 CHECK (version >= 1),
    superseded      BOOLEAN     NOT NULL DEFAULT false,
    notes           TEXT,
    metadata        JSONB       NOT NULL DEFAULT '{}',
    uploaded_by     UUID        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lex_contract_attachments_contract
    ON lex_contract_attachments (tenant_id, contract_id, slot, version DESC)
    WHERE deleted_at IS NULL;
-- One live (non-superseded) attachment per slot, per contract.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_contract_attachments_live_slot
    ON lex_contract_attachments (tenant_id, contract_id, slot)
    WHERE superseded = false AND deleted_at IS NULL;

ALTER TABLE lex_contract_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_contract_attachments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_contract_attachments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_contract_attachments
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_contract_attachments
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_contract_attachments
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- lex_contract_intakes — singleton-per-contract review-desk intake (CAP-100..105)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_contract_intakes (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID        NOT NULL,
    contract_id            UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    reference_number       TEXT        NOT NULL,
    status                 TEXT        NOT NULL DEFAULT 'received' CHECK (status IN (
        'received', 'acknowledged', 'routed_to_legal', 'under_review', 'returned', 'completed'
    )),
    received_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at        TIMESTAMPTZ,
    acknowledged_by        UUID,
    routed_to_legal_at     TIMESTAMPTZ,
    routed_to_legal_by     UUID,
    assigned_reviewer_id   UUID,
    assigned_reviewer_name TEXT,
    completeness_checked   BOOLEAN     NOT NULL DEFAULT false,
    completeness_passed    BOOLEAN     NOT NULL DEFAULT false,
    last_checked_at        TIMESTAMPTZ,
    returned_at            TIMESTAMPTZ,
    returned_by            UUID,
    return_reason          TEXT,
    deficiency_notice      TEXT,
    metadata               JSONB       NOT NULL DEFAULT '{}',
    created_by             UUID        NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_lex_contract_intakes_contract UNIQUE (tenant_id, contract_id)
);

-- Desk reference number is unique per tenant (CAP-100).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_contract_intakes_reference
    ON lex_contract_intakes (tenant_id, reference_number);
CREATE INDEX IF NOT EXISTS idx_lex_contract_intakes_status
    ON lex_contract_intakes (tenant_id, status, updated_at DESC);

ALTER TABLE lex_contract_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_contract_intakes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_contract_intakes
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_contract_intakes
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_contract_intakes
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_contract_intakes
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- lex_contract_correspondence — append-only desk thread (CAP-113..116)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_contract_correspondence (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    contract_id UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    intake_id   UUID        REFERENCES lex_contract_intakes(id) ON DELETE SET NULL,
    kind        TEXT        NOT NULL CHECK (kind IN ('internal', 'clarification', 'auto_return')),
    direction   TEXT        NOT NULL DEFAULT 'internal' CHECK (direction IN ('internal', 'outbound', 'inbound')),
    subject     TEXT        NOT NULL DEFAULT '',
    body        TEXT        NOT NULL,
    author_name TEXT,
    metadata    JSONB       NOT NULL DEFAULT '{}',
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_contract_correspondence_contract
    ON lex_contract_correspondence (tenant_id, contract_id, created_at DESC);

ALTER TABLE lex_contract_correspondence ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_contract_correspondence FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation + insert ONLY. No UPDATE/DELETE policy so the
-- desk correspondence thread is immutable.
CREATE POLICY tenant_isolation ON lex_contract_correspondence
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_contract_correspondence
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- lex_contract_recommendations — final review-desk recommendation (CAP-118..120)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_contract_recommendations (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL,
    contract_id          UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    intake_id            UUID        REFERENCES lex_contract_intakes(id) ON DELETE SET NULL,
    outcome              TEXT        NOT NULL CHECK (outcome IN ('approved', 'needs_amendment', 'rejected')),
    summary              TEXT        NOT NULL DEFAULT '',
    amendment_reason     TEXT,
    rejection_reason     TEXT,
    workflow_instance_id UUID,
    superseded           BOOLEAN     NOT NULL DEFAULT false,
    recommended_by_name  TEXT,
    metadata             JSONB       NOT NULL DEFAULT '{}',
    created_by           UUID        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_contract_recommendations_contract
    ON lex_contract_recommendations (tenant_id, contract_id, created_at DESC);
-- At most one live (non-superseded) recommendation per contract.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_contract_recommendations_active
    ON lex_contract_recommendations (tenant_id, contract_id)
    WHERE superseded = false;

ALTER TABLE lex_contract_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_contract_recommendations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_contract_recommendations
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_contract_recommendations
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_contract_recommendations
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_contract_recommendations
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- lex_contract_review_desk_audit — append-only desk governance audit (CAP-121)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_contract_review_desk_audit (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    contract_id   UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    subject_id    UUID,
    action        TEXT        NOT NULL,
    from_status   TEXT,
    to_status     TEXT,
    detail        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_contract_review_desk_audit_contract
    ON lex_contract_review_desk_audit (tenant_id, contract_id, created_at ASC);

ALTER TABLE lex_contract_review_desk_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_contract_review_desk_audit FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation + insert ONLY. No UPDATE/DELETE policy so the
-- desk governance audit trail is immutable (CAP-121).
CREATE POLICY tenant_isolation ON lex_contract_review_desk_audit
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_contract_review_desk_audit
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- Seed: the four named-slot requirement rows (CAP-099) for any contract that
-- already exists at migration time, looped over all tenants per the AI-governance
-- seeding rule. New contracts get their slots seeded by the service at intake
-- time (OpenIntake). The FK to contracts(id) means we can only seed against real
-- contract rows, so this back-fills existing contracts.
-- -----------------------------------------------------------------------------
INSERT INTO lex_contract_attachment_requirements (tenant_id, contract_id, slot, required, label, sort_order, created_by)
SELECT c.tenant_id, c.id, s.slot, true, s.label, s.sort_order,
       '00000000-0000-0000-0000-000000000001'::uuid
FROM contracts c
JOIN tenants t ON t.id = c.tenant_id
CROSS JOIN (
    VALUES
        ('draft',                   'Draft Contract',           10),
        ('quotation',               'Quotation',                20),
        ('commercial_registration', 'Commercial Registration',  30),
        ('committee_decision',      'Committee Decision',        40)
) AS s(slot, label, sort_order)
WHERE c.deleted_at IS NULL
ON CONFLICT (tenant_id, contract_id, slot) DO NOTHING;
