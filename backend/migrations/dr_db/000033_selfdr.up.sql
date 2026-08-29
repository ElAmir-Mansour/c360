-- Control-plane self-DR / meta-DR (internal/dr/selfdr). The DR control plane must
-- itself be recoverable after a control-plane loss. The selfdr package evaluates
-- whether the control plane has enough independently recoverable evidence to
-- rebuild itself (immutable + encrypted backups, restore-test freshness, an
-- offline restore bundle, an independent recovery location, break-glass access)
-- and produces an ordered restore-wave plan. The OPERATIONAL capabilities are
-- real: a control-plane backup is captured (e.g. pg_dump of dr_db) and sealed to
-- the WORM store, and a deterministic offline restore bundle (profile +
-- assessment + restore plan + operator runbook) is rendered and sealed.
--
-- This migration owns the two PERSISTED tables that record those outputs:
--
--   dr_selfdr_assessment : the header of one readiness assessment — the profile
--                          evaluated, the aggregate verdict (ready|degraded|
--                          not_ready), the critical/warning/info finding tallies,
--                          and the full findings list + restore plan as JSONB so a
--                          report reconstructs without re-running the evaluator.
--   dr_selfdr_artifact   : the durable record of one WORM-sealed self-DR artifact
--                          — a control-plane backup or an offline restore bundle —
--                          with its object key/version, plaintext sha256, size,
--                          retention horizon, and the kind-specific evidence
--                          object (BackupEvidence / OfflineRestoreBundle) as JSONB.
--                          Readiness assessments read this evidence back to score
--                          the profile against what the platform actually holds.
--
-- Tenant isolation: both tables carry tenant_id and get per-operation RLS with
-- the app.bypass_rls backstop, matching the §7 system-path rule and the dr_db
-- convention. The control plane serves all tenants; self-DR operations are run by
-- the platform operator within their own tenant scope (dr:admin), so each tenant's
-- self-DR record is isolated like every other dr_db row.

CREATE TABLE IF NOT EXISTS dr_selfdr_assessment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    -- the self-DR profile id evaluated (operator-supplied or the baseline id).
    profile_id TEXT NOT NULL DEFAULT '',
    -- aggregate readiness verdict.
    verdict TEXT NOT NULL DEFAULT 'not_ready'
        CHECK (verdict IN ('ready','degraded','not_ready')),
    -- finding tallies (denormalised for cheap listing).
    critical INT NOT NULL DEFAULT 0,
    warning INT NOT NULL DEFAULT 0,
    info INT NOT NULL DEFAULT 0,
    -- the full ordered findings list that produced the verdict.
    findings JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- the ordered restore-wave plan for rebuilding the control plane.
    restore_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- the operator who ran the assessment.
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_selfdr_assessment_tenant
    ON dr_selfdr_assessment (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dr_selfdr_artifact (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    -- the artifact class: a control-plane backup or an offline restore bundle.
    kind TEXT NOT NULL
        CHECK (kind IN ('control_plane_backup','offline_restore_bundle')),
    -- the control-plane component this backup covers (empty for a bundle, which
    -- spans the whole profile).
    component_id TEXT NOT NULL DEFAULT '',
    component_kind TEXT NOT NULL DEFAULT '',
    -- WORM object identity: the object key and the object version object-lock
    -- protects (a destructive delete must target this version).
    object_key TEXT NOT NULL DEFAULT '',
    uri TEXT NOT NULL DEFAULT '',
    version_id TEXT NOT NULL DEFAULT '',
    -- plaintext sha256 (tamper-evidence) and on-disk (encrypted) size.
    sha256 TEXT NOT NULL DEFAULT '',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- object-lock retention horizon (NULL when the store's default applies).
    retain_until TIMESTAMPTZ,
    location_id TEXT NOT NULL DEFAULT '',
    immutable BOOLEAN NOT NULL DEFAULT false,
    encrypted BOOLEAN NOT NULL DEFAULT false,
    -- the kind-specific evidence object the readiness evaluator reads back.
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- profile enrichment reads the latest backup per component and the latest bundle,
-- ordered by capture time; index by the keys those reads order on.
CREATE INDEX IF NOT EXISTS idx_dr_selfdr_artifact_component
    ON dr_selfdr_artifact (tenant_id, kind, component_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_selfdr_artifact_recent
    ON dr_selfdr_artifact (tenant_id, created_at DESC);

-- Tenant isolation: per-operation policies with the app.bypass_rls backstop,
-- matching the dr_db convention.
ALTER TABLE dr_selfdr_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_selfdr_assessment FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_selfdr_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_selfdr_artifact FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_selfdr_assessment;
DROP POLICY IF EXISTS tenant_insert ON dr_selfdr_assessment;
DROP POLICY IF EXISTS tenant_update ON dr_selfdr_assessment;
DROP POLICY IF EXISTS tenant_delete ON dr_selfdr_assessment;

DROP POLICY IF EXISTS tenant_isolation ON dr_selfdr_artifact;
DROP POLICY IF EXISTS tenant_insert ON dr_selfdr_artifact;
DROP POLICY IF EXISTS tenant_update ON dr_selfdr_artifact;
DROP POLICY IF EXISTS tenant_delete ON dr_selfdr_artifact;

-- dr_selfdr_assessment
CREATE POLICY tenant_isolation ON dr_selfdr_assessment
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_selfdr_assessment
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_selfdr_assessment
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_selfdr_assessment
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- dr_selfdr_artifact
CREATE POLICY tenant_isolation ON dr_selfdr_artifact
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_selfdr_artifact
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_selfdr_artifact
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_selfdr_artifact
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
