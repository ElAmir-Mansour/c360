-- Dependency-aware boot orchestration (ClarioDR capability #13,
-- DESIGN_DataStream_DR.md §6.3 recovery executor, §11 SLO metrics). The §6.3
-- recovery executor boots a consistency group in a FLAT boot_order; this schema
-- generalises that to the APPLICATION-SERVICE DEPENDENCY GRAPH: each recoverable
-- service declares which other services it depends_on, the planner levelises the
-- graph into BOOT TIERS (services whose deps are all in earlier tiers), and the
-- orchestrator boots tier-by-tier with HEALTH-GATE barriers (parallel within a
-- tier, ordered across tiers).
--
-- dr_boot_service        : a recoverable application service — a graph VERTEX —
--                          with its health-check spec (http|tcp|script probe).
--                          UNIQUE (group_id, name) so a service name is unique
--                          within a group; depends_on edges reference it.
-- dr_boot_dependency     : a directed depends_on edge service -> depends_on. The
--                          application layer guarantees acyclicity via DFS cycle
--                          detection on every definition; UNIQUE forbids a dup.
-- dr_boot_run            : a durable execution of a group's boot plan (status,
--                          failure policy, tiers booted).
-- dr_boot_service_status : per-service status within a run (tier, status,
--                          attempts, timestamps) — the durable progress record.

CREATE TABLE IF NOT EXISTS dr_boot_service (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    -- unique service identifier within the group (e.g. 'database','api'); the
    -- depends_on edges and per-run status rows reference it by name/id.
    name TEXT NOT NULL,
    -- advisory classifier (database|cache|api|worker|web|lb|...); the planner
    -- orders strictly by declared dependencies, not by kind.
    kind TEXT NOT NULL DEFAULT '',
    -- health-check spec the orchestrator probes after issuing the service's boot.
    probe_kind TEXT NOT NULL DEFAULT 'tcp'
        CHECK (probe_kind IN ('http','tcp','script')),
    probe_target TEXT NOT NULL DEFAULT '',
    -- expected HTTP status for an http probe; 0 means "any 2xx".
    probe_expect_status INT NOT NULL DEFAULT 0,
    -- per-attempt boot+health timeout (seconds); 0 -> orchestrator default (30s).
    boot_timeout_seconds INT NOT NULL DEFAULT 30,
    -- extra probe attempts after the first before declaring the service unhealthy.
    health_retries INT NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (group_id, name)
);

CREATE INDEX IF NOT EXISTS idx_dr_boot_service_group
    ON dr_boot_service (group_id, name);

CREATE TABLE IF NOT EXISTS dr_boot_dependency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    -- service_id depends on depends_on_id: depends_on_id must be healthy in an
    -- earlier tier before service_id may boot.
    service_id UUID NOT NULL REFERENCES dr_boot_service(id) ON DELETE CASCADE,
    depends_on_id UUID NOT NULL REFERENCES dr_boot_service(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- no duplicate parallel depends_on edge between the same two services.
    UNIQUE (service_id, depends_on_id),
    -- a self-dependency is the trivial cycle; reject it at the schema level too.
    CHECK (service_id <> depends_on_id)
);

CREATE INDEX IF NOT EXISTS idx_dr_boot_dependency_service
    ON dr_boot_dependency (service_id);

CREATE INDEX IF NOT EXISTS idx_dr_boot_dependency_dependson
    ON dr_boot_dependency (depends_on_id);

CREATE INDEX IF NOT EXISTS idx_dr_boot_dependency_group
    ON dr_boot_dependency (group_id);

CREATE TABLE IF NOT EXISTS dr_boot_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','completed','failed','rolled_back')),
    -- failure policy when a tier never goes healthy within budget.
    policy TEXT NOT NULL DEFAULT 'halt'
        CHECK (policy IN ('halt','rollback')),
    total_tiers INT NOT NULL DEFAULT 0,
    tiers_booted INT NOT NULL DEFAULT 0,
    initiated_by UUID,
    last_error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dr_boot_run_group
    ON dr_boot_run (group_id, started_at DESC);

CREATE TABLE IF NOT EXISTS dr_boot_service_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES dr_boot_run(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES dr_boot_service(id) ON DELETE CASCADE,
    -- denormalised service name so a status read needs no join (and survives a
    -- service rename/delete for audit).
    service_name TEXT NOT NULL,
    tier INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','booting','healthy','unhealthy','rolled_back')),
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    booted_at TIMESTAMPTZ,
    healthy_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- one status row per (run, service).
    UNIQUE (run_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_dr_boot_service_status_run
    ON dr_boot_service_status (run_id, tier, service_name);

-- Tenant isolation: every table is request-path readable/writable and carries
-- RLS with the app.bypass_rls backstop (matching the §7 system-path rule and the
-- dr_db convention — per-operation policies). dr_boot_service_status has no
-- tenant_id column of its own (it hangs off dr_boot_run); it is protected via the
-- run-scoped policy below that checks the parent run's tenant.
ALTER TABLE dr_boot_service ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_boot_service FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_boot_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_boot_dependency FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_boot_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_boot_run FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_boot_service_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_boot_service_status FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_boot_service;
DROP POLICY IF EXISTS tenant_insert ON dr_boot_service;
DROP POLICY IF EXISTS tenant_update ON dr_boot_service;
DROP POLICY IF EXISTS tenant_delete ON dr_boot_service;

DROP POLICY IF EXISTS tenant_isolation ON dr_boot_dependency;
DROP POLICY IF EXISTS tenant_insert ON dr_boot_dependency;
DROP POLICY IF EXISTS tenant_update ON dr_boot_dependency;
DROP POLICY IF EXISTS tenant_delete ON dr_boot_dependency;

DROP POLICY IF EXISTS tenant_isolation ON dr_boot_run;
DROP POLICY IF EXISTS tenant_insert ON dr_boot_run;
DROP POLICY IF EXISTS tenant_update ON dr_boot_run;
DROP POLICY IF EXISTS tenant_delete ON dr_boot_run;

DROP POLICY IF EXISTS tenant_isolation ON dr_boot_service_status;
DROP POLICY IF EXISTS tenant_insert ON dr_boot_service_status;
DROP POLICY IF EXISTS tenant_update ON dr_boot_service_status;
DROP POLICY IF EXISTS tenant_delete ON dr_boot_service_status;

-- dr_boot_service
CREATE POLICY tenant_isolation ON dr_boot_service
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_boot_service
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_boot_service
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_boot_service
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- dr_boot_dependency
CREATE POLICY tenant_isolation ON dr_boot_dependency
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_boot_dependency
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_boot_dependency
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_boot_dependency
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- dr_boot_run
CREATE POLICY tenant_isolation ON dr_boot_run
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_boot_run
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_boot_run
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_boot_run
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- dr_boot_service_status: tenant scoping is via the parent run's tenant_id (the
-- status row carries no tenant_id of its own). The app.bypass_rls backstop is
-- kept for symmetry with the rest of dr_db.
CREATE POLICY tenant_isolation ON dr_boot_service_status
    USING ((current_setting('app.bypass_rls', true) = 'on'
            OR EXISTS (SELECT 1 FROM dr_boot_run r
                        WHERE r.id = dr_boot_service_status.run_id
                          AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)));
CREATE POLICY tenant_insert ON dr_boot_service_status
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on'
            OR EXISTS (SELECT 1 FROM dr_boot_run r
                        WHERE r.id = dr_boot_service_status.run_id
                          AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)));
CREATE POLICY tenant_update ON dr_boot_service_status
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on'
            OR EXISTS (SELECT 1 FROM dr_boot_run r
                        WHERE r.id = dr_boot_service_status.run_id
                          AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on'
            OR EXISTS (SELECT 1 FROM dr_boot_run r
                        WHERE r.id = dr_boot_service_status.run_id
                          AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)));
CREATE POLICY tenant_delete ON dr_boot_service_status
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on'
            OR EXISTS (SELECT 1 FROM dr_boot_run r
                        WHERE r.id = dr_boot_service_status.run_id
                          AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)));
