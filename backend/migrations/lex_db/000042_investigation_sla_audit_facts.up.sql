-- =============================================================================
-- Round 2 maturation — Investigations vertical (WS3 SLA + WS4 audit + C-2 facts).
--
-- Integrator: number this AFTER the sibling round-2 staged migrations. At authoring
-- time the highest COMMITTED lex_db sequence is 000037 and sibling round-2 units
-- stage 000038 (spine SLA audit), 000039 (consultation SLA); investigations take
-- 000040. Renumber on merge if the staging set shifts.
--
-- This migration is ADDITIVE and IDEMPOTENT (IF NOT EXISTS / DO $$ guards / drop-
-- then-recreate of named CHECKs). It does three things:
--
--   (1) WS4 audit — extend the EXISTING append-only legal_investigation_audit_log
--       (000028) with before/after JSONB snapshot columns + a free-text reason, to
--       mirror the legal_case_classification_audit_log before/after contract (000025).
--       The table stays INSERT-only under FORCE RLS => immutable.
--
--   (2) WS3 SLA — let an INVESTIGATION reuse the SHARED legal_sla_clocks ack/
--       turnaround/L1-L2-L3 escalation + breach-monitor + quarterly-KPI machinery
--       (000023) by relaxing the hard legal_request_id -> legal_requests(id) FK to a
--       GENERIC subject id. Investigations have NO legal_request, so the FK can never
--       be satisfied for them; dropping it (keeping the NOT NULL + the UNIQUE
--       (tenant_id, legal_request_id) one-clock-per-subject guarantee) makes the
--       column a polymorphic subject key. NO monitor/KPI query JOINs legal_requests
--       off this column (verified against sla_clock_repo.go + the SLA monitor), so
--       request clocks are unaffected. A default SLA target for the synthetic
--       'legal_investigation' service_code is seeded per tenant so StartClock can
--       resolve a target (urgent: 4 working-hours ack / normal: 1 working-day ack;
--       3 working-day turnaround; the fixed 2/4/6 escalation ladder).
--
--   (3) C-2 facts — admit the 'investigation_resolution' kind in the
--       lex_duration_facts kind CHECK (000034) so the register->results-approved
--       processing-duration fact can be upserted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1) WS4: before/after/reason on the investigation governance audit log.
-- -----------------------------------------------------------------------------
ALTER TABLE legal_investigation_audit_log
    ADD COLUMN IF NOT EXISTS before JSONB,
    ADD COLUMN IF NOT EXISTS after  JSONB,
    ADD COLUMN IF NOT EXISTS reason TEXT;

-- -----------------------------------------------------------------------------
-- (2) WS3: relax the legal_sla_clocks legal_request_id FK to a generic subject id.
--     The default FK name is <table>_<column>_fkey; guarded so a re-run / a rename
--     is tolerated.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'legal_sla_clocks'
          AND constraint_name = 'legal_sla_clocks_legal_request_id_fkey'
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE legal_sla_clocks DROP CONSTRAINT legal_sla_clocks_legal_request_id_fkey;
    END IF;
END $$;

COMMENT ON COLUMN legal_sla_clocks.legal_request_id IS
    'Generic SLA subject id (Round-2): a legal_requests.id for request-processing '
    'clocks, or a legal_investigations.id for investigation clocks. No hard FK so '
    'the shared ack/escalation/KPI machinery serves multiple subject verticals.';

-- Seed the default investigation SLA target per tenant (AI-governance seeding
-- convention: loop over SELECT id FROM tenants). Guarded by to_regclass because
-- lex_db may not host a tenants table (separate DB); when absent, provision the
-- target per-tenant via the admin SLA-target API instead. ON CONFLICT DO NOTHING
-- keeps the seed idempotent and never overrides an admin override.
DO $$
DECLARE
    seed_tenant UUID;
    seed_actor  UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    IF to_regclass('public.tenants') IS NULL THEN
        RAISE NOTICE 'tenants table absent in lex_db; skipping investigation SLA target seed (provision per-tenant via API)';
        RETURN;
    END IF;

    FOR seed_tenant IN SELECT id FROM tenants LOOP
        -- urgent: 4 working-hours ack, 3 working-day turnaround.
        INSERT INTO legal_sla_targets (
            tenant_id, service_code, priority, turnaround_working_days,
            ack_window_value, ack_window_unit,
            escalation_l1_days, escalation_l2_days, escalation_l3_days,
            active, created_by
        ) VALUES (
            seed_tenant, 'legal_investigation', 'urgent', 3,
            4, 'working_hours',
            2, 4, 6,
            true, seed_actor
        ) ON CONFLICT DO NOTHING;

        -- normal: 1 working-day ack, 3 working-day turnaround.
        INSERT INTO legal_sla_targets (
            tenant_id, service_code, priority, turnaround_working_days,
            ack_window_value, ack_window_unit,
            escalation_l1_days, escalation_l2_days, escalation_l3_days,
            active, created_by
        ) VALUES (
            seed_tenant, 'legal_investigation', 'normal', 3,
            1, 'working_days',
            2, 4, 6,
            true, seed_actor
        ) ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- (3) C-2: admit the investigation_resolution duration-fact kind.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'lex_duration_facts'
          AND constraint_name = 'lex_duration_facts_kind_check'
    ) THEN
        ALTER TABLE lex_duration_facts DROP CONSTRAINT lex_duration_facts_kind_check;
    END IF;
    -- This migration runs LAST among the Round-2 migrations that touch the
    -- lex_duration_facts kind CHECK, so it recreates the constraint with the FULL
    -- union of every Round-2 duration-fact kind (base + litigation 000038 +
    -- investigation + settlement). Keep all kinds here or a sibling C-2 fact write
    -- will violate the CHECK.
    ALTER TABLE lex_duration_facts
        ADD CONSTRAINT lex_duration_facts_kind_check
        CHECK (kind IN (
            'case_resolution', 'contract_review', 'consultation_answer',
            'request_processing',
            'pleading_filing', 'defendant_first_response', 'judgment_study',
            'investigation_resolution', 'settlement_resolution'
        ));
END $$;
