-- Harden the DR attestation ledger for procurement-grade evidence.
--
-- Migration 000029 intentionally made the ledger append/hash-chained, but its
-- RLS policies still permitted tenant-scoped UPDATE/DELETE. The recorder needs
-- one narrow UPDATE to stamp anchored_root after a checkpoint is recorded; every
-- other mutation must be blocked at the database layer, including bypass-RLS
-- maintenance contexts. Recover evidence reports are also added as a first-class
-- ledger entry type so generated evidence can be chained instead of carrying
-- only a local proof envelope.

ALTER TABLE dr_attestation_ledger
    DROP CONSTRAINT IF EXISTS dr_attestation_ledger_entry_type_check;

ALTER TABLE dr_attestation_ledger
    ADD CONSTRAINT dr_attestation_ledger_entry_type_check CHECK (entry_type IN (
        'failover_attestation','drill_attestation',
        'recovery_point_validation','cleanroom_verdict',
        'recover_evidence_report','anchor_checkpoint'));

CREATE OR REPLACE FUNCTION dr_attestation_ledger_immutable_guard()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'dr_attestation_ledger is append-only';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id = OLD.id
           AND NEW.tenant_id = OLD.tenant_id
           AND NEW.seq = OLD.seq
           AND NEW.entry_type = OLD.entry_type
           AND NEW.subject_id = OLD.subject_id
           AND NEW.payload = OLD.payload
           AND NEW.payload_hash = OLD.payload_hash
           AND NEW.prev_hash = OLD.prev_hash
           AND NEW.entry_hash = OLD.entry_hash
           AND NEW.created_at = OLD.created_at
           AND OLD.anchored_root IS NULL
           AND NEW.anchored_root IS NOT NULL
           AND char_length(NEW.anchored_root) = 64 THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'dr_attestation_ledger rows are immutable except first anchored_root stamp';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dr_attestation_ledger_immutable ON dr_attestation_ledger;
CREATE TRIGGER trg_dr_attestation_ledger_immutable
BEFORE UPDATE OR DELETE ON dr_attestation_ledger
FOR EACH ROW EXECUTE FUNCTION dr_attestation_ledger_immutable_guard();

CREATE OR REPLACE FUNCTION dr_attestation_checkpoint_immutable_guard()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'dr_attestation_checkpoint is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dr_attestation_checkpoint_immutable ON dr_attestation_checkpoint;
CREATE TRIGGER trg_dr_attestation_checkpoint_immutable
BEFORE UPDATE OR DELETE ON dr_attestation_checkpoint
FOR EACH ROW EXECUTE FUNCTION dr_attestation_checkpoint_immutable_guard();

DROP POLICY IF EXISTS tenant_delete ON dr_attestation_ledger;
DROP POLICY IF EXISTS tenant_delete ON dr_attestation_checkpoint;
DROP POLICY IF EXISTS tenant_update ON dr_attestation_checkpoint;
