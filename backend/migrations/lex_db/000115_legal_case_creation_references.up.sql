-- Structured case-creation references.
--
-- The client-supplied court list was empty, so this migration deliberately
-- creates the tenant-scoped reference-list infrastructure without inventing
-- court rows. Existing competent_court/court_number text is preserved for
-- historical display and reconciliation.

CREATE TABLE IF NOT EXISTS legal_courts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    code        TEXT        NOT NULL,
    name        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    active      BOOLEAN     NOT NULL DEFAULT true,
    is_system   BOOLEAN     NOT NULL DEFAULT false,
    sort        INTEGER     NOT NULL DEFAULT 0,
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT legal_courts_code_not_blank CHECK (length(btrim(code)) > 0),
    CONSTRAINT legal_courts_name_present CHECK (
        length(btrim(COALESCE(name->>'en', ''))) > 0
        OR length(btrim(COALESCE(name->>'ar', ''))) > 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_courts_tenant_id_unique
    ON legal_courts (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_courts_code_unique
    ON legal_courts (tenant_id, code)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_courts_active_sort
    ON legal_courts (tenant_id, active, sort, code)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_courts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_courts
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_courts
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_courts
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_courts
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Composite unique indexes let the foreign keys prove tenant ownership, not
-- merely UUID existence. IDs remain globally unique through their primary keys.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_tenant_id_unique
    ON contracts (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_requests_tenant_id_unique
    ON legal_requests (tenant_id, id);

ALTER TABLE legal_cases
    ADD COLUMN IF NOT EXISTS contract_id UUID,
    ADD COLUMN IF NOT EXISTS court_id UUID,
    ADD COLUMN IF NOT EXISTS other_case_type TEXT;

ALTER TABLE legal_cases
    ADD CONSTRAINT legal_cases_single_source_link CHECK (
        contract_id IS NULL OR request_id IS NULL
    ),
    ADD CONSTRAINT legal_cases_contract_tenant_fk
        FOREIGN KEY (tenant_id, contract_id)
        REFERENCES contracts (tenant_id, id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT legal_cases_court_tenant_fk
        FOREIGN KEY (tenant_id, court_id)
        REFERENCES legal_courts (tenant_id, id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT legal_cases_request_tenant_fk
        FOREIGN KEY (tenant_id, request_id)
        REFERENCES legal_requests (tenant_id, id)
        ON DELETE RESTRICT
        NOT VALID;

-- The request FK is NOT VALID solely to preserve any historical loose UUIDs
-- written before this migration. PostgreSQL still enforces it for every new or
-- changed row; legacy exceptions can be reconciled and validated separately.

CREATE INDEX IF NOT EXISTS idx_legal_cases_contract
    ON legal_cases (tenant_id, contract_id)
    WHERE contract_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_cases_court
    ON legal_cases (tenant_id, court_id)
    WHERE court_id IS NOT NULL AND deleted_at IS NULL;
