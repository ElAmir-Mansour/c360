-- Multi-site / cascading replication topology (ClarioDR capability #10,
-- DESIGN_DataStream_DR.md §2.1 topology, §6.3 recovery executor, §11 SLO
-- metrics). The single source->target pair the base schema assumes is
-- generalised here to a DIRECTED ACYCLIC GRAPH of sites per consistency group:
-- one source can fan out to N DR targets (1-to-many), and chains can cascade
-- (A->B->C, where B is a relay that is both a target of A and the source of C).
--
-- dr_topology_node : a site's role within a group's topology — a graph VERTEX.
--                    role ∈ source | relay | target. UNIQUE (group_id, site_id)
--                    so a site participates at most once per group's topology.
-- dr_topology_edge : a directed replication link from_node -> to_node carrying
--                    one stream — a graph EDGE. Records mode (sync|async), a
--                    selection priority (lower wins), and the LIVE health rollup
--                    (state, lag, applied_seq, last_progress_at) maintained from
--                    datastream.dr.progress telemetry. The application layer
--                    guarantees acyclicity via DFS cycle detection on every add;
--                    UNIQUE (group_id, from_node_id, to_node_id) forbids a
--                    duplicate parallel edge.

CREATE TABLE IF NOT EXISTS dr_topology_node (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES protected_site(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('source','relay','target')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- a site has exactly one role per group's topology.
    UNIQUE (group_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_dr_topology_node_group
    ON dr_topology_node (group_id, role);

CREATE TABLE IF NOT EXISTS dr_topology_edge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    from_node_id UUID NOT NULL REFERENCES dr_topology_node(id) ON DELETE CASCADE,
    to_node_id UUID NOT NULL REFERENCES dr_topology_node(id) ON DELETE CASCADE,
    -- the replication_stream the edge carries (the core's StreamID); the join key
    -- from datastream.dr.progress to this edge's health rollup. Free-text rather
    -- than a FK so a topology edge can be declared before the stream's row lands.
    stream_id TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'async' CHECK (mode IN ('sync','async')),
    -- selection priority among candidate targets; LOWER is preferred (1 = most
    -- preferred standby). Used by the failover ranking to break health/lag ties.
    priority INT NOT NULL DEFAULT 100,
    -- live edge-health rollup from datastream.dr.progress (consumer.go):
    health TEXT NOT NULL DEFAULT 'unknown'
        CHECK (health IN ('healthy','degraded','unhealthy','unknown')),
    -- most recent replication lag (now - Frame.EmittedAt at apply), seconds.
    lag_seconds BIGINT,
    -- highest contiguously-applied Seq last observed for the stream (monotonic).
    applied_seq BIGINT NOT NULL DEFAULT 0,
    -- wall clock of the last progress sample (NULL before any).
    last_progress_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- no duplicate parallel edge between the same two nodes.
    UNIQUE (group_id, from_node_id, to_node_id),
    -- a self-loop is the trivial cycle; reject it at the schema level too.
    CHECK (from_node_id <> to_node_id)
);

CREATE INDEX IF NOT EXISTS idx_dr_topology_edge_group
    ON dr_topology_edge (group_id, priority);

CREATE INDEX IF NOT EXISTS idx_dr_topology_edge_from
    ON dr_topology_edge (from_node_id);

CREATE INDEX IF NOT EXISTS idx_dr_topology_edge_to
    ON dr_topology_edge (to_node_id);

-- the health rollup updates every edge carrying a stream, so index by stream.
CREATE INDEX IF NOT EXISTS idx_dr_topology_edge_stream
    ON dr_topology_edge (stream_id);

-- Tenant isolation: both tables are request-path readable/writable and carry
-- RLS, with the app.bypass_rls backstop for the health-rollup background loop
-- (which consumes datastream.dr.progress across tenants), mirroring the §7
-- system-path rule. Per-operation policies match the dr_db convention.
ALTER TABLE dr_topology_node ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_topology_node FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_topology_edge ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_topology_edge FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_topology_node;
DROP POLICY IF EXISTS tenant_insert ON dr_topology_node;
DROP POLICY IF EXISTS tenant_update ON dr_topology_node;
DROP POLICY IF EXISTS tenant_delete ON dr_topology_node;

DROP POLICY IF EXISTS tenant_isolation ON dr_topology_edge;
DROP POLICY IF EXISTS tenant_insert ON dr_topology_edge;
DROP POLICY IF EXISTS tenant_update ON dr_topology_edge;
DROP POLICY IF EXISTS tenant_delete ON dr_topology_edge;

CREATE POLICY tenant_isolation ON dr_topology_node
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_topology_node
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_topology_node
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_topology_node
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON dr_topology_edge
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_topology_edge
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_topology_edge
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_topology_edge
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
