-- Two additive, backward-compatible columns on dr_boot_service that let the
-- dependency-aware boot graph (capability #13) drive REAL boots and integrate
-- with the §6.3 recovery executor.
--
-- boot_action: how the orchestrator ISSUES this service's boot (not only
--   health-gates one performed out-of-band). The wiring-layer Booter dispatches
--   it by scheme: 'cmd:<argv>' runs a local provisioner command, 'http(s)://...'
--   POSTs the service context to a recovery webhook. EMPTY preserves the prior
--   out-of-band behaviour (the orchestrator is a pure health barrier).
--
-- site_id: an OPTIONAL explicit link from a boot service to the recovery_target
--   site it represents. When every recovery target of a group is linked to a
--   boot service, the recovery executor boots in the DAG's dependency tiers with
--   a health-gate barrier between tiers instead of the flat recovery_target
--   boot_order. When unset (or the link is incomplete), the executor falls back
--   to the flat boot_order, so existing groups are unaffected. A site maps to at
--   most one boot service within a group (partial unique index).
ALTER TABLE dr_boot_service
    ADD COLUMN IF NOT EXISTS boot_action TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS site_id UUID;

-- A protected site is represented by at most one boot service per group.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dr_boot_service_group_site
    ON dr_boot_service (group_id, site_id)
    WHERE site_id IS NOT NULL;
