-- Service Catalog & Request Intake (CAP-001, CAP-002, CAP-003, CAP-004, CAP-005,
-- CAP-008, CAP-015, CAP-174).
--
-- Three tenant-scoped tables (RLS policies added below, currently inert under
-- the superuser lex pool — see 000002; the explicit WHERE tenant_id filter in
-- the repositories is the live control) plus an append-only intake-message
-- log:
--   legal_service_catalog            : the published legal services (admin-editable)
--   legal_service_eligibility_rules  : CAP-008 ANY-of eligibility predicates
--   legal_intake_mailboxes           : email->routing mailboxes (HMAC-protected)
--   legal_intake_messages            : ingested email intake messages (Message-ID dedup)
--
-- service_id / beneficiary_entity_id / approval_policy_id are decoupled uuid
-- references (NO hard FK) mirroring the legal_requests spine convention so the
-- modules stay independently deployable across separate databases.

-- ---------------------------------------------------------------------------
-- legal_service_catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_service_catalog (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID        NOT NULL,
    code                        TEXT        NOT NULL,
    request_type                TEXT        NOT NULL,
    name                        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    description                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
    available_to                TEXT[]      NOT NULL DEFAULT '{}',
    requester_approval_required BOOLEAN     NOT NULL DEFAULT false,
    provider_approval_required  BOOLEAN     NOT NULL DEFAULT false,
    approval_policy_id          UUID,
    intake_email                TEXT,
    channel                     TEXT        NOT NULL DEFAULT 'platform' CHECK (channel IN ('platform', 'email', 'both')),
    active                      BOOLEAN     NOT NULL DEFAULT true,
    metadata                    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by                  UUID        NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at                  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_service_catalog_code_unique
    ON legal_service_catalog (tenant_id, code)
    WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_service_catalog_intake_email_unique
    ON legal_service_catalog (tenant_id, lower(intake_email))
    WHERE intake_email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_service_catalog_tenant_active
    ON legal_service_catalog (tenant_id, active, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_service_catalog_request_type
    ON legal_service_catalog (tenant_id, request_type)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_service_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_service_catalog FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_service_catalog
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_service_catalog
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_service_catalog
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_service_catalog
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- legal_service_eligibility_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_service_eligibility_rules (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    service_id  UUID        NOT NULL REFERENCES legal_service_catalog(id) ON DELETE CASCADE,
    rule_type   TEXT        NOT NULL CHECK (rule_type IN ('all', 'department', 'role', 'doa_matrix')),
    value       TEXT        NOT NULL DEFAULT '',
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_service_eligibility_rules_service
    ON legal_service_eligibility_rules (tenant_id, service_id)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_service_eligibility_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_service_eligibility_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_service_eligibility_rules
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_service_eligibility_rules
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_service_eligibility_rules
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_service_eligibility_rules
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- legal_intake_mailboxes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_intake_mailboxes (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    address               TEXT        NOT NULL,
    request_type          TEXT        NOT NULL,
    service_id            UUID,
    beneficiary_entity_id UUID,
    -- HMAC ingest secret, encrypted at rest via lex field crypto ("enc:v1:...").
    ingest_secret_hash    TEXT        NOT NULL DEFAULT '',
    active                BOOLEAN     NOT NULL DEFAULT true,
    metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by            UUID        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_intake_mailboxes_address_unique
    ON legal_intake_mailboxes (tenant_id, lower(address))
    WHERE deleted_at IS NULL;
-- Global address lookup for the public webhook (tenant discovered from the row).
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_intake_mailboxes_global_address_unique
    ON legal_intake_mailboxes (lower(address))
    WHERE deleted_at IS NULL AND active = true;
CREATE INDEX IF NOT EXISTS idx_legal_intake_mailboxes_tenant_active
    ON legal_intake_mailboxes (tenant_id, active, updated_at DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_intake_mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_intake_mailboxes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_intake_mailboxes
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_intake_mailboxes
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_intake_mailboxes
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_intake_mailboxes
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- The public email webhook resolves the addressed mailbox BEFORE a tenant
-- context exists; it runs in a system (RLS-bypass) transaction. Allow the
-- bypass session GUC to read rows (mirrors the platform-wide bypass policy).
CREATE POLICY system_bypass_select ON legal_intake_mailboxes
    FOR SELECT
    USING (current_setting('app.bypass_rls', true) = 'on');

-- ---------------------------------------------------------------------------
-- legal_intake_messages (append-only intake log with Message-ID dedup)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_intake_messages (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID        NOT NULL,
    mailbox_id              UUID        REFERENCES legal_intake_mailboxes(id) ON DELETE SET NULL,
    provider_message_id     TEXT        NOT NULL,
    from_address            TEXT        NOT NULL DEFAULT '',
    to_address              TEXT        NOT NULL DEFAULT '',
    subject                 TEXT        NOT NULL DEFAULT '',
    raw_file_id             UUID,
    attachment_file_ids     UUID[]      NOT NULL DEFAULT '{}',
    classified_request_type TEXT,
    beneficiary_entity_id   UUID,
    legal_request_id        UUID,
    status                  TEXT        NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'classified', 'routed', 'rejected')),
    classifier_reason       TEXT,
    error_message           TEXT,
    metadata                JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by              UUID        NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CAP-002 Message-ID idempotency: at most one row per (tenant, provider_message_id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_intake_messages_provider_msg_unique
    ON legal_intake_messages (tenant_id, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_legal_intake_messages_tenant_status
    ON legal_intake_messages (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_intake_messages_mailbox
    ON legal_intake_messages (tenant_id, mailbox_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_intake_messages_request
    ON legal_intake_messages (tenant_id, legal_request_id)
    WHERE legal_request_id IS NOT NULL;

ALTER TABLE legal_intake_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_intake_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_intake_messages
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_intake_messages
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_intake_messages
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_intake_messages
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- Seed the 8 default legal services for every existing tenant when a local
-- tenant registry is present (CAP-001). The initial lex_db migration creates an
-- empty compatibility registry for standalone deployments, so this is a no-op
-- until tenants have been provisioned or mirrored locally.
-- Idempotent: ON CONFLICT on the (tenant_id, code) unique index. The synthetic
-- system actor 00000000-0000-0000-0000-000000000001 owns the seeded rows.
-- ---------------------------------------------------------------------------
DO $seed_legal_service_catalog$
BEGIN
    IF to_regclass('public.tenants') IS NOT NULL THEN
        INSERT INTO legal_service_catalog (
            tenant_id, code, request_type, name, description, available_to,
            requester_approval_required, provider_approval_required, channel, active, created_by
        )
        SELECT t.id, s.code, s.request_type, s.name::jsonb, s.description::jsonb, '{}'::text[],
               s.requester_approval_required, s.provider_approval_required, s.channel, true,
               '00000000-0000-0000-0000-000000000001'::uuid
        FROM tenants t
        CROSS JOIN (
            VALUES
                ('LEGAL_CONSULTATION', 'legal_consultation',
                 '{"ar":"استشارة قانونية","en":"Legal Consultation"}',
                 '{"ar":"طلب استشارة قانونية عامة","en":"Request a general legal consultation"}',
                 false, true, 'both'),
                ('CONTRACT_REVIEW', 'contract_review',
                 '{"ar":"مراجعة عقد","en":"Contract Review"}',
                 '{"ar":"مراجعة وصياغة العقود والاتفاقيات","en":"Review and drafting of contracts and agreements"}',
                 true, true, 'both'),
                ('CONTRACT_DRAFTING', 'contract_drafting',
                 '{"ar":"صياغة عقد","en":"Contract Drafting"}',
                 '{"ar":"إعداد مسودة عقد جديد","en":"Prepare a new contract draft"}',
                 true, true, 'both'),
                ('LITIGATION_SUPPORT', 'litigation_support',
                 '{"ar":"دعم التقاضي","en":"Litigation Support"}',
                 '{"ar":"دعم القضايا والمنازعات القضائية","en":"Support for cases and judicial disputes"}',
                 true, true, 'both'),
                ('LEGAL_OPINION', 'legal_opinion',
                 '{"ar":"رأي قانوني","en":"Legal Opinion"}',
                 '{"ar":"طلب رأي قانوني رسمي","en":"Request a formal legal opinion"}',
                 false, true, 'both'),
                ('REGULATORY_COMPLIANCE', 'regulatory_compliance',
                 '{"ar":"الامتثال التنظيمي","en":"Regulatory Compliance"}',
                 '{"ar":"مراجعة الامتثال للأنظمة واللوائح","en":"Review compliance with regulations"}',
                 false, true, 'both'),
                ('POWER_OF_ATTORNEY', 'power_of_attorney',
                 '{"ar":"توكيل","en":"Power of Attorney"}',
                 '{"ar":"إعداد أو مراجعة توكيل","en":"Prepare or review a power of attorney"}',
                 true, true, 'both'),
                ('GENERAL_LEGAL_REQUEST', 'general_legal_request',
                 '{"ar":"طلب قانوني عام","en":"General Legal Request"}',
                 '{"ar":"طلب خدمة قانونية غير مصنفة","en":"An uncategorized legal service request"}',
                 false, false, 'both')
        ) AS s(code, request_type, name, description, requester_approval_required, provider_approval_required, channel)
        ON CONFLICT DO NOTHING;
    END IF;
END
$seed_legal_service_catalog$;
