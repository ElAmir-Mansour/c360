-- =============================================================================
-- WTQ-SEC-03 — Data residency / KSA hosting compliance
-- Binds each tenant to a residency region. The application layer enforces that
-- a deployment may only serve a tenant whose residency_region matches (or is
-- permitted by) the deployment's ServiceRegion. Physical hosting placement is
-- an infrastructure concern; this column is the app-level compliance binding.
-- =============================================================================

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS residency_region VARCHAR(64);

COMMENT ON COLUMN tenants.residency_region IS
    'Data residency region the tenant''s data must be served from (e.g. "ksa-central"). NULL means unrestricted (no residency constraint).';

-- Index used by the residency-enforcement middleware lookup path.
CREATE INDEX IF NOT EXISTS idx_tenants_residency_region
    ON tenants (residency_region)
    WHERE residency_region IS NOT NULL;
