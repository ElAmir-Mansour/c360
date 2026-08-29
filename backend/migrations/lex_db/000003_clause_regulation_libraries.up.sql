CREATE TABLE IF NOT EXISTS clause_library_items (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    code              TEXT        NOT NULL,
    title_en          TEXT        NOT NULL,
    title_ar          TEXT        NOT NULL,
    text_en           TEXT        NOT NULL,
    text_ar           TEXT        NOT NULL,
    clause_type       TEXT        NOT NULL,
    category          TEXT        NOT NULL DEFAULT '',
    jurisdiction      TEXT        NOT NULL DEFAULT 'SA',
    source            TEXT        NOT NULL DEFAULT '',
    source_url        TEXT,
    version           INT         NOT NULL DEFAULT 1 CHECK (version > 0),
    status            TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'deprecated', 'archived')),
    governance_status TEXT        NOT NULL DEFAULT 'pending_review' CHECK (governance_status IN ('pending_review', 'approved', 'rejected')),
    supersedes_id     UUID        REFERENCES clause_library_items(id),
    deprecated_by_id  UUID        REFERENCES clause_library_items(id),
    deprecated_at     TIMESTAMPTZ,
    tags              TEXT[]      NOT NULL DEFAULT '{}',
    metadata          JSONB       NOT NULL DEFAULT '{}',
    created_by        UUID        NOT NULL,
    updated_by        UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    UNIQUE (tenant_id, code, version)
);

CREATE INDEX IF NOT EXISTS idx_clause_library_tenant_status
    ON clause_library_items (tenant_id, status, governance_status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_clause_library_type
    ON clause_library_items (tenant_id, clause_type, category)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_clause_library_search
    ON clause_library_items USING GIN (
        to_tsvector('simple',
            coalesce(code, '') || ' ' ||
            coalesce(title_en, '') || ' ' ||
            coalesce(title_ar, '') || ' ' ||
            coalesce(text_en, '') || ' ' ||
            coalesce(text_ar, '')
        )
    )
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS regulation_library_items (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID        NOT NULL,
    code           TEXT        NOT NULL,
    title_en       TEXT        NOT NULL,
    title_ar       TEXT        NOT NULL,
    description_en TEXT        NOT NULL DEFAULT '',
    description_ar TEXT        NOT NULL DEFAULT '',
    jurisdiction   TEXT        NOT NULL DEFAULT 'SA',
    authority      TEXT        NOT NULL DEFAULT '',
    source         TEXT        NOT NULL DEFAULT '',
    source_url     TEXT,
    regulation_type TEXT       NOT NULL DEFAULT 'regulation' CHECK (regulation_type IN ('law', 'regulation', 'circular', 'guidance', 'standard', 'policy', 'other')),
    effective_date DATE,
    version        INT         NOT NULL DEFAULT 1 CHECK (version > 0),
    status         TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'superseded', 'deprecated', 'archived')),
    tags           TEXT[]      NOT NULL DEFAULT '{}',
    metadata       JSONB       NOT NULL DEFAULT '{}',
    created_by     UUID        NOT NULL,
    updated_by     UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,
    UNIQUE (tenant_id, code, version)
);

CREATE INDEX IF NOT EXISTS idx_regulation_library_tenant_status
    ON regulation_library_items (tenant_id, jurisdiction, status, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_regulation_library_type
    ON regulation_library_items (tenant_id, regulation_type, authority)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_regulation_library_search
    ON regulation_library_items USING GIN (
        to_tsvector('simple',
            coalesce(code, '') || ' ' ||
            coalesce(title_en, '') || ' ' ||
            coalesce(title_ar, '') || ' ' ||
            coalesce(description_en, '') || ' ' ||
            coalesce(description_ar, '') || ' ' ||
            coalesce(authority, '')
        )
    )
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS regulation_clause_references (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID        NOT NULL,
    regulation_id  UUID        NOT NULL REFERENCES regulation_library_items(id) ON DELETE CASCADE,
    clause_id      UUID        NOT NULL REFERENCES clause_library_items(id) ON DELETE CASCADE,
    reference_type TEXT        NOT NULL DEFAULT 'implements' CHECK (reference_type IN ('implements', 'required_by', 'recommended_by', 'impacted_by', 'related')),
    notes          TEXT        NOT NULL DEFAULT '',
    created_by     UUID        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, regulation_id, clause_id, reference_type)
);

CREATE INDEX IF NOT EXISTS idx_regulation_clause_refs_regulation
    ON regulation_clause_references (tenant_id, regulation_id);
CREATE INDEX IF NOT EXISTS idx_regulation_clause_refs_clause
    ON regulation_clause_references (tenant_id, clause_id);

ALTER TABLE clause_library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE clause_library_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clause_library_items
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON clause_library_items
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON clause_library_items
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON clause_library_items
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE regulation_library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulation_library_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON regulation_library_items
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON regulation_library_items
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON regulation_library_items
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON regulation_library_items
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE regulation_clause_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulation_clause_references FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON regulation_clause_references
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON regulation_clause_references
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON regulation_clause_references
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON regulation_clause_references
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
