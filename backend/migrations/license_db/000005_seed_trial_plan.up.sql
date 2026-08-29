-- =============================================================================
-- Seed the self-serve "trial" plan.
--
-- This plan is assigned automatically by onboarding (the provisioner's "Assign
-- Default License" step) to every self-serve tenant, replacing the previous
-- behaviour where tenants were hard-coded to subscription_tier='enterprise'
-- with NO license row (and therefore 402 on every suite route).
--
-- The trial GRANTS every self-serve suite/app key; onboarding then scopes it to
-- the customer's selection by writing a Limit=0 revoke override per UNSELECTED
-- key (overrides can only revoke, not add — see internal/catalog). Seats are
-- capped at 5. The time-box is set per tenant via tenant_licenses.expires_at +
-- grace_days at assignment time.
--
-- Keys MUST match internal/license/model/keys.go and internal/catalog.
-- =============================================================================

BEGIN;

INSERT INTO license_plans (id, key, name, description, source)
VALUES
    ('33333333-3333-3333-3333-333333333333', 'trial', 'Trial',
     'Self-serve trial. Grants the suites selected during onboarding (others revoked per tenant); 5 seats; time-boxed.',
     'catalog')
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_entitlements (plan_id, key, limit_value)
VALUES
    ('33333333-3333-3333-3333-333333333333', 'suite.cyber', NULL),
    ('33333333-3333-3333-3333-333333333333', 'suite.data', NULL),
    ('33333333-3333-3333-3333-333333333333', 'suite.siem', NULL),
    ('33333333-3333-3333-3333-333333333333', 'suite.datastream', NULL),
    ('33333333-3333-3333-3333-333333333333', 'app.acta', NULL),
    ('33333333-3333-3333-3333-333333333333', 'app.watheeq', NULL),
    ('33333333-3333-3333-3333-333333333333', 'app.bosalah', NULL),
    ('33333333-3333-3333-3333-333333333333', 'respond.major_incident', NULL),
    ('33333333-3333-3333-3333-333333333333', 'seats.users', 5)
ON CONFLICT (plan_id, key) DO NOTHING;

COMMIT;
