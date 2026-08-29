-- Infrastructure-as-Code DR (ClarioDR capability #16, DESIGN_DataStream_DR.md §6
-- recovery executor / §11 SLO metrics). DR is not only DATA: to truly recover an
-- estate you must RECONSTITUTE its INFRASTRUCTURE. This schema captures and
-- VERSIONS the protected estate's IaC so a recovery can rebuild it in the right
-- order:
--
--   dr_iac_snapshot  : an immutable, content-hashed VERSION of an estate's IaC at
--                      a point in time. Ingested from a Terraform STATE file
--                      (terraform.tfstate JSON) or a Kubernetes/Helm manifest set
--                      (YAML/JSON manifests, or a Helm release secret which is
--                      base64+gzip+JSON). content_hash is the SHA-256 over the
--                      sorted per-resource hashes, so two ingests of byte-identical
--                      estates hash equal regardless of resource ordering.
--   dr_iac_resource  : one resource WITHIN a snapshot — a graph VERTEX. Keyed for
--                      drift diffing on (provider, type, name). Carries its
--                      normalised attributes (jsonb) and its depends_on / reference
--                      edges (the reconstitution planner topologically orders the
--                      apply over these). resource_hash is the SHA-256 of the
--                      resource's canonical (provider,type,name,attributes,deps)
--                      form, so an attribute change flips the hash.
--
-- Tenant isolation: both tables carry tenant_id and get per-operation RLS with the
-- app.bypass_rls backstop, matching the §7 system-path rule and the dr_db
-- convention. dr_iac_resource scopes through its own tenant_id (denormalised from
-- the parent snapshot) so a resource read needs no join.

CREATE TABLE IF NOT EXISTS dr_iac_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    -- optional consistency group this estate snapshot belongs to; NULL for an
    -- estate-wide capture not yet bound to a recovery group.
    group_id UUID REFERENCES consistency_group(id) ON DELETE SET NULL,
    -- human label for the estate / environment (e.g. 'prod-eu', 'cluster-a').
    name TEXT NOT NULL,
    -- source format of the ingested artifact.
    source_kind TEXT NOT NULL
        CHECK (source_kind IN ('terraform_state','k8s_manifest','helm_release')),
    -- monotonic version per (tenant, name); assigned by the application as
    -- max(version)+1 so successive captures of the same estate are comparable.
    version INT NOT NULL DEFAULT 1,
    -- SHA-256 (hex) over the sorted per-resource hashes — the snapshot identity.
    content_hash TEXT NOT NULL,
    -- count of resources captured (denormalised for cheap listing).
    resource_count INT NOT NULL DEFAULT 0,
    -- free-form provenance (terraform version, lineage, cluster name, ...).
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- two captures of the same estate at the same version are the same snapshot.
    UNIQUE (tenant_id, name, version)
);

CREATE INDEX IF NOT EXISTS idx_dr_iac_snapshot_tenant_name
    ON dr_iac_snapshot (tenant_id, name, version DESC);

CREATE INDEX IF NOT EXISTS idx_dr_iac_snapshot_group
    ON dr_iac_snapshot (group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dr_iac_resource (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    snapshot_id UUID NOT NULL REFERENCES dr_iac_snapshot(id) ON DELETE CASCADE,
    -- the drift-diff key is (provider, type, name). provider is the managing
    -- provider/plugin ('aws','kubernetes','helm',...); type the resource type
    -- ('aws_vpc','Deployment',...); name the local resource name/identifier.
    provider TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    -- a stable, canonical address ('aws_vpc.main', 'apps/v1/Deployment/web') used
    -- for human-facing diffs and as a depends_on reference target.
    address TEXT NOT NULL,
    -- normalised resource attributes (provider 'meta'/timestamps stripped) — the
    -- unit of attribute-level drift comparison.
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- the resource addresses this resource depends on (terraform depends_on +
    -- detected references; k8s ownerReferences / Helm chart order). The
    -- reconstitution planner topologically orders the apply over these edges.
    depends_on JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- SHA-256 (hex) of the canonical (provider,type,name,attributes,depends_on)
    -- form; an attribute change flips it so the diff engine is exact.
    resource_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- a resource key is unique within a snapshot.
    UNIQUE (snapshot_id, provider, type, name)
);

CREATE INDEX IF NOT EXISTS idx_dr_iac_resource_snapshot
    ON dr_iac_resource (snapshot_id, provider, type, name);

CREATE INDEX IF NOT EXISTS idx_dr_iac_resource_tenant
    ON dr_iac_resource (tenant_id);

-- Tenant isolation: per-operation policies with the app.bypass_rls backstop,
-- matching the dr_db convention.
ALTER TABLE dr_iac_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_iac_snapshot FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_iac_resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_iac_resource FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_iac_snapshot;
DROP POLICY IF EXISTS tenant_insert ON dr_iac_snapshot;
DROP POLICY IF EXISTS tenant_update ON dr_iac_snapshot;
DROP POLICY IF EXISTS tenant_delete ON dr_iac_snapshot;

DROP POLICY IF EXISTS tenant_isolation ON dr_iac_resource;
DROP POLICY IF EXISTS tenant_insert ON dr_iac_resource;
DROP POLICY IF EXISTS tenant_update ON dr_iac_resource;
DROP POLICY IF EXISTS tenant_delete ON dr_iac_resource;

-- dr_iac_snapshot
CREATE POLICY tenant_isolation ON dr_iac_snapshot
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_iac_snapshot
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_iac_snapshot
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_iac_snapshot
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- dr_iac_resource
CREATE POLICY tenant_isolation ON dr_iac_resource
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_iac_resource
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_iac_resource
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_iac_resource
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
