-- Clean-room recovery validation (FR-DR-005 / DESIGN_DataStream_DR.md §15.4).
--
-- Before a recovery point may be marked recoverable, its sealed chunks are
-- restored into an isolated sandbox and put through real integrity + malware
-- scanning. Every scan attempt records an immutable verdict here so a clean
-- recovery point can be promoted and a dirty one is blocked with an auditable
-- reason. The newest CLEAN verdict for a recovery point is what gates promotion.

CREATE TABLE IF NOT EXISTS dr_cleanroom_scan (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    recovery_point_id UUID NOT NULL REFERENCES recovery_point(id) ON DELETE CASCADE,
    group_id          UUID NOT NULL,
    -- verdict is the terminal outcome of the scan:
    --   clean           -> integrity + malware checks all passed
    --   malware         -> a scanner flagged malicious content in a restored chunk
    --   integrity_failed-> a restored chunk's sha256 != the sealed content hash
    --   error           -> the scan could not complete (restore/scanner failure)
    verdict           TEXT NOT NULL CHECK (verdict IN ('clean','malware','integrity_failed','error')),
    -- scanner names the implementation that produced the verdict (e.g. 'clamav',
    -- 'signature') for audit and triage.
    scanner           TEXT NOT NULL,
    -- chunks_scanned / bytes_scanned quantify the work performed so a verdict is
    -- not mistaken for a vacuous "nothing to scan" pass.
    chunks_scanned    INT NOT NULL DEFAULT 0 CHECK (chunks_scanned >= 0),
    bytes_scanned     BIGINT NOT NULL DEFAULT 0 CHECK (bytes_scanned >= 0),
    -- detail captures the human-readable finding(s): virus name, the offending
    -- stream id, expected/actual hash on an integrity failure, or an error.
    detail            TEXT NOT NULL DEFAULT '',
    -- findings is the structured, per-chunk breakdown (stream id, verdict, hash,
    -- signature) used by the dashboard and the attestation report.
    findings          JSONB NOT NULL DEFAULT '[]'::jsonb,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_cleanroom_scan_rp
    ON dr_cleanroom_scan (tenant_id, recovery_point_id, finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_cleanroom_scan_group
    ON dr_cleanroom_scan (tenant_id, group_id, finished_at DESC);

-- The latest clean verdict per recovery point gates promotion; index the
-- clean rows for the "is this recovery point clean-room validated" lookup.
CREATE INDEX IF NOT EXISTS idx_dr_cleanroom_scan_clean
    ON dr_cleanroom_scan (recovery_point_id, finished_at DESC)
    WHERE verdict = 'clean';

ALTER TABLE dr_cleanroom_scan ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_cleanroom_scan FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_cleanroom_scan;
DROP POLICY IF EXISTS tenant_insert ON dr_cleanroom_scan;
DROP POLICY IF EXISTS tenant_update ON dr_cleanroom_scan;
DROP POLICY IF EXISTS tenant_delete ON dr_cleanroom_scan;

CREATE POLICY tenant_isolation ON dr_cleanroom_scan
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_cleanroom_scan
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_cleanroom_scan
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_cleanroom_scan
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
