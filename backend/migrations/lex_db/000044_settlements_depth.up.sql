-- =============================================================================
-- Round 2 — Settlements depth (close-by-reconciliation + audit + facts)
-- Unit: Settlements (service/settlement_service.go, repository/settlement_repo.go)
-- =============================================================================
-- This migration is DEFENSE-IN-DEPTH for the WS2 double-close guard and the WS3
-- terminal-close FSM. The hot-path guarding is enforced in Go (LockStatus FOR
-- UPDATE + compare-and-swap UPDATE ... WHERE status = expectedFrom on both the
-- settlement and the matter); these indexes/constraints make the same invariants
-- impossible to violate at the storage layer even under a buggy caller.
--
-- It assumes the round2_audit_concurrency.up.sql peer migration (same _staging
-- batch) has run: that one adds legal_settlement.lock_version and re-asserts the
-- append-only legal_settlement_audit_log (already created in 000030). This file
-- intentionally does NOT re-create the audit table or closure_reason column.
--
-- Idempotent: IF NOT EXISTS guards throughout so it is safe to (re)apply.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1) At most ONE executed settlement per matter.
--     CloseByReconciliation transitions exactly one settlement to 'executed' and
--     closes the owning matter. Two distinct settlements on the SAME matter must
--     never both reach 'executed' (that would imply the matter was closed twice).
--     A partial-unique index makes the second execution fail at COMMIT, backing
--     the Go-level matter-close CAS. Only live (non-soft-deleted) rows count.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_settlement_executed_per_matter
    ON legal_settlement (tenant_id, matter_id)
    WHERE status = 'executed' AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- (2) Supporting index for the locked matter-close read + the active-settlement
--     lookups CloseByReconciliation / List perform. Speeds the FOR UPDATE lookup
--     by (tenant_id, matter_id) and the status-filtered settlement listings.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_legal_settlement_matter_status
    ON legal_settlement (tenant_id, matter_id, status)
    WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- (3) Settlement FSM guard. Constrains the status domain so a CAS that targets a
--     bad value can never persist. Mirrors the model.SettlementStatus enum
--     (proposed/negotiating/pending_approval/approved/executed/rejected/abandoned).
--     Added NOT VALID so the migration does not block on a full table scan; the
--     constraint is enforced for all new writes immediately. INTEGRATOR may run a
--     follow-up `VALIDATE CONSTRAINT` during a maintenance window.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_legal_settlement_status'
    ) THEN
        ALTER TABLE legal_settlement
            ADD CONSTRAINT chk_legal_settlement_status
            CHECK (status IN (
                'proposed', 'negotiating', 'pending_approval',
                'approved', 'executed', 'rejected', 'abandoned'
            )) NOT VALID;
    END IF;
END $$;
