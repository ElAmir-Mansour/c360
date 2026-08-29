-- Legal Investigations vertical (CAP-077..083).
--
-- legal_investigations is a FIRST-CLASS investigation aggregate: register an
-- investigation, gather parties/statements/evidence, record findings + final
-- recommendations, and run a results-approval chain (CAP-083) through the SHARED,
-- subject-agnostic ApprovalOrchestrator. case_id is an OPTIONAL, NULLABLE loose
-- uuid reference to legal_cases with NO hard FK so this module ships independently
-- of litigation. Sensitive PII columns (subject, lead_investigator, findings,
-- recommendations on the root; identifier/contact on parties; statement bodies)
-- are field-encrypted at rest by the application (FieldCrypto "enc:v1:" envelope),
-- so they are stored as TEXT ciphertext.
--
-- Conventions (mirroring the neighbouring lex migrations, esp. 000026):
--   * tenant_id FIRST on every table; tenant-leading partial indexes.
--   * partial-unique investigation_number per tenant WHERE deleted_at IS NULL.
--   * soft-delete via deleted_at on the aggregate + sub-resources.
--   * ENABLE + FORCE RLS with 4 tenant policies on current_setting('app.current_tenant_id').
--   * the governance audit log is INSERT-only (no UPDATE/DELETE policy) => immutable.
--   * gen_random_uuid(), created_by, created_at/updated_at timestamps.
--
-- INTEGRATOR: number this 000027+ (current max is 000026). No new timer is added:
-- objection/hearing-deadline reminders reuse the existing obligation reminder
-- outbox by creating a linked legal_obligation (reminder_obligation_id below).

-- =============================================================================
-- legal_investigations — the first-class investigation aggregate root
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_investigations (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID        NOT NULL,
    investigation_number   TEXT        NOT NULL,
    -- subject + lead_investigator carry PII; stored as field-encrypted ciphertext.
    subject                TEXT        NOT NULL DEFAULT '',
    lead_investigator      TEXT        NOT NULL DEFAULT '',
    status                 TEXT        NOT NULL DEFAULT 'registered' CHECK (status IN (
        'registered', 'in_progress', 'results_recorded', 'pending_approval',
        'approved', 'rejected', 'closed', 'cancelled'
    )),
    priority               TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    -- LOOSE reference to legal_cases (no hard FK by design; ships independently).
    case_id                UUID,
    -- findings + recommendations carry PII; stored as field-encrypted ciphertext.
    findings               TEXT        NOT NULL DEFAULT '',
    recommendations        TEXT        NOT NULL DEFAULT '',
    ai_drafted             BOOLEAN     NOT NULL DEFAULT FALSE,
    department             TEXT,
    workflow_instance_id   UUID,
    -- linked legal_obligation that fires the objection/hearing-deadline reminder
    -- via the EXISTING obligation reminder outbox (no new timer).
    reminder_obligation_id UUID,
    metadata               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by             UUID        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_investigations_number_unique
    ON legal_investigations (tenant_id, investigation_number)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_investigations_tenant_status
    ON legal_investigations (tenant_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_investigations_tenant_priority
    ON legal_investigations (tenant_id, priority, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_investigations_case
    ON legal_investigations (tenant_id, case_id)
    WHERE case_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_investigations_workflow
    ON legal_investigations (tenant_id, workflow_instance_id)
    WHERE workflow_instance_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_investigations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_investigations
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_investigations
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_investigations
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_investigations
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_investigation_parties — participants (CAP-078). identifier/contact PII.
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_investigation_parties (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    investigation_id UUID        NOT NULL REFERENCES legal_investigations(id) ON DELETE CASCADE,
    role             TEXT        NOT NULL CHECK (role IN ('subject', 'complainant', 'witness', 'investigator', 'expert', 'other')),
    name             TEXT        NOT NULL,
    -- identifier + contact carry PII; stored as field-encrypted ciphertext.
    identifier       TEXT,
    contact          TEXT,
    metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by       UUID        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_investigation_parties_inv
    ON legal_investigation_parties (tenant_id, investigation_id, role)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_investigation_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_investigation_parties FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_investigation_parties
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_investigation_parties
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_investigation_parties
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_investigation_parties
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_investigation_statements — recorded testimonies (CAP-079). statement PII.
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_investigation_statements (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    investigation_id  UUID        NOT NULL REFERENCES legal_investigations(id) ON DELETE CASCADE,
    -- optional link to the deponent's party row.
    deponent_party_id UUID        REFERENCES legal_investigation_parties(id) ON DELETE SET NULL,
    deponent_name     TEXT        NOT NULL,
    -- statement body carries PII / sensitive testimony; field-encrypted ciphertext.
    statement         TEXT        NOT NULL DEFAULT '',
    taken_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    taken_by          TEXT        NOT NULL DEFAULT '',
    metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by        UUID        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_investigation_statements_inv
    ON legal_investigation_statements (tenant_id, investigation_id, taken_at)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_investigation_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_investigation_statements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_investigation_statements
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_investigation_statements
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_investigation_statements
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_investigation_statements
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_investigation_evidence — evidence references (CAP-080). The binary lives
-- in the Files service (entity_type='legal_investigation', entity_id=investigation_id);
-- file_id links it here along with chain-of-custody metadata.
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_investigation_evidence (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    investigation_id UUID        NOT NULL REFERENCES legal_investigations(id) ON DELETE CASCADE,
    file_id          UUID,
    title            TEXT        NOT NULL,
    description      TEXT        NOT NULL DEFAULT '',
    evidence_type    TEXT        NOT NULL DEFAULT '',
    collected_by     TEXT        NOT NULL DEFAULT '',
    collected_at     TIMESTAMPTZ,
    metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by       UUID        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_investigation_evidence_inv
    ON legal_investigation_evidence (tenant_id, investigation_id, created_at)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_investigation_evidence_file
    ON legal_investigation_evidence (tenant_id, file_id)
    WHERE file_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_investigation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_investigation_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_investigation_evidence
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_investigation_evidence
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_investigation_evidence
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_investigation_evidence
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- legal_investigation_audit_log — append-only governance audit trail (CAP-081/083)
-- =============================================================================
CREATE TABLE IF NOT EXISTS legal_investigation_audit_log (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    investigation_id UUID        NOT NULL REFERENCES legal_investigations(id) ON DELETE CASCADE,
    action           TEXT        NOT NULL,
    from_status      TEXT,
    to_status        TEXT,
    detail           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id    UUID        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_investigation_audit_log_inv
    ON legal_investigation_audit_log (tenant_id, investigation_id, created_at ASC);

ALTER TABLE legal_investigation_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_investigation_audit_log FORCE ROW LEVEL SECURITY;

-- Append-only: tenant isolation + insert ONLY. No UPDATE/DELETE policies so the
-- investigation governance audit trail is immutable (CAP-081/083).
CREATE POLICY tenant_isolation ON legal_investigation_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_investigation_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- Seeds: the investigations vertical has NO per-tenant reference/taxonomy data to
-- seed (investigations are transactional records, not seeded catalog rows). The
-- "seeds loop over tenants" rule is intentionally a no-op here. If a future
-- default investigation-type taxonomy is introduced it MUST be seeded by looping
-- over `SELECT id FROM tenants` so every tenant receives it by default.
