-- =============================================================================
-- Migration 000034: DSPM Access Remediation
--
-- Adds the ability to ACT ON a least-privilege recommendation (apply / revoke /
-- dismiss) and persist the resulting decision + state transition.
--
--   1. New columns on dspm_access_mappings carrying the remediation decision so
--      that a subsequently-recomputed recommendation reflects the new state.
--   2. A dspm_access_remediation_actions ledger table recording every action
--      (actor, timestamp, action, target permission, outcome, note) for audit.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Remediation decision columns on the mapping row.
-- ----------------------------------------------------------------------------
ALTER TABLE dspm_access_mappings
    ADD COLUMN IF NOT EXISTS remediation_status TEXT
        NOT NULL DEFAULT 'none'
        CHECK (remediation_status IN ('none', 'applied', 'revoked', 'dismissed')),
    ADD COLUMN IF NOT EXISTS remediation_note   TEXT,
    ADD COLUMN IF NOT EXISTS remediated_by      UUID,
    ADD COLUMN IF NOT EXISTS remediated_at      TIMESTAMPTZ;

-- Surface recently remediated mappings for a tenant.
CREATE INDEX IF NOT EXISTS idx_dspm_access_remediation_status
    ON dspm_access_mappings (tenant_id, remediation_status, remediated_at DESC)
    WHERE remediation_status <> 'none';

-- ----------------------------------------------------------------------------
-- 2. Remediation action ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dspm_access_remediation_actions (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID            NOT NULL,
    -- Target of the action.
    mapping_id          UUID            NOT NULL REFERENCES dspm_access_mappings(id),
    identity_type       TEXT            NOT NULL,
    identity_id         TEXT            NOT NULL,
    identity_name       TEXT,
    data_asset_id       UUID            NOT NULL,
    data_asset_name     TEXT,
    target_permission   TEXT            NOT NULL,
    -- The recommendation that motivated the action (recommendation type, e.g.
    -- revoke/downgrade/time_bound/review) plus a stable client-supplied ref.
    recommendation_type TEXT,
    -- Action taken.
    action              TEXT            NOT NULL
                                        CHECK (action IN ('apply', 'revoke', 'dismiss')),
    outcome             TEXT            NOT NULL DEFAULT 'recorded'
                                        CHECK (outcome IN ('recorded', 'enforced', 'failed')),
    note                TEXT,
    -- Whether external cloud-provider enforcement has been carried out. Today the
    -- platform records the decision + internal state only; real IAM enforcement
    -- is wired later via the enforcement hook (see service TODO).
    enforced_externally BOOLEAN         NOT NULL DEFAULT false,
    -- Actor.
    actor_id            UUID,
    -- Timestamp.
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dspm_remediation_actions_mapping
    ON dspm_access_remediation_actions (tenant_id, mapping_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dspm_remediation_actions_identity
    ON dspm_access_remediation_actions (tenant_id, identity_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. RLS for the new ledger table (matches the 000022 tenant-isolation policy set).
-- ----------------------------------------------------------------------------
ALTER TABLE dspm_access_remediation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dspm_access_remediation_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dspm_access_remediation_actions
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON dspm_access_remediation_actions
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON dspm_access_remediation_actions
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON dspm_access_remediation_actions
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
