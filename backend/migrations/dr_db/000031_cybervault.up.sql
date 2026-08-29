-- Cybervault inventory and posture-assessment persistence.
--
-- dr_cybervault_vault records the provider vaults that can serve as immutable
-- cyber-recovery targets for a consistency group. Provider feeders upsert this
-- inventory by tenant/group/provider/external_id and store their normalised
-- posture evidence as JSONB.
--
-- dr_cybervault_assessment records immutable evaluator outputs. Scalar score,
-- verdict, and evaluated_at columns make latest/list queries cheap, while the
-- full posture and assessment JSONB columns keep each evaluation reproducible.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS dr_cybervault_vault (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'generic',
    name TEXT NOT NULL,
    external_id TEXT NOT NULL,
    posture JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, group_id, provider, external_id),
    CHECK (name <> ''),
    CHECK (external_id <> '')
);

CREATE INDEX IF NOT EXISTS idx_dr_cybervault_vault_group
    ON dr_cybervault_vault (tenant_id, group_id, provider, name);

CREATE INDEX IF NOT EXISTS idx_dr_cybervault_vault_external
    ON dr_cybervault_vault (tenant_id, provider, external_id);

CREATE INDEX IF NOT EXISTS idx_dr_cybervault_vault_posture
    ON dr_cybervault_vault USING GIN (posture);

CREATE TABLE IF NOT EXISTS dr_cybervault_assessment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    vault_id UUID NOT NULL REFERENCES dr_cybervault_vault(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'generic',
    posture JSONB NOT NULL DEFAULT '{}'::jsonb,
    assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
    score DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
    verdict TEXT NOT NULL CHECK (verdict IN ('satisfied','partial','failed')),
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_cybervault_assessment_latest
    ON dr_cybervault_assessment (tenant_id, vault_id, evaluated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_cybervault_assessment_group
    ON dr_cybervault_assessment (tenant_id, group_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_cybervault_assessment_verdict
    ON dr_cybervault_assessment (tenant_id, verdict, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_cybervault_assessment_json
    ON dr_cybervault_assessment USING GIN (assessment);

ALTER TABLE dr_cybervault_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_cybervault_vault FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_cybervault_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_cybervault_assessment FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_cybervault_vault;
DROP POLICY IF EXISTS tenant_insert ON dr_cybervault_vault;
DROP POLICY IF EXISTS tenant_update ON dr_cybervault_vault;
DROP POLICY IF EXISTS tenant_delete ON dr_cybervault_vault;

CREATE POLICY tenant_isolation ON dr_cybervault_vault
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_cybervault_vault
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_cybervault_vault
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_cybervault_vault
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

DROP POLICY IF EXISTS tenant_isolation ON dr_cybervault_assessment;
DROP POLICY IF EXISTS tenant_insert ON dr_cybervault_assessment;
DROP POLICY IF EXISTS tenant_update ON dr_cybervault_assessment;
DROP POLICY IF EXISTS tenant_delete ON dr_cybervault_assessment;

CREATE POLICY tenant_isolation ON dr_cybervault_assessment
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_cybervault_assessment
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_cybervault_assessment
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_cybervault_assessment
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
