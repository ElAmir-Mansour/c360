-- Tamper-evident attestation ledger (ClarioDR capability #20 /
-- DESIGN_DataStream_DR.md §6 attestation, §7 dr_db DDL).
--
-- An append-only, hash-CHAINED, WORM-anchored record of every DR attestation
-- (failover/drill RTO-RPO attestations, recovery-point validations, clean-room
-- verdicts) so an auditor or regulator can cryptographically PROVE that no
-- attestation was altered, spliced, or deleted.
--
-- The chain is per-tenant: each tenant has an independent monotonic `seq` space
-- and an independent hash chain rooted at a fixed genesis seed. Each entry's
-- entry_hash = SHA-256(seq || entry_type || subject_id || payload_hash ||
-- prev_hash); prev_hash is the previous entry's entry_hash. The application
-- allocates seq under a per-tenant advisory lock and the (tenant_id, seq) UNIQUE
-- constraint here is the hard backstop so the chain can never fork.

CREATE TABLE IF NOT EXISTS dr_attestation_ledger (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    -- seq is the per-tenant monotonic sequence (starts at 1). UNIQUE per tenant
    -- so two concurrent appends can never both claim the same slot — the second
    -- INSERT fails and retries, keeping a single, contiguous chain.
    seq           BIGINT NOT NULL CHECK (seq >= 1),
    -- entry_type names the attestation source:
    --   failover_attestation      -> Gate-4 failover attestation (RTO/RPO)
    --   drill_attestation         -> non-disruptive drill attestation (BCM evidence)
    --   recovery_point_validation -> recovery-point content-hash validation
    --   cleanroom_verdict         -> clean-room verdict (clean/malware/...)
    --   anchor_checkpoint         -> a Merkle checkpoint was sealed to WORM
    entry_type    TEXT NOT NULL CHECK (entry_type IN (
        'failover_attestation','drill_attestation',
        'recovery_point_validation','cleanroom_verdict','anchor_checkpoint')),
    -- subject_id is the attested DR object id (failover_run id, recovery point
    -- id, cleanroom scan id, ...) so an auditor can locate the source row.
    subject_id    TEXT NOT NULL,
    -- payload is the canonical attestation content (sorted-key JSON); it is what
    -- an auditor reads. Mutating it breaks payload_hash, which breaks entry_hash.
    payload       JSONB NOT NULL,
    -- payload_hash is the SHA-256 (hex) of the canonical payload bytes.
    payload_hash  TEXT NOT NULL CHECK (char_length(payload_hash) = 64),
    -- prev_hash is the previous entry's entry_hash; the genesis entry (seq 1)
    -- uses the fixed all-zero seed so the genesis link is itself verifiable.
    prev_hash     TEXT NOT NULL CHECK (char_length(prev_hash) = 64),
    -- entry_hash is SHA-256(seq||entry_type||subject_id||payload_hash||prev_hash).
    entry_hash    TEXT NOT NULL CHECK (char_length(entry_hash) = 64),
    -- anchored_root is the Merkle root of the checkpoint covering this entry,
    -- stamped once the entry has been anchored to WORM (NULL until then).
    anchored_root TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The fork-prevention backstop: one entry per (tenant, seq).
    CONSTRAINT uq_dr_attestation_ledger_tenant_seq UNIQUE (tenant_id, seq),
    -- The chain links must be unique per tenant so a duplicated entry_hash cannot
    -- be silently spliced in.
    CONSTRAINT uq_dr_attestation_ledger_tenant_hash UNIQUE (tenant_id, entry_hash)
);

-- Verifier walk + list endpoint read the chain ordered by seq.
CREATE INDEX IF NOT EXISTS idx_dr_attestation_ledger_tenant_seq
    ON dr_attestation_ledger (tenant_id, seq);

-- The list endpoint filters by entry_type and subject_id.
CREATE INDEX IF NOT EXISTS idx_dr_attestation_ledger_type
    ON dr_attestation_ledger (tenant_id, entry_type, seq);

CREATE INDEX IF NOT EXISTS idx_dr_attestation_ledger_subject
    ON dr_attestation_ledger (tenant_id, subject_id, seq);

-- Anchored Merkle checkpoints: each row certifies a contiguous [from_seq,to_seq]
-- range by its Merkle root, and (when WORM is configured) the row records the
-- immutable sealed object that witnesses the root. Re-deriving the Merkle root of
-- the range's entry_hash leaves must equal merkle_root, so an auditor can prove
-- the range existed as recorded at anchoring time.
CREATE TABLE IF NOT EXISTS dr_attestation_checkpoint (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    from_seq        BIGINT NOT NULL CHECK (from_seq >= 1),
    to_seq          BIGINT NOT NULL CHECK (to_seq >= from_seq),
    merkle_root     TEXT NOT NULL CHECK (char_length(merkle_root) = 64),
    entry_count     INT NOT NULL CHECK (entry_count >= 1),
    -- worm_object_key / worm_version_id reference the sealed, object-lock-
    -- protected checkpoint object in the WORM bucket (NULL for DB-only anchoring).
    worm_object_key TEXT,
    worm_version_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_attestation_checkpoint_tenant
    ON dr_attestation_checkpoint (tenant_id, created_at DESC);

-- "Which checkpoint covers seq N" lookup for inclusion proofs.
CREATE INDEX IF NOT EXISTS idx_dr_attestation_checkpoint_range
    ON dr_attestation_checkpoint (tenant_id, from_seq, to_seq);

-- ---------------------------------------------------------------------------
-- Row-Level Security: per-operation tenant isolation with an app.bypass_rls
-- backstop for the leader-singleton anchor loop (the dr_db convention).
-- ---------------------------------------------------------------------------

ALTER TABLE dr_attestation_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_attestation_ledger FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_attestation_ledger;
DROP POLICY IF EXISTS tenant_insert ON dr_attestation_ledger;
DROP POLICY IF EXISTS tenant_update ON dr_attestation_ledger;
DROP POLICY IF EXISTS tenant_delete ON dr_attestation_ledger;

CREATE POLICY tenant_isolation ON dr_attestation_ledger
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_attestation_ledger
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_attestation_ledger
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_attestation_ledger
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE dr_attestation_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_attestation_checkpoint FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_attestation_checkpoint;
DROP POLICY IF EXISTS tenant_insert ON dr_attestation_checkpoint;
DROP POLICY IF EXISTS tenant_update ON dr_attestation_checkpoint;
DROP POLICY IF EXISTS tenant_delete ON dr_attestation_checkpoint;

CREATE POLICY tenant_isolation ON dr_attestation_checkpoint
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_attestation_checkpoint
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_attestation_checkpoint
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_attestation_checkpoint
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
