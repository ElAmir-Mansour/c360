CREATE TABLE IF NOT EXISTS legal_matters (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    matter_number     TEXT        NOT NULL,
    title             TEXT        NOT NULL,
    description       TEXT        NOT NULL DEFAULT '',
    type              TEXT        NOT NULL DEFAULT 'general' CHECK (type IN (
        'general', 'contract', 'litigation', 'regulatory', 'employment',
        'dispute', 'advisory', 'other'
    )),
    status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN (
        'intake', 'open', 'in_review', 'waiting_on_business',
        'on_hold', 'closed', 'cancelled'
    )),
    priority          TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    owner_user_id     UUID        NOT NULL,
    owner_name        TEXT        NOT NULL,
    requester_user_id UUID,
    requester_name    TEXT,
    department        TEXT,
    opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_date          DATE,
    closed_at         TIMESTAMPTZ,
    tags              TEXT[]      NOT NULL DEFAULT '{}',
    metadata          JSONB       NOT NULL DEFAULT '{}',
    created_by        UUID        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_matters_number_unique
    ON legal_matters (tenant_id, matter_number)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_matters_tenant_status
    ON legal_matters (tenant_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_matters_owner
    ON legal_matters (tenant_id, owner_user_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_matters_due
    ON legal_matters (tenant_id, due_date)
    WHERE due_date IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS legal_matter_contracts (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    matter_id    UUID        NOT NULL REFERENCES legal_matters(id) ON DELETE CASCADE,
    contract_id  UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    relationship TEXT        NOT NULL DEFAULT 'related',
    created_by   UUID        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (matter_id, contract_id)
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_contracts_matter
    ON legal_matter_contracts (tenant_id, matter_id);
CREATE INDEX IF NOT EXISTS idx_legal_matter_contracts_contract
    ON legal_matter_contracts (tenant_id, contract_id);

CREATE TABLE IF NOT EXISTS legal_obligations (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL,
    title                TEXT        NOT NULL,
    description          TEXT        NOT NULL DEFAULT '',
    type                 TEXT        NOT NULL DEFAULT 'contractual' CHECK (type IN (
        'contractual', 'renewal', 'notice', 'payment', 'delivery',
        'reporting', 'compliance', 'covenant', 'condition_precedent',
        'regulatory', 'other'
    )),
    status               TEXT        NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'in_progress', 'blocked', 'completed', 'waived', 'cancelled'
    )),
    priority             TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    contract_id          UUID        REFERENCES contracts(id) ON DELETE CASCADE,
    matter_id            UUID        REFERENCES legal_matters(id) ON DELETE CASCADE,
    clause_id            UUID        REFERENCES contract_clauses(id) ON DELETE SET NULL,
    owner_user_id        UUID        NOT NULL,
    owner_name           TEXT        NOT NULL,
    due_date             DATE        NOT NULL,
    completed_at         TIMESTAMPTZ,
    reminder_enabled     BOOLEAN     NOT NULL DEFAULT true,
    reminder_lead_days   INT[]       NOT NULL DEFAULT '{30,7,1}',
    escalation_enabled   BOOLEAN     NOT NULL DEFAULT false,
    escalation_lead_days INT[]       NOT NULL DEFAULT '{}',
    escalation_target    TEXT,
    last_reminder_at     TIMESTAMPTZ,
    tags                 TEXT[]      NOT NULL DEFAULT '{}',
    metadata             JSONB       NOT NULL DEFAULT '{}',
    created_by           UUID        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at           TIMESTAMPTZ,
    CHECK (contract_id IS NOT NULL OR matter_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_legal_obligations_tenant_status
    ON legal_obligations (tenant_id, status, due_date)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_obligations_contract
    ON legal_obligations (tenant_id, contract_id)
    WHERE contract_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_obligations_matter
    ON legal_obligations (tenant_id, matter_id)
    WHERE matter_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_obligations_owner
    ON legal_obligations (tenant_id, owner_user_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_obligations_due
    ON legal_obligations (tenant_id, due_date)
    WHERE status NOT IN ('completed', 'waived', 'cancelled') AND deleted_at IS NULL;

ALTER TABLE legal_matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_matters FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_matters
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_matters
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_matters
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_matters
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE legal_matter_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_matter_contracts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_matter_contracts
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_matter_contracts
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_matter_contracts
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_matter_contracts
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE legal_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_obligations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_obligations
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_obligations
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_obligations
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_obligations
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
