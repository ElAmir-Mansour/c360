-- Continuous recovery-assurance scoring (internal/dr/assurance). The assurance
-- evaluator scores a consistency group's OPERATIONAL recovery posture against a
-- weighted control set (drill cadence, non-disruptive drill success, application
-- and clean-room verification, RPO-breach status, infrastructure drift, runbook
-- freshness, dependency/bootgraph validation, last failback test, evidence
-- recency) using REAL DR data — drill results, clean-room scans, boot runs,
-- failback runs, runbook versions, and replication-lag samples. Where the
-- companion bcm packs map controls to regulatory STANDARDS (ISO 22301, NCA/SAMA),
-- this scores continuous operational recovery KPIs; the two are deliberately
-- distinct control sets persisted in their own tables.
--
-- The control catalog is deterministic code (assuranceControls in evaluator.go),
-- so unlike bcm there is no reference-catalog table to materialize. This
-- migration owns the two PERSISTED tables that record the OUTPUT of running an
-- evaluation against a tenant's group:
--
--   dr_assurance_assessment : the header row of one evaluation — which group was
--                             scored, the weighted assurance score (0-100), the
--                             overall verdict (satisfied|partial|failed), and the
--                             satisfied/partial/failed control tallies, plus
--                             the evidence snapshot used for scoring.
--   dr_assurance_result     : one row per control evaluated — the verdict, the
--                             finding severity (warning|high|critical when not
--                             satisfied), the scoring weight, the human-readable
--                             message, the machine-readable next-action
--                             recommendation, and the JSONB array of evidence ids
--                             (drill/verification/drift/rpo ids) that drove the
--                             verdict (auditor traceability).
--
-- Tenant isolation: both tables carry tenant_id and get per-operation RLS with
-- the app.bypass_rls backstop, matching the §7 system-path rule and the dr_db
-- convention. dr_assurance_result scopes through its own tenant_id (denormalised
-- from the parent assessment) so a result read needs no join.

CREATE TABLE IF NOT EXISTS dr_assurance_assessment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    -- the consistency group whose recovery posture was scored.
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    -- the assurance profile identity evaluated (empty for the default profile
    -- derived from the group); reserved for future per-workload named profiles.
    profile_id TEXT NOT NULL DEFAULT '',
    -- optional workload scope within the group (empty for a group-level score).
    workload_id TEXT NOT NULL DEFAULT '',
    -- weighted assurance score in [0,100], rounded to two decimals.
    score NUMERIC(5,2) NOT NULL DEFAULT 0,
    -- the aggregate verdict: the worst per-control verdict observed.
    verdict TEXT NOT NULL DEFAULT 'failed'
        CHECK (verdict IN ('satisfied','partial','failed')),
    -- control tallies (denormalised for cheap listing/reporting).
    total_checks INT NOT NULL DEFAULT 0,
    satisfied INT NOT NULL DEFAULT 0,
    partial INT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    -- immutable normalised evidence bundle used for scoring; this keeps reports
    -- reproducible after source tables continue to change.
    evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
    -- the user who ran the evaluation.
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_assurance_assessment_tenant_group
    ON dr_assurance_assessment (tenant_id, group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dr_assurance_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    assessment_id UUID NOT NULL REFERENCES dr_assurance_assessment(id) ON DELETE CASCADE,
    -- the assurance control identifier ('drill_cadence', 'rpo_breach_status', ...).
    control_code TEXT NOT NULL,
    -- human-facing control title copied from the catalog for self-contained
    -- reports (a report renders without re-reading the catalog).
    control_title TEXT NOT NULL,
    -- the evaluation verdict for this control.
    verdict TEXT NOT NULL CHECK (verdict IN ('satisfied','partial','failed')),
    -- finding severity when not satisfied ('' for a satisfied control).
    severity TEXT NOT NULL DEFAULT ''
        CHECK (severity IN ('','warning','high','critical')),
    -- scoring weight (>=1) biasing the aggregate toward critical controls.
    weight INT NOT NULL DEFAULT 1,
    -- why the verdict was reached; the gap explanation when not satisfied.
    message TEXT NOT NULL DEFAULT '',
    -- the stable machine-readable next action ('schedule_drill', ...) for a gap.
    recommendation TEXT NOT NULL DEFAULT '',
    -- JSONB array of evidence ids (drill/verification/drift/rpo) that drove the
    -- verdict — auditor traceability from verdict back to data.
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- a control appears once per assessment.
    UNIQUE (assessment_id, control_code)
);

CREATE INDEX IF NOT EXISTS idx_dr_assurance_result_assessment
    ON dr_assurance_result (assessment_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_dr_assurance_result_tenant
    ON dr_assurance_result (tenant_id);

-- Tenant isolation: per-operation policies with the app.bypass_rls backstop,
-- matching the dr_db convention.
ALTER TABLE dr_assurance_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_assurance_assessment FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_assurance_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_assurance_result FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_assurance_assessment;
DROP POLICY IF EXISTS tenant_insert ON dr_assurance_assessment;
DROP POLICY IF EXISTS tenant_update ON dr_assurance_assessment;
DROP POLICY IF EXISTS tenant_delete ON dr_assurance_assessment;

DROP POLICY IF EXISTS tenant_isolation ON dr_assurance_result;
DROP POLICY IF EXISTS tenant_insert ON dr_assurance_result;
DROP POLICY IF EXISTS tenant_update ON dr_assurance_result;
DROP POLICY IF EXISTS tenant_delete ON dr_assurance_result;

-- dr_assurance_assessment
CREATE POLICY tenant_isolation ON dr_assurance_assessment
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_assurance_assessment
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_assurance_assessment
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_assurance_assessment
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- dr_assurance_result
CREATE POLICY tenant_isolation ON dr_assurance_result
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_assurance_result
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_assurance_result
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_assurance_result
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
