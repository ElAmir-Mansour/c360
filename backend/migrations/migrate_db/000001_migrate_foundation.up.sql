CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS migrate_reference_counter (
    tenant_id UUID NOT NULL,
    ref_year INT NOT NULL,
    ref_kind TEXT NOT NULL CHECK (ref_kind IN ('program','move_group','wave','cutover')),
    last_number INT NOT NULL CHECK (last_number > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, ref_year, ref_kind)
);

CREATE TABLE IF NOT EXISTS migrate_program (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    reference TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','active','completed','suspended')),
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_migrate_program_tenant_status
    ON migrate_program (tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS migrate_workload (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL REFERENCES migrate_program(id) ON DELETE RESTRICT,
    app_key TEXT NOT NULL CHECK (length(trim(app_key)) > 0 AND char_length(app_key) <= 128),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND char_length(name) <= 256),
    source_environment TEXT NOT NULL DEFAULT '',
    target_cloud TEXT NOT NULL DEFAULT '',
    target_account TEXT NOT NULL DEFAULT '',
    strategy TEXT NOT NULL DEFAULT 'rehost'
        CHECK (strategy IN ('rehost','replatform','repurchase','refactor','retire','retain')),
    owner_name TEXT NOT NULL DEFAULT '',
    owner_contact TEXT NOT NULL DEFAULT '',
    tier TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'discovered'
        CHECK (status IN ('discovered','assessed','planned','in_migration','cutover','validated','live','decommissioned','rolled_back')),
    readiness_score INT NOT NULL DEFAULT 0 CHECK (readiness_score BETWEEN 0 AND 100),
    dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    move_group_id UUID,
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, program_id, app_key)
);

CREATE INDEX IF NOT EXISTS idx_migrate_workload_program_status
    ON migrate_workload (tenant_id, program_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_migrate_workload_program_strategy
    ON migrate_workload (tenant_id, program_id, strategy);
CREATE INDEX IF NOT EXISTS idx_migrate_workload_group
    ON migrate_workload (tenant_id, move_group_id);

CREATE TABLE IF NOT EXISTS migrate_move_group (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL REFERENCES migrate_program(id) ON DELETE RESTRICT,
    reference TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL DEFAULT '',
    constraints_text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','completeness_issue','ready','approval_pending','approved','rejected')),
    completeness_status TEXT NOT NULL DEFAULT 'unchecked',
    completeness_findings JSONB NOT NULL DEFAULT '[]'::jsonb,
    submitted_by UUID,
    submitted_at TIMESTAMPTZ,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    decision_rationale TEXT NOT NULL DEFAULT '',
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_migrate_move_group_program_status
    ON migrate_move_group (tenant_id, program_id, status, updated_at DESC);

ALTER TABLE migrate_workload
    DROP CONSTRAINT IF EXISTS fk_migrate_workload_move_group;
ALTER TABLE migrate_workload
    ADD CONSTRAINT fk_migrate_workload_move_group
    FOREIGN KEY (move_group_id) REFERENCES migrate_move_group(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS migrate_wave (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL REFERENCES migrate_program(id) ON DELETE RESTRICT,
    reference TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL DEFAULT '',
    sequence INT NOT NULL CHECK (sequence > 0),
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned','ready','in_progress','cutover','completed','paused','rolled_back')),
    parent_runbook_id UUID,
    planned_duration_seconds INT NOT NULL DEFAULT 0 CHECK (planned_duration_seconds >= 0),
    actual_duration_seconds INT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, reference),
    UNIQUE (tenant_id, program_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_migrate_wave_program_status
    ON migrate_wave (tenant_id, program_id, status, sequence);

CREATE TABLE IF NOT EXISTS migrate_wave_move_group (
    tenant_id UUID NOT NULL,
    wave_id UUID NOT NULL REFERENCES migrate_wave(id) ON DELETE CASCADE,
    move_group_id UUID NOT NULL REFERENCES migrate_move_group(id) ON DELETE RESTRICT,
    sequence INT NOT NULL DEFAULT 1 CHECK (sequence > 0),
    planned_duration_seconds INT NOT NULL DEFAULT 0 CHECK (planned_duration_seconds >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (wave_id, move_group_id),
    UNIQUE (tenant_id, move_group_id)
);

CREATE INDEX IF NOT EXISTS idx_migrate_wave_group_wave
    ON migrate_wave_move_group (tenant_id, wave_id, sequence);

CREATE TABLE IF NOT EXISTS migrate_cutover_window (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL REFERENCES migrate_program(id) ON DELETE RESTRICT,
    wave_id UUID NOT NULL REFERENCES migrate_wave(id) ON DELETE RESTRICT,
    reference TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    window_type TEXT NOT NULL DEFAULT 'maintenance'
        CHECK (window_type IN ('maintenance','off_peak','planned_downtime')),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    constraints_text TEXT NOT NULL DEFAULT '',
    decision TEXT NOT NULL DEFAULT 'pending'
        CHECK (decision IN ('pending','go','no_go')),
    decided_by UUID,
    decided_at TIMESTAMPTZ,
    rationale TEXT NOT NULL DEFAULT '',
    runbook_run_id UUID,
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),
    UNIQUE (tenant_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_migrate_window_program_time
    ON migrate_cutover_window (tenant_id, program_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_migrate_window_wave
    ON migrate_cutover_window (tenant_id, wave_id, starts_at);

CREATE TABLE IF NOT EXISTS migrate_rollback_plan (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL REFERENCES migrate_program(id) ON DELETE RESTRICT,
    window_id UUID NOT NULL REFERENCES migrate_cutover_window(id) ON DELETE RESTRICT,
    strategy TEXT NOT NULL DEFAULT '',
    procedures TEXT NOT NULL DEFAULT '',
    success_criteria TEXT NOT NULL DEFAULT '',
    runbook_id UUID,
    decision TEXT NOT NULL DEFAULT 'pending'
        CHECK (decision IN ('pending','approved','rejected')),
    decided_by UUID,
    decided_at TIMESTAMPTZ,
    rationale TEXT NOT NULL DEFAULT '',
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, window_id)
);

CREATE TABLE IF NOT EXISTS migrate_gate_check (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL REFERENCES migrate_program(id) ON DELETE RESTRICT,
    window_id UUID NOT NULL REFERENCES migrate_cutover_window(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('readiness','validation','rollback_success')),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    check_type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','passed','failed','overridden')),
    evidence TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT '',
    required BOOLEAN NOT NULL DEFAULT TRUE,
    recorded_by UUID,
    recorded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migrate_gate_window_kind
    ON migrate_gate_check (tenant_id, window_id, kind, status);

CREATE TABLE IF NOT EXISTS migrate_connector_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    provider TEXT NOT NULL DEFAULT 'http_migration_service',
    endpoint_url TEXT NOT NULL CHECK (length(trim(endpoint_url)) > 0),
    auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none','bearer','basic')),
    secret_ref TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS migrate_connector_invocation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    connector_id UUID NOT NULL REFERENCES migrate_connector_config(id) ON DELETE RESTRICT,
    window_id UUID NOT NULL REFERENCES migrate_cutover_window(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
    action TEXT NOT NULL CHECK (length(trim(action)) > 0),
    request_body JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','succeeded','failed')),
    http_status INT NOT NULL DEFAULT 0,
    response_body TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS migrate_audit_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL REFERENCES migrate_program(id) ON DELETE RESTRICT,
    actor_id UUID,
    action TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 140),
    subject_id UUID,
    subject_type TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migrate_audit_program_time
    ON migrate_audit_event (tenant_id, program_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION migrate_audit_no_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'migrate audit event is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_migrate_audit_no_update ON migrate_audit_event;
CREATE TRIGGER trg_migrate_audit_no_update
    BEFORE UPDATE ON migrate_audit_event
    FOR EACH ROW EXECUTE FUNCTION migrate_audit_no_mutation();

DROP TRIGGER IF EXISTS trg_migrate_audit_no_delete ON migrate_audit_event;
CREATE TRIGGER trg_migrate_audit_no_delete
    BEFORE DELETE ON migrate_audit_event
    FOR EACH ROW EXECUTE FUNCTION migrate_audit_no_mutation();

ALTER TABLE migrate_reference_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_reference_counter FORCE ROW LEVEL SECURITY;
ALTER TABLE migrate_program ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_program FORCE ROW LEVEL SECURITY;
ALTER TABLE migrate_workload ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_workload FORCE ROW LEVEL SECURITY;
ALTER TABLE migrate_move_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_move_group FORCE ROW LEVEL SECURITY;
ALTER TABLE migrate_wave ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_wave FORCE ROW LEVEL SECURITY;
ALTER TABLE migrate_wave_move_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_wave_move_group FORCE ROW LEVEL SECURITY;
ALTER TABLE migrate_cutover_window ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_cutover_window FORCE ROW LEVEL SECURITY;
ALTER TABLE migrate_rollback_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_rollback_plan FORCE ROW LEVEL SECURITY;
ALTER TABLE migrate_gate_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_gate_check FORCE ROW LEVEL SECURITY;
ALTER TABLE migrate_connector_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_connector_config FORCE ROW LEVEL SECURITY;
ALTER TABLE migrate_connector_invocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_connector_invocation FORCE ROW LEVEL SECURITY;
ALTER TABLE migrate_audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_audit_event FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'migrate_reference_counter',
        'migrate_program',
        'migrate_workload',
        'migrate_move_group',
        'migrate_wave',
        'migrate_wave_move_group',
        'migrate_cutover_window',
        'migrate_rollback_plan',
        'migrate_gate_check',
        'migrate_connector_config',
        'migrate_connector_invocation',
        'migrate_audit_event'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS tenant_select ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_update ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON %I', t);
        EXECUTE format('CREATE POLICY tenant_select ON %I FOR SELECT USING ((current_setting(''app.bypass_rls'', true) = ''on'' OR tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid))', t);
        EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK ((current_setting(''app.bypass_rls'', true) = ''on'' OR tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid))', t);
        IF t <> 'migrate_audit_event' THEN
            EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE USING ((current_setting(''app.bypass_rls'', true) = ''on'' OR tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)) WITH CHECK ((current_setting(''app.bypass_rls'', true) = ''on'' OR tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid))', t);
            EXECUTE format('CREATE POLICY tenant_delete ON %I FOR DELETE USING ((current_setting(''app.bypass_rls'', true) = ''on'' OR tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid))', t);
        END IF;
    END LOOP;
END $$;
