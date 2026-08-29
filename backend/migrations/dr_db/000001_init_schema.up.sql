-- =============================================================================
-- ClarioDR control-plane schema — dr_db (DESIGN_DataStream_DR.md §7).
--
-- Sovereign failover & recovery: protected sites, consistency groups + boot
-- order, replication streams (the core's StreamID + RPO ledger), immutable
-- recovery points (WORM-sealed), network mappings, the gated failover/drill
-- FSM (failover_run + failover_step), NCA-ready attestations, and DR agents.
--
-- Tenant-scoped tables carry tenant_id and get RLS (clone of
-- migrations/platform_core/000002_rls.up.sql). The leader-singletons (the
-- failover.Driver and rpo_monitor) are the ONLY components that read across
-- tenants, and they do so on failover_run / replication_stream; like the event
-- outbox, those two infrastructure tables are NOT RLS-forced (every singleton
-- query runs through repository.systemQuery…, "background-loop only; bypasses
-- tenant RLS by design"). Every request-path query filters by tenant AND runs
-- with SET LOCAL app.current_tenant_id so RLS is the backstop.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- A customer system under DR protection (primary site).
CREATE TABLE IF NOT EXISTS protected_site (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('vm','database','fileset','iac')),
    primary_endpoint TEXT NOT NULL,            -- opaque to core; agent resolves
    rto_objective_seconds INT NOT NULL DEFAULT 900,   -- 15 min GA
    rpo_objective_seconds INT NOT NULL DEFAULT 300,   -- 5 min GA
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

-- Members that must fail over together, in a defined boot order.
CREATE TABLE IF NOT EXISTS consistency_group (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS consistency_group_member (
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    site_id  UUID NOT NULL REFERENCES protected_site(id) ON DELETE CASCADE,
    boot_order INT NOT NULL DEFAULT 100,
    PRIMARY KEY (group_id, site_id)
);

-- One replication stream per protected site (the core's StreamID).
CREATE TABLE IF NOT EXISTS replication_stream (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL REFERENCES protected_site(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','seeding','streaming','paused','degraded','error')),
    applied_seq BIGINT NOT NULL DEFAULT 0,     -- RPO ledger: last contiguous applied Seq
    source_lsn TEXT,                           -- last applied source LSN
    applied_at TIMESTAMPTZ,                    -- wall clock -> live RPO = now - applied_at
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (site_id)
);
CREATE INDEX IF NOT EXISTS idx_stream_monitor ON replication_stream (status, applied_at);

-- Immutable recovery point (a consistency-wide marker + sealed WORM chunks).
CREATE TABLE IF NOT EXISTS recovery_point (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id),
    marker_lsn TEXT NOT NULL,
    rpo_seconds INT NOT NULL,                  -- achieved RPO at this point
    object_keys JSONB NOT NULL,                -- sealed WORM object keys per member
    content_hash TEXT NOT NULL,                -- tamper-evidence (chained)
    validation_ratio NUMERIC(5,4),             -- 0.9990 ...
    is_validated BOOLEAN NOT NULL DEFAULT false,
    sealed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    retention_until TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rp_group ON recovery_point (group_id, sealed_at DESC);

-- Network mapping primary->recovery for the recovery executor.
CREATE TABLE IF NOT EXISTS network_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    profile TEXT NOT NULL DEFAULT 'production' CHECK (profile IN ('production','isolated')),
    primary_cidr TEXT NOT NULL,
    recovery_cidr TEXT NOT NULL
);

-- Recovery targets: where a protected site is booted at the recovery site, in
-- declared boot order (§6.3). health_probe (§15.2) is a DISTINCT workload-up
-- probe (type http|tcp|sql|k8s_ready), separate from the data-fidelity
-- Validator; the recovery executor (WP-10) blocks VALIDATING->ATTESTED until
-- every member's probe is green or a deadline trips -> ROLLED_BACK.
CREATE TABLE IF NOT EXISTS recovery_target (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES protected_site(id) ON DELETE CASCADE,
    boot_order INT NOT NULL DEFAULT 100,
    recovery_endpoint TEXT,                    -- where the workload boots (opaque)
    health_probe JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {type,target,expected,timeout,retries}
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (group_id, site_id)
);
CREATE INDEX IF NOT EXISTS idx_recovery_target_boot ON recovery_target (group_id, boot_order);

-- The gated failover/drill run (the FSM, §6).
CREATE TABLE IF NOT EXISTS failover_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id),
    mode TEXT NOT NULL CHECK (mode IN ('real','drill')),
    status TEXT NOT NULL DEFAULT 'INITIATED',  -- §6.1 states
    recovery_point_id UUID REFERENCES recovery_point(id),
    rto_objective_seconds INT NOT NULL,
    initiated_by UUID NOT NULL,
    approved_by UUID,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    rto_actual_seconds INT,                    -- completed_at - initiated_at
    last_error TEXT,
    claimed_at TIMESTAMPTZ,                    -- driver lease (FOR UPDATE SKIP LOCKED)
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_run_driver ON failover_run (status, claimed_at)
    WHERE status NOT IN ('COMPLETED','FAILED','CANCELLED','AWAITING_APPROVAL','ROLLED_BACK');

-- Per-step durable audit + idempotency (one row per gate/step).
CREATE TABLE IF NOT EXISTS failover_step (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES failover_run(id) ON DELETE CASCADE,
    step TEXT NOT NULL,                        -- quiesce | gate1 | gate2 | boot:<site> | gate4 ...
    status TEXT NOT NULL CHECK (status IN ('running','passed','failed')),
    detail JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    UNIQUE (run_id, step)                      -- idempotency: a step runs once
);

-- Immutable, signed attestation (sealed to WORM; row is the index).
CREATE TABLE IF NOT EXISTS attestation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    run_id UUID NOT NULL UNIQUE REFERENCES failover_run(id),
    rto_objective_seconds INT NOT NULL,
    rto_actual_seconds INT NOT NULL,
    rpo_seconds INT NOT NULL,
    validation_ratio NUMERIC(5,4) NOT NULL,
    report_object_key TEXT NOT NULL,           -- sealed PDF/JSON in WORM bucket
    content_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DR agents on customer infra (clone siem sources.Source columns).
CREATE TABLE IF NOT EXISTS dr_agent (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    site_id UUID REFERENCES protected_site(id),
    status TEXT NOT NULL DEFAULT 'provisioning'
        CHECK (status IN ('provisioning','active','silent','rotating','revoked')),
    mtls_thumbprint TEXT UNIQUE,
    cert_serial TEXT, cert_issued_at TIMESTAMPTZ, cert_expires_at TIMESTAMPTZ,
    cert_revoked_at TIMESTAMPTZ, cert_revoked_reason TEXT,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- Row-Level Security on tenant-scoped, request-path tables.
-- Pattern cloned from migrations/platform_core/000002_rls.up.sql (4 policies).
-- The application sets SET LOCAL app.current_tenant_id = '<uuid>' per request;
-- the migration role must hold BYPASSRLS. failover_run and replication_stream
-- are deliberately EXCLUDED here — the leader singletons read them across
-- tenants via the documented system query path (like the event outbox).
-- =============================================================================

-- protected_site
ALTER TABLE protected_site ENABLE ROW LEVEL SECURITY;
ALTER TABLE protected_site FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON protected_site;
DROP POLICY IF EXISTS tenant_insert ON protected_site;
DROP POLICY IF EXISTS tenant_update ON protected_site;
DROP POLICY IF EXISTS tenant_delete ON protected_site;
CREATE POLICY tenant_isolation ON protected_site
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON protected_site
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON protected_site
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON protected_site
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- consistency_group
ALTER TABLE consistency_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE consistency_group FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON consistency_group;
DROP POLICY IF EXISTS tenant_insert ON consistency_group;
DROP POLICY IF EXISTS tenant_update ON consistency_group;
DROP POLICY IF EXISTS tenant_delete ON consistency_group;
CREATE POLICY tenant_isolation ON consistency_group
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON consistency_group
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON consistency_group
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON consistency_group
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- recovery_point
ALTER TABLE recovery_point ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_point FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recovery_point;
DROP POLICY IF EXISTS tenant_insert ON recovery_point;
DROP POLICY IF EXISTS tenant_update ON recovery_point;
DROP POLICY IF EXISTS tenant_delete ON recovery_point;
CREATE POLICY tenant_isolation ON recovery_point
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON recovery_point
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON recovery_point
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON recovery_point
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- network_mapping
ALTER TABLE network_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_mapping FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON network_mapping;
DROP POLICY IF EXISTS tenant_insert ON network_mapping;
DROP POLICY IF EXISTS tenant_update ON network_mapping;
DROP POLICY IF EXISTS tenant_delete ON network_mapping;
CREATE POLICY tenant_isolation ON network_mapping
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON network_mapping
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON network_mapping
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON network_mapping
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- recovery_target
ALTER TABLE recovery_target ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_target FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recovery_target;
DROP POLICY IF EXISTS tenant_insert ON recovery_target;
DROP POLICY IF EXISTS tenant_update ON recovery_target;
DROP POLICY IF EXISTS tenant_delete ON recovery_target;
CREATE POLICY tenant_isolation ON recovery_target
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON recovery_target
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON recovery_target
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON recovery_target
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- attestation
ALTER TABLE attestation ENABLE ROW LEVEL SECURITY;
ALTER TABLE attestation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attestation;
DROP POLICY IF EXISTS tenant_insert ON attestation;
DROP POLICY IF EXISTS tenant_update ON attestation;
DROP POLICY IF EXISTS tenant_delete ON attestation;
CREATE POLICY tenant_isolation ON attestation
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON attestation
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON attestation
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON attestation
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- dr_agent
ALTER TABLE dr_agent ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_agent FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_agent;
DROP POLICY IF EXISTS tenant_insert ON dr_agent;
DROP POLICY IF EXISTS tenant_update ON dr_agent;
DROP POLICY IF EXISTS tenant_delete ON dr_agent;
CREATE POLICY tenant_isolation ON dr_agent
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_agent
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_agent
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_agent
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- =============================================================================
-- Transactional event outbox: DR lifecycle/alert events (stream.created,
-- failover.gate1.passed, attestation.issued, rpo.breached, …) are staged in
-- the same transaction as the state change (§8). Definition mirrors
-- migrations/platform_core/000015_event_outbox.up.sql (copied verbatim from
-- migrations/license_db/000001_init_schema.up.sql). NOT RLS-forced: the relay
-- claims rows across tenants, no tenant-facing API reads it directly.
-- =============================================================================
CREATE TABLE IF NOT EXISTS event_outbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID        NOT NULL UNIQUE,
    tenant_id       UUID        NOT NULL,
    topic           TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    payload         JSONB       NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
    attempts        INT         NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at      TIMESTAMPTZ,
    published_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_claim
    ON event_outbox (next_attempt_at, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_event_outbox_stuck
    ON event_outbox (claimed_at)
    WHERE status = 'publishing';

CREATE INDEX IF NOT EXISTS idx_event_outbox_purge
    ON event_outbox (published_at)
    WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_event_outbox_failed
    ON event_outbox (tenant_id, created_at)
    WHERE status = 'failed';
