-- LegalRequest spine + Priority (CAP-009, CAP-010, CAP-011, CAP-030, CAP-031).
--
-- legal_requests is the canonical request row every legal-affairs service and
-- downstream domain references via request_id. The spine ships BEFORE the
-- service-catalog and org-entity modules, so service_id and beneficiary_entity_id
-- are nullable and intentionally carry NO hard foreign key (decoupled uuid
-- references); the owning modules add validation/FKs later if desired.
--
-- legal_request_priority_changes is an append-only (INSERT-only RLS) audit trail
-- of every urgent/normal reclassification (CAP-011).

CREATE TABLE IF NOT EXISTS legal_requests (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID        NOT NULL,
    request_number              TEXT        NOT NULL,
    request_type                TEXT        NOT NULL,
    service_id                  UUID,
    title                       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    description                 TEXT        NOT NULL DEFAULT '',
    requester_user_id           UUID        NOT NULL,
    requester_name              TEXT        NOT NULL,
    beneficiary_entity_id       UUID,
    department                  TEXT,
    priority                    TEXT        NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'normal')),
    status                      TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'pending_requester_approval', 'pending_provider_approval',
        'approved', 'routed', 'in_execution', 'delivered', 'closed', 'returned', 'cancelled'
    )),
    urgency_justification       TEXT,
    requester_approval_required BOOLEAN     NOT NULL DEFAULT false,
    provider_approval_required  BOOLEAN     NOT NULL DEFAULT false,
    subject_type                TEXT,
    subject_id                  UUID,
    workflow_instance_id        UUID,
    metadata                    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by                  UUID        NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at                  TIMESTAMPTZ,
    CONSTRAINT chk_legal_requests_urgent_justification CHECK (
        priority <> 'urgent'
        OR (
            urgency_justification IS NOT NULL
            AND length(btrim(urgency_justification)) >= 20
            AND lower(urgency_justification) !~ (
                'forgot|last[ -]?minute|poor planning|didn''t plan|did not plan|'
                'i was late|we were late|my delay|our delay|ran out of time|'
                'slipped my mind|overlooked|my fault|my bad|asap|'
                'نسيت|تأخرت|في اللحظة الأخيرة|سوء التخطيط|خطئي|بأسرع وقت'
            )
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_requests_number_unique
    ON legal_requests (tenant_id, request_number)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_requests_tenant_status
    ON legal_requests (tenant_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_requests_tenant_priority
    ON legal_requests (tenant_id, priority, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_requests_requester
    ON legal_requests (tenant_id, requester_user_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_requests_beneficiary
    ON legal_requests (tenant_id, beneficiary_entity_id)
    WHERE beneficiary_entity_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_requests_service
    ON legal_requests (tenant_id, service_id)
    WHERE service_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_requests_subject
    ON legal_requests (tenant_id, subject_type, subject_id)
    WHERE subject_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_requests_workflow
    ON legal_requests (tenant_id, workflow_instance_id)
    WHERE workflow_instance_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_requests
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_requests
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_requests
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_requests
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Append-only reclassification audit trail (CAP-011). Rows are immutable: there
-- are NO UPDATE/DELETE RLS policies, only tenant isolation + insert.
CREATE TABLE IF NOT EXISTS legal_request_priority_changes (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    request_id    UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    from_priority TEXT        NOT NULL CHECK (from_priority IN ('urgent', 'normal')),
    to_priority   TEXT        NOT NULL CHECK (to_priority IN ('urgent', 'normal')),
    reason        TEXT        NOT NULL DEFAULT '',
    changed_by    UUID        NOT NULL,
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_request_priority_changes_request
    ON legal_request_priority_changes (tenant_id, request_id, changed_at DESC);

ALTER TABLE legal_request_priority_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_priority_changes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_priority_changes
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_priority_changes
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
-- No UPDATE/DELETE policies: the priority-change log is append-only (CAP-011).
