-- =============================================================================
-- Lex Integration Platform (Phase 2) — HR / identity connector idempotency map.
--
--   lex_hr_identity_map: the (tenant_id, endpoint_id, external_id) -> lex_kind /
--   lex_id reconciliation ledger written by the HR connector's Syncer and by the
--   inbound SCIM server. It makes user/group/worker/orgUnit upserts idempotent
--   across full + delta runs and across SCIM PUT/PATCH replays: a row records
--   which lex object (org_entity / org_role) a given upstream record maps to, plus
--   a content hash to skip no-op updates and the last-synced watermark.
--
--   tenant_id FIRST; 4 RLS policies; soft-delete via deactivated_at so a SCIM
--   active=false (or an HR delta tombstone) is a reversible soft-deactivation, not
--   a hard delete (audit + reactivation). NO secret material is ever stored here.
--
-- Staged: lives in _staging/ until the integrator assigns the next free migration
-- number (prior max at author time = 000058) and promotes it to lex_db/.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lex_hr_identity_map (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    endpoint_id     UUID        NOT NULL REFERENCES lex_integration_endpoints(id) ON DELETE CASCADE,
    -- external_id is the upstream stable identifier (SCIM id / HRIS worker id /
    -- LDAP entryUUID / CSV employee number). Unique per (tenant, endpoint).
    external_id     TEXT        NOT NULL,
    -- external_kind is the upstream resource type: user | group | worker | org_unit.
    external_kind   TEXT        NOT NULL DEFAULT 'user' CHECK (external_kind IN (
        'user', 'group', 'worker', 'org_unit'
    )),
    -- lex_kind / lex_id identify the reconciled lex object the external record maps
    -- onto. org_entity for groups/org-units, org_role for user->role bindings.
    lex_kind        TEXT        NOT NULL CHECK (lex_kind IN ('org_entity', 'org_role')),
    lex_id          UUID        NOT NULL,
    -- external_code is the normalized code used as the OrgEntity (tenant, code) key
    -- or the role binding's entity code (non-sensitive, for reconciliation reports).
    external_code   TEXT        NOT NULL DEFAULT '',
    -- content_hash is a sha256 of the normalized upstream payload; a delta/PUT whose
    -- hash matches the stored value is skipped (no-op) to keep the ledger honest.
    content_hash    TEXT        NOT NULL DEFAULT '',
    -- active mirrors the upstream active flag; SCIM active=false soft-deactivates.
    active          BOOLEAN     NOT NULL DEFAULT true,
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deactivated_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One mapping per upstream record per endpoint (drives the Syncer/SCIM ON CONFLICT).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_hr_identity_map_external_unique
    ON lex_hr_identity_map (tenant_id, endpoint_id, external_id);
CREATE INDEX IF NOT EXISTS idx_lex_hr_identity_map_lex
    ON lex_hr_identity_map (tenant_id, lex_kind, lex_id);
CREATE INDEX IF NOT EXISTS idx_lex_hr_identity_map_endpoint_kind
    ON lex_hr_identity_map (tenant_id, endpoint_id, external_kind, last_synced_at DESC);

ALTER TABLE lex_hr_identity_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_hr_identity_map FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_hr_identity_map
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_hr_identity_map
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_hr_identity_map
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_hr_identity_map
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
