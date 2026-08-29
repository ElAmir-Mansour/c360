-- =============================================================================
-- Clario Recover — APPLICATION METASTORE (Prompt 7, the Cutover "Application
-- Metastore" analogue / a CMDB-like source of truth for recovery planning).
--
-- This is the COMPLETE, persistence-backed default implementation behind the
-- recover/metastore.MetastoreClient seam (METASTORE_SEAM.md): a real CMDB-like
-- registry of the applications in a tenant's estate and the recovery-relevant
-- metadata a runbook is built from — owners, environments, dependencies,
-- recovery tier, RTO TARGET (seconds), cloud accounts, and the runbooks linked
-- to each application. The dedicated Metastore product, later in the roadmap,
-- swaps the implementation behind the interface; what these tables back is a
-- real, working feature today, not a thin stub.
--
-- Disjoint ownership: this migration owns its OWN tables; it does not edit any
-- dr/* table. It carries the dr_db RLS clone (cf. 000035 / 000036): every
-- request-path query filters by tenant AND runs under SET LOCAL
-- app.current_tenant_id, with RLS as the backstop; app.bypass_rls is the
-- reserved cross-tenant system escape hatch used elsewhere in dr_db.
--
-- The metadata that drives drift detection (owners / environments / deps /
-- tier / rto / cloud accounts) is fingerprinted into metadata_revision +
-- metadata_hash on every mutating write, so the "sync" action diffs a runbook's
-- recorded source revision against the application's current revision and flags
-- real drift without re-deriving it from scratch.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- recover_metastore_application — one row per registered application.
-- The scalar recovery-planning attributes live here; the multi-valued metadata
-- (owners, environments, dependencies, cloud accounts) lives in the child
-- tables below. recovery_tier and rto_target_seconds are the runbook-shaping
-- drivers; metadata_revision/metadata_hash fingerprint the full metadata so
-- drift is detectable cheaply.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recover_metastore_application (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    -- app_key is the tenant-stable business identifier (e.g. "core-banking").
    -- Unique per tenant so populate/sync can resolve an application by a stable
    -- key, not just a server-assigned UUID.
    app_key TEXT NOT NULL
        CHECK (app_key <> '' AND char_length(app_key) <= 128),
    name TEXT NOT NULL
        CHECK (name <> '' AND char_length(name) <= 256),
    description TEXT NOT NULL DEFAULT '',
    -- recovery_tier classifies the application's criticality; it shapes which
    -- gates a generated runbook includes. Constrained to the known tiers.
    recovery_tier TEXT NOT NULL DEFAULT 'tier_3'
        CHECK (recovery_tier IN ('mission_critical','tier_1','tier_2','tier_3')),
    -- rto_target_seconds is the application's Recovery Time Objective TARGET in
    -- seconds. It is the value the analytics layer (Prompt 8) joins as the RTO.
    rto_target_seconds INTEGER NOT NULL DEFAULT 14400
        CHECK (rto_target_seconds >= 0),
    -- metadata_revision increments on every mutating write that changes the
    -- drift-relevant metadata; metadata_hash is its content fingerprint. The
    -- sync action compares a runbook's recorded revision to the current one.
    metadata_revision INTEGER NOT NULL DEFAULT 1
        CHECK (metadata_revision >= 1),
    metadata_hash TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, app_key)
);

CREATE INDEX IF NOT EXISTS idx_metastore_app_tenant
    ON recover_metastore_application (tenant_id);

-- ---------------------------------------------------------------------------
-- recover_metastore_owner — the application's owners (role-tagged contacts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recover_metastore_owner (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    application_id UUID NOT NULL
        REFERENCES recover_metastore_application (id) ON DELETE CASCADE,
    -- role is the owner's relationship to the app (business / technical /
    -- incident / approver). Free-but-bounded so new roles need no migration.
    role TEXT NOT NULL
        CHECK (role <> '' AND char_length(role) <= 64),
    name TEXT NOT NULL
        CHECK (name <> '' AND char_length(name) <= 256),
    contact TEXT NOT NULL DEFAULT ''
        CHECK (char_length(contact) <= 256),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (application_id, role, name)
);

CREATE INDEX IF NOT EXISTS idx_metastore_owner_app
    ON recover_metastore_owner (application_id);

-- ---------------------------------------------------------------------------
-- recover_metastore_environment — the environments the application runs in
-- (production / dr / staging / ...), with the cloud/region it lives in. The
-- runbook boots one phase per recoverable environment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recover_metastore_environment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    application_id UUID NOT NULL
        REFERENCES recover_metastore_application (id) ON DELETE CASCADE,
    env_key TEXT NOT NULL
        CHECK (env_key <> '' AND char_length(env_key) <= 64),
    kind TEXT NOT NULL DEFAULT 'production'
        CHECK (kind IN ('production','disaster_recovery','staging','test','development')),
    region TEXT NOT NULL DEFAULT ''
        CHECK (char_length(region) <= 128),
    -- is_recovery_target marks the environment a recovery runbook brings up
    -- (the DR target). Only recovery-target environments get a boot phase.
    is_recovery_target BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (application_id, env_key)
);

CREATE INDEX IF NOT EXISTS idx_metastore_env_app
    ON recover_metastore_environment (application_id);

-- ---------------------------------------------------------------------------
-- recover_metastore_dependency — directed edges to other applications this app
-- depends on. depends_on_app_key references another application by its stable
-- key (not a hard FK, so a dependency can be declared before the dependency
-- application is registered — a real CMDB tolerates partial ingestion). The
-- runbook orders a dependency's recovery before the dependent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recover_metastore_dependency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    application_id UUID NOT NULL
        REFERENCES recover_metastore_application (id) ON DELETE CASCADE,
    depends_on_app_key TEXT NOT NULL
        CHECK (depends_on_app_key <> '' AND char_length(depends_on_app_key) <= 128),
    -- criticality records whether the dependency is hard (recovery cannot
    -- proceed without it) or soft (degraded operation possible).
    criticality TEXT NOT NULL DEFAULT 'hard'
        CHECK (criticality IN ('hard','soft')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (application_id, depends_on_app_key)
);

CREATE INDEX IF NOT EXISTS idx_metastore_dep_app
    ON recover_metastore_dependency (application_id);

-- ---------------------------------------------------------------------------
-- recover_metastore_cloud_account — the cloud accounts/subscriptions the
-- application's infrastructure lives in. The runbook surfaces these as the
-- recovery targets to fail into.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recover_metastore_cloud_account (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    application_id UUID NOT NULL
        REFERENCES recover_metastore_application (id) ON DELETE CASCADE,
    provider TEXT NOT NULL
        CHECK (provider IN ('aws','azure','gcp','oci','on_prem')),
    account_ref TEXT NOT NULL
        CHECK (account_ref <> '' AND char_length(account_ref) <= 256),
    region TEXT NOT NULL DEFAULT ''
        CHECK (char_length(region) <= 128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (application_id, provider, account_ref)
);

CREATE INDEX IF NOT EXISTS idx_metastore_cloud_app
    ON recover_metastore_cloud_account (application_id);

-- ---------------------------------------------------------------------------
-- recover_metastore_runbook_link — the runbooks linked to an application,
-- recording WHICH metadata_revision each was populated from. This is the join
-- the sync action uses to flag drift: if a link's source_revision is behind the
-- application's current metadata_revision, the linked runbook is stale.
-- runbook_id references the runbookstudio runbook by id (a soft reference, no
-- cross-table FK, preserving runbookstudio's disjoint ownership).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recover_metastore_runbook_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    application_id UUID NOT NULL
        REFERENCES recover_metastore_application (id) ON DELETE CASCADE,
    runbook_id UUID NOT NULL,
    -- source_revision is the application's metadata_revision at the time the
    -- runbook was populated; source_hash is the matching metadata fingerprint.
    source_revision INTEGER NOT NULL
        CHECK (source_revision >= 1),
    source_hash TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (application_id, runbook_id)
);

CREATE INDEX IF NOT EXISTS idx_metastore_link_app
    ON recover_metastore_runbook_link (application_id);
CREATE INDEX IF NOT EXISTS idx_metastore_link_runbook
    ON recover_metastore_runbook_link (tenant_id, runbook_id);

-- --- Row level security (clone of the dr_db RLS convention) ------------------

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'recover_metastore_application',
        'recover_metastore_owner',
        'recover_metastore_environment',
        'recover_metastore_dependency',
        'recover_metastore_cloud_account',
        'recover_metastore_runbook_link'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_update ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON %I', t);
        EXECUTE format($f$CREATE POLICY tenant_isolation ON %I
            USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))$f$, t);
        EXECUTE format($f$CREATE POLICY tenant_insert ON %I
            FOR INSERT
            WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))$f$, t);
        EXECUTE format($f$CREATE POLICY tenant_update ON %I
            FOR UPDATE
            USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
            WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))$f$, t);
        EXECUTE format($f$CREATE POLICY tenant_delete ON %I
            FOR DELETE
            USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))$f$, t);
    END LOOP;
END $$;
