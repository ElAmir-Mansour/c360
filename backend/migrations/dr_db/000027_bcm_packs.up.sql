-- Business-Continuity-Management (BCM) compliance packs (ClarioDR capability
-- #18, DESIGN_DataStream_DR.md §6 attestation / §9 reporting). BCM compliance
-- packs map ClarioDR controls to recognised continuity/DR standards (ISO 22301,
-- ISO/IEC 27031, NCA ECC business-continuity domain, SAMA BCM) and auto-generate
-- auditor-ready evidence + gap analysis from REAL platform DR data (drill
-- results, RTO/RPO attestations, validated recovery points, failover runs,
-- clean-room verdicts).
--
-- The pack/control CATALOG itself is deterministic code (internal/dr/bcm) and
-- is materialized by 000030 into global reference tables. This migration owns
-- the two PERSISTED tables that record the OUTPUT of running a pack against a
-- tenant's estate:
--
--   dr_bcm_assessment      : the header row of one assessment run — which pack
--                            was evaluated against which consistency group, the
--                            aggregate compliance score (0-100), the overall
--                            compliant flag (no mandatory control failed AND
--                            score >= threshold), and the satisfied/partial/
--                            failed control tallies. The pack_key + pack_version
--                            cite the exact catalog version evaluated so an old
--                            assessment is reproducible/explainable.
--   dr_bcm_control_result  : one row per control evaluated in that assessment —
--                            the satisfied/partial/failed verdict, the
--                            human-readable reason (the gap explanation when not
--                            satisfied), whether the control is mandatory, its
--                            scoring weight, and the JSONB array of evidence ids
--                            (drill/attestation/recovery-point/clean-room ids)
--                            that drove the verdict (auditor traceability).
--
-- Tenant isolation: both tables carry tenant_id and get per-operation RLS with
-- the app.bypass_rls backstop, matching the §7 system-path rule and the dr_db
-- convention. dr_bcm_control_result scopes through its own tenant_id
-- (denormalised from the parent assessment) so a result read needs no join.

CREATE TABLE IF NOT EXISTS dr_bcm_assessment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    -- the consistency group whose estate was assessed.
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    -- the catalog pack key evaluated ('iso22301', 'nca-sama-bcm', ...).
    pack_key TEXT NOT NULL,
    -- the standard citation copied from the pack at evaluation time.
    standard TEXT NOT NULL,
    -- the pack version evaluated, so an assessment is reproducible against the
    -- exact catalog definition that produced it.
    pack_version TEXT NOT NULL DEFAULT '',
    -- weighted compliance score in [0,100], rounded to two decimals.
    score NUMERIC(5,2) NOT NULL DEFAULT 0,
    -- true only when no mandatory control failed AND score meets the threshold.
    compliant BOOLEAN NOT NULL DEFAULT false,
    -- control tallies (denormalised for cheap listing/reporting).
    total_controls INT NOT NULL DEFAULT 0,
    satisfied INT NOT NULL DEFAULT 0,
    partial INT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    -- the user who ran the assessment.
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_bcm_assessment_tenant_group
    ON dr_bcm_assessment (tenant_id, group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_bcm_assessment_pack
    ON dr_bcm_assessment (tenant_id, pack_key, created_at DESC);

CREATE TABLE IF NOT EXISTS dr_bcm_control_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    assessment_id UUID NOT NULL REFERENCES dr_bcm_assessment(id) ON DELETE CASCADE,
    -- the standard's control identifier ('BC-3', 'ISO22301-8.4.4', ...).
    control_code TEXT NOT NULL,
    -- human-facing control title copied from the catalog for self-contained
    -- reports (a report renders without re-reading the catalog).
    control_title TEXT NOT NULL,
    -- the evaluation verdict for this control.
    verdict TEXT NOT NULL CHECK (verdict IN ('satisfied','partial','failed')),
    -- why the verdict was reached; the gap explanation when not satisfied.
    reason TEXT NOT NULL DEFAULT '',
    -- a mandatory control's failure fails the whole pack regardless of score.
    mandatory BOOLEAN NOT NULL DEFAULT false,
    -- scoring weight (>=1) biasing the aggregate toward critical controls.
    weight INT NOT NULL DEFAULT 1,
    -- JSONB array of evidence ids (drill/attestation/recovery-point/clean-room)
    -- that drove the verdict — auditor traceability from verdict back to data.
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- a control appears once per assessment.
    UNIQUE (assessment_id, control_code)
);

CREATE INDEX IF NOT EXISTS idx_dr_bcm_control_result_assessment
    ON dr_bcm_control_result (assessment_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_dr_bcm_control_result_tenant
    ON dr_bcm_control_result (tenant_id);

-- Tenant isolation: per-operation policies with the app.bypass_rls backstop,
-- matching the dr_db convention.
ALTER TABLE dr_bcm_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_bcm_assessment FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_bcm_control_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_bcm_control_result FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_bcm_assessment;
DROP POLICY IF EXISTS tenant_insert ON dr_bcm_assessment;
DROP POLICY IF EXISTS tenant_update ON dr_bcm_assessment;
DROP POLICY IF EXISTS tenant_delete ON dr_bcm_assessment;

DROP POLICY IF EXISTS tenant_isolation ON dr_bcm_control_result;
DROP POLICY IF EXISTS tenant_insert ON dr_bcm_control_result;
DROP POLICY IF EXISTS tenant_update ON dr_bcm_control_result;
DROP POLICY IF EXISTS tenant_delete ON dr_bcm_control_result;

-- dr_bcm_assessment
CREATE POLICY tenant_isolation ON dr_bcm_assessment
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_bcm_assessment
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_bcm_assessment
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_bcm_assessment
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- dr_bcm_control_result
CREATE POLICY tenant_isolation ON dr_bcm_control_result
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_bcm_control_result
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_bcm_control_result
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_bcm_control_result
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
