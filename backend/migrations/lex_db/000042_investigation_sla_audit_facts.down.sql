-- Reverse of 000040_investigation_sla_audit_facts.up.sql (best-effort, idempotent).

-- (3) Restore the original 4-kind duration-fact CHECK. Will fail only if an
--     investigation_resolution fact row already exists; delete those first if so.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'lex_duration_facts'
          AND constraint_name = 'lex_duration_facts_kind_check'
    ) THEN
        ALTER TABLE lex_duration_facts DROP CONSTRAINT lex_duration_facts_kind_check;
    END IF;
    ALTER TABLE lex_duration_facts
        ADD CONSTRAINT lex_duration_facts_kind_check
        CHECK (kind IN (
            'case_resolution', 'contract_review', 'consultation_answer', 'request_processing'
        ));
END $$;

-- (2) Remove the seeded investigation SLA targets and restore the FK to
--     legal_requests. The FK restore will fail if any investigation clocks exist;
--     remove investigation SLA clocks first if reverting in an environment that
--     materialised them.
DELETE FROM legal_sla_targets WHERE service_code = 'legal_investigation';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'legal_sla_clocks'
          AND constraint_name = 'legal_sla_clocks_legal_request_id_fkey'
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE legal_sla_clocks
            ADD CONSTRAINT legal_sla_clocks_legal_request_id_fkey
            FOREIGN KEY (legal_request_id) REFERENCES legal_requests(id) ON DELETE CASCADE;
    END IF;
END $$;

-- (1) Drop the before/after/reason audit columns.
ALTER TABLE legal_investigation_audit_log
    DROP COLUMN IF EXISTS reason,
    DROP COLUMN IF EXISTS after,
    DROP COLUMN IF EXISTS before;
