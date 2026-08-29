-- Sign, seal & persist the rehearsal-proof envelope (government-readiness).
--
-- Before this migration the rehearsal-proof envelope (the artifact handed to an
-- auditor) was computed per-GET, protected only by a self-referential SHA-256,
-- and NEVER persisted, WORM-sealed, timestamped, or digitally SIGNED. This table
-- retains each generated proof as a signed, WORM-sealed, ledger-anchored record:
--
--   * envelope_json    -- the full auditable envelope (JSONB, lossless)
--   * envelope_hash    -- SHA-256 digest of the canonical envelope ("sha256:...")
--   * signature        -- base64 detached digital signature over envelope_hash
--   * signature_alg    -- RSA-SHA256 / ECDSA-SHA256 (how to verify the signature)
--   * signed_at        -- authoritative signing timestamp
--   * worm_object_key  -- immutable GOVERNANCE-locked object copy of the envelope
--   * ledger_seq       -- inclusion reference into the dr_attestation_ledger chain
--   * ledger_entry_hash-- the chain entry hash the proof was anchored as
--
-- The row is append-only: like dr_attestation_ledger (000043), an immutability
-- trigger blocks UPDATE/DELETE so a sealed proof cannot be altered or deleted
-- after the fact, including under bypass-RLS maintenance contexts.

CREATE TABLE IF NOT EXISTS dr_rehearsal_proof (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    -- subject_kind is the rehearsal type the proof attests: gameday,
    -- runbook_studio or failover_drill.
    subject_kind      TEXT NOT NULL CHECK (subject_kind IN (
        'gameday','runbook_studio','failover_drill')),
    -- subject_run_id is the id of the attested run (gameday/runbook/failover run).
    subject_run_id    TEXT NOT NULL,
    -- envelope_json is the full canonical proof envelope; it is what an auditor
    -- reads. envelope_hash is its SHA-256 digest.
    envelope_json     JSONB NOT NULL,
    envelope_hash     TEXT NOT NULL,
    -- signature is the base64 detached digital signature over envelope_hash;
    -- signature_alg names how to verify it.
    signature         TEXT NOT NULL,
    signature_alg     TEXT NOT NULL,
    signed_at         TIMESTAMPTZ NOT NULL,
    -- worm_object_key references the sealed, object-lock-protected envelope copy
    -- in the WORM bucket (NULL only for DB-only fallbacks — the sealer requires
    -- it in production).
    worm_object_key   TEXT,
    -- ledger_seq / ledger_entry_hash are the attestation-ledger inclusion
    -- reference: the monotonic seq and chain entry hash this proof was anchored
    -- as, so the proof is provably part of the same Merkle-anchored chain as the
    -- underlying Gate-4 attestations.
    ledger_seq        BIGINT,
    ledger_entry_hash TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One sealed proof per identical envelope digest, so re-generating an
    -- unchanged envelope is idempotent rather than accreting duplicate rows.
    CONSTRAINT uq_dr_rehearsal_proof_tenant_hash UNIQUE (tenant_id, envelope_hash)
);

-- Latest-per-subject and by-subject listing reads.
CREATE INDEX IF NOT EXISTS idx_dr_rehearsal_proof_subject
    ON dr_rehearsal_proof (tenant_id, subject_kind, subject_run_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-Level Security: per-operation tenant isolation with an app.bypass_rls
-- backstop (the dr_db convention, mirroring 000029/000043).
-- ---------------------------------------------------------------------------

ALTER TABLE dr_rehearsal_proof ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_rehearsal_proof FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_rehearsal_proof;
DROP POLICY IF EXISTS tenant_insert ON dr_rehearsal_proof;

CREATE POLICY tenant_isolation ON dr_rehearsal_proof
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_rehearsal_proof
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- NOTE: no tenant_update / tenant_delete policies are created — a sealed proof is
-- append-only. The immutability trigger below is the hard backstop that refuses
-- UPDATE/DELETE even in a bypass-RLS context.

-- ---------------------------------------------------------------------------
-- Append-only immutability: block every UPDATE/DELETE, matching the 000043
-- attestation-ledger trigger pattern. A sealed, signed proof is evidence; it may
-- never be mutated or deleted after it is written.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dr_rehearsal_proof_immutable_guard()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'dr_rehearsal_proof is append-only (delete refused)';
    END IF;
    RAISE EXCEPTION 'dr_rehearsal_proof rows are immutable (update refused)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dr_rehearsal_proof_immutable ON dr_rehearsal_proof;
CREATE TRIGGER trg_dr_rehearsal_proof_immutable
BEFORE UPDATE OR DELETE ON dr_rehearsal_proof
FOR EACH ROW EXECUTE FUNCTION dr_rehearsal_proof_immutable_guard();
