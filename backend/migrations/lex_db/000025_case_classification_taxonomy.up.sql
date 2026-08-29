-- Case Classification taxonomy (CAP-074, CAP-075, CAP-076).
--
-- Admin-extensible cascading taxonomy of legal-case classifications. tenant_id
-- leads every row (multitenant RLS); parent_id is a self-FK; path is the
-- materialized ancestor path (root-first array of classification ids as text)
-- used for cheap subtree traversal and cascade-path resolution without recursive
-- CTEs at read time. is_system marks the seeded base + cascade rows so the admin
-- CRUD can protect them from deletion while still allowing admins to add their
-- own classifications (CAP-075).
--
-- An append-only governance audit log records every create/update/delete on the
-- taxonomy (INSERT-only RLS, consistent with the Phase-0 governance migration
-- 000016).

CREATE TABLE IF NOT EXISTS legal_case_classifications (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    parent_id   UUID        REFERENCES legal_case_classifications(id) ON DELETE RESTRICT,
    code        TEXT        NOT NULL,
    name        JSONB       NOT NULL DEFAULT '{}',
    path        TEXT[]      NOT NULL DEFAULT '{}',
    is_system   BOOLEAN     NOT NULL DEFAULT false,
    active      BOOLEAN     NOT NULL DEFAULT true,
    sort        INT         NOT NULL DEFAULT 0,
    metadata    JSONB       NOT NULL DEFAULT '{}',
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

-- Partial-unique code per tenant among live rows; supports the seed ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_case_classifications_code_unique
    ON legal_case_classifications (tenant_id, code)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_case_classifications_tenant_active
    ON legal_case_classifications (tenant_id, active, sort)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_case_classifications_parent
    ON legal_case_classifications (tenant_id, parent_id)
    WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE legal_case_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_classifications FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_case_classifications
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_classifications
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_case_classifications
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_case_classifications
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Append-only governance audit log -------------------------------------------
CREATE TABLE IF NOT EXISTS legal_case_classification_audit_log (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    classification_id UUID        NOT NULL,
    action            TEXT        NOT NULL,
    actor_id          UUID,
    before            JSONB,
    after             JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_case_classification_audit_classification
    ON legal_case_classification_audit_log (classification_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_case_classification_audit_tenant
    ON legal_case_classification_audit_log (tenant_id, created_at DESC);

ALTER TABLE legal_case_classification_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_classification_audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_case_classification_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_classification_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
-- No UPDATE/DELETE policies: the audit log is append-only.

-- ---------------------------------------------------------------------------
-- Seed the base taxonomy for every existing tenant.
-- CAP-074: the 8 base classifications (eviction, rent_claim, fair_rent, tax,
-- labor, commercial, enforcement, internal_investigation) as top-level rows.
-- CAP-076: the cascading rental-dispute chain
-- (eviction -> rent_claim -> fair_rent -> tax_committee) as linked parent/child
-- rows with a materialized path, rooted under RENTAL_DISPUTE.
-- The synthetic system actor 00000000-0000-0000-0000-000000000001 owns the
-- seeded rows. Idempotent via the (tenant_id, code) unique index.
-- ---------------------------------------------------------------------------

-- 1. The 8 flat base classifications (CAP-074).
INSERT INTO legal_case_classifications (
    tenant_id, code, name, path, is_system, active, sort, created_by
)
SELECT t.id, b.code, b.name::jsonb, '{}'::text[], true, true, b.sort,
       '00000000-0000-0000-0000-000000000001'::uuid
FROM tenants t
CROSS JOIN (
    VALUES
        ('EVICTION',               '{"ar":"إخلاء","en":"Eviction"}',                              10),
        ('RENT_CLAIM',             '{"ar":"مطالبة بالأجرة","en":"Rent Claim"}',                   20),
        ('FAIR_RENT',             '{"ar":"أجرة المثل","en":"Fair Rent"}',                        30),
        ('TAX',                    '{"ar":"اللجنة الضريبية","en":"Tax Committee"}',               40),
        ('LABOR',                  '{"ar":"عمالية","en":"Labor"}',                                50),
        ('COMMERCIAL',             '{"ar":"تجارية","en":"Commercial"}',                           60),
        ('ENFORCEMENT',            '{"ar":"تنفيذ","en":"Enforcement"}',                           70),
        ('INTERNAL_INVESTIGATION', '{"ar":"تحقيق داخلي","en":"Internal Investigation"}',          80)
) AS b(code, name, sort)
ON CONFLICT DO NOTHING;

-- 2. The cascading rental-dispute chain (CAP-076). A PL/pgSQL block computes the
-- materialized path level by level so each child carries its full ancestry. The
-- root RENTAL_DISPUTE anchors the cascade; codes are distinct (RD_*) so they do
-- not collide with the flat base classifications above.
DO $$
DECLARE
    tenant_rec   RECORD;
    system_actor UUID := '00000000-0000-0000-0000-000000000001';
    root_id      UUID;
    evict_id     UUID;
    rent_id      UUID;
    fair_id      UUID;
BEGIN
    FOR tenant_rec IN SELECT id FROM tenants LOOP
        -- Root of the cascade.
        SELECT id INTO root_id
        FROM legal_case_classifications
        WHERE tenant_id = tenant_rec.id AND code = 'RENTAL_DISPUTE' AND deleted_at IS NULL;
        IF root_id IS NULL THEN
            INSERT INTO legal_case_classifications (tenant_id, parent_id, code, name, path, is_system, active, sort, created_by)
            VALUES (tenant_rec.id, NULL, 'RENTAL_DISPUTE',
                    '{"ar":"نزاع إيجاري","en":"Rental Dispute"}'::jsonb,
                    '{}'::text[], true, true, 5, system_actor)
            RETURNING id INTO root_id;
        END IF;

        -- Level 1: eviction.
        SELECT id INTO evict_id
        FROM legal_case_classifications
        WHERE tenant_id = tenant_rec.id AND code = 'RD_EVICTION' AND deleted_at IS NULL;
        IF evict_id IS NULL THEN
            INSERT INTO legal_case_classifications (tenant_id, parent_id, code, name, path, is_system, active, sort, created_by)
            VALUES (tenant_rec.id, root_id, 'RD_EVICTION',
                    '{"ar":"إخلاء","en":"Eviction"}'::jsonb,
                    ARRAY[root_id::text], true, true, 10, system_actor)
            RETURNING id INTO evict_id;
        END IF;

        -- Level 2: rent_claim under eviction.
        SELECT id INTO rent_id
        FROM legal_case_classifications
        WHERE tenant_id = tenant_rec.id AND code = 'RD_RENT_CLAIM' AND deleted_at IS NULL;
        IF rent_id IS NULL THEN
            INSERT INTO legal_case_classifications (tenant_id, parent_id, code, name, path, is_system, active, sort, created_by)
            VALUES (tenant_rec.id, evict_id, 'RD_RENT_CLAIM',
                    '{"ar":"مطالبة بالأجرة","en":"Rent Claim"}'::jsonb,
                    ARRAY[root_id::text, evict_id::text], true, true, 20, system_actor)
            RETURNING id INTO rent_id;
        END IF;

        -- Level 3: fair_rent under rent_claim.
        SELECT id INTO fair_id
        FROM legal_case_classifications
        WHERE tenant_id = tenant_rec.id AND code = 'RD_FAIR_RENT' AND deleted_at IS NULL;
        IF fair_id IS NULL THEN
            INSERT INTO legal_case_classifications (tenant_id, parent_id, code, name, path, is_system, active, sort, created_by)
            VALUES (tenant_rec.id, rent_id, 'RD_FAIR_RENT',
                    '{"ar":"أجرة المثل","en":"Fair Rent"}'::jsonb,
                    ARRAY[root_id::text, evict_id::text, rent_id::text], true, true, 30, system_actor)
            RETURNING id INTO fair_id;
        END IF;

        -- Level 4: tax_committee under fair_rent.
        IF NOT EXISTS (
            SELECT 1 FROM legal_case_classifications
            WHERE tenant_id = tenant_rec.id AND code = 'RD_TAX_COMMITTEE' AND deleted_at IS NULL
        ) THEN
            INSERT INTO legal_case_classifications (tenant_id, parent_id, code, name, path, is_system, active, sort, created_by)
            VALUES (tenant_rec.id, fair_id, 'RD_TAX_COMMITTEE',
                    '{"ar":"اللجنة الضريبية","en":"Tax Committee"}'::jsonb,
                    ARRAY[root_id::text, evict_id::text, rent_id::text, fair_id::text], true, true, 40, system_actor);
        END IF;
    END LOOP;
END $$;
