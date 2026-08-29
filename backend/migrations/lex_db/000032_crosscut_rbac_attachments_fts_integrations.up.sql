-- =============================================================================
-- Cross-cutting Phase-4 module: attachment policies, document FTS, integrations
-- (CAP-152..186). Conventions mirror 000019 (legal_org_entities: tenant_id FIRST,
-- bilingual JSONB labels, soft-delete, 4 RLS policies) and 000031 (contract
-- review-desk). The integrator numbers this 000032+.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- FTS on legal_documents (CAP-169/182): extracted_text body column + GENERATED
-- search_vector (title + description + extracted_text) + GIN index (CAP-182/183).
-- Additive ALTER: existing rows get NULL extracted_text and a vector built from
-- title/description only, so current document reads/searches are unaffected.
-- -----------------------------------------------------------------------------
ALTER TABLE legal_documents
    ADD COLUMN IF NOT EXISTS extracted_text TEXT;

ALTER TABLE legal_documents
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(extracted_text, '')), 'C')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_legal_documents_search_vector
    ON legal_documents USING GIN (search_vector);

-- -----------------------------------------------------------------------------
-- lex_attachment_policies — per request_type / service_code attachment
-- requirement (CAP-165..170). Bilingual name/description + slots stored as JSONB.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_attachment_policies (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    request_type          TEXT        NOT NULL DEFAULT '',
    service_code          TEXT        NOT NULL DEFAULT '',
    name                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    description           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    min_attachment_count  INT         NOT NULL DEFAULT 0 CHECK (min_attachment_count >= 0),
    max_attachment_count  INT         NOT NULL DEFAULT 0 CHECK (max_attachment_count >= 0),
    slots                 JSONB       NOT NULL DEFAULT '[]'::jsonb,
    allowed_content_types TEXT[]      NOT NULL DEFAULT '{}',
    max_file_size_bytes   BIGINT      NOT NULL DEFAULT 0 CHECK (max_file_size_bytes >= 0),
    active                BOOLEAN     NOT NULL DEFAULT true,
    metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by            UUID        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at            TIMESTAMPTZ,
    CONSTRAINT chk_lex_attachment_policies_key
        CHECK (request_type <> '' OR service_code <> '')
);

-- One live policy per (tenant, request_type, service_code) key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_attachment_policies_key
    ON lex_attachment_policies (tenant_id, request_type, service_code)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lex_attachment_policies_active
    ON lex_attachment_policies (tenant_id, active, updated_at DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE lex_attachment_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_attachment_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_attachment_policies
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_attachment_policies
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_attachment_policies
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_attachment_policies
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- lex_integration_endpoints — external-integration registry (CAP-174..178). The
-- connection config is FieldCrypto-encrypted at rest (CAP-179) into
-- config_encrypted; config_encrypted_flag records whether the envelope carries
-- the enc:v1: prefix. Soft-delete + 4 RLS policies.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lex_integration_endpoints (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    kind                  TEXT        NOT NULL CHECK (kind IN (
        'najiz', 'hr', 'internal', 'archiving', 'email'
    )),
    code                  TEXT        NOT NULL,
    name                  TEXT        NOT NULL,
    description           TEXT        NOT NULL DEFAULT '',
    status                TEXT        NOT NULL DEFAULT 'planned' CHECK (status IN (
        'planned', 'active', 'disabled', 'error'
    )),
    config_encrypted      TEXT        NOT NULL DEFAULT '',
    config_encrypted_flag BOOLEAN     NOT NULL DEFAULT false,
    metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    last_checked_at       TIMESTAMPTZ,
    last_error            TEXT,
    created_by            UUID        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_integration_endpoints_code
    ON lex_integration_endpoints (tenant_id, code)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lex_integration_endpoints_kind
    ON lex_integration_endpoints (tenant_id, kind, status)
    WHERE deleted_at IS NULL;

ALTER TABLE lex_integration_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_integration_endpoints FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_integration_endpoints
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_integration_endpoints
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_integration_endpoints
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_integration_endpoints
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- Seeds (loop over all tenants per the AI-governance seeding rule).
--   * Default integration registry rows (status='planned') for every CAP kind so
--     each tenant sees the four named external systems + email ready to configure.
--     Config is empty plaintext '{}' (no secrets seeded); the service encrypts on
--     first configure. ON CONFLICT keeps re-runs idempotent.
--   * A baseline attachment policy for the GENERAL_LEGAL_REQUEST service code
--     requiring at least one attachment, with a single optional "supporting_doc"
--     slot. Tenants tune via the admin CRUD.
-- The all-zero UUID is the system actor used by other lex seed migrations.
-- -----------------------------------------------------------------------------
INSERT INTO lex_integration_endpoints (tenant_id, kind, code, name, description, status, config_encrypted, config_encrypted_flag, created_by)
SELECT t.id, k.kind, k.code, k.name, k.description, 'planned', '{}', false,
       '00000000-0000-0000-0000-000000000001'::uuid
FROM tenants t
CROSS JOIN (
    VALUES
        ('najiz',     'najiz_default',     'Najiz e-Litigation',        'Saudi MoJ Najiz portal (planned)'),
        ('hr',        'hr_default',        'HR / Identity Feed',        'HR system integration (planned)'),
        ('internal',  'internal_default',  'Internal Systems Bus',      'Generic internal endpoint (planned)'),
        ('archiving', 'archiving_default', 'Records / e-Archiving',     'Archiving system integration (planned)'),
        ('email',     'email_default',     'Outbound Email',            'Outbound email via dispatcher (planned)')
) AS k(kind, code, name, description)
ON CONFLICT (tenant_id, code) WHERE deleted_at IS NULL DO NOTHING;

INSERT INTO lex_attachment_policies (tenant_id, request_type, service_code, name, description, min_attachment_count, slots, active, created_by)
SELECT t.id, '', 'GENERAL_LEGAL_REQUEST',
       '{"ar": "سياسة المرفقات الافتراضية", "en": "Default Attachment Policy"}'::jsonb,
       '{"ar": "تتطلب مرفقاً داعماً واحداً على الأقل", "en": "Requires at least one supporting attachment"}'::jsonb,
       1,
       '[{"key": "supporting_doc", "label": {"ar": "مستند داعم", "en": "Supporting Document"}, "required": false, "sort_order": 10}]'::jsonb,
       true,
       '00000000-0000-0000-0000-000000000001'::uuid
FROM tenants t
ON CONFLICT (tenant_id, request_type, service_code) WHERE deleted_at IS NULL DO NOTHING;
