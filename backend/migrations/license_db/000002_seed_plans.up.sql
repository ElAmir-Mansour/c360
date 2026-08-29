-- =============================================================================
-- Seed the license plan catalog and assign a development license.
--
-- The plan catalog (license_plans + plan_entitlements) is global, so it is
-- seeded here. Entitlement keys MUST match the keys the API gateway enforces
-- in internal/gateway/config/routes.go: suite.cyber, suite.data, suite.siem,
-- app.acta, app.watheeq, app.bosalah — plus the reserved seat key
-- service.SeatsKey ("seats.users"). A limit_value of NULL grants the key
-- without a quota; a positive value is a metered quota.
--
-- license_db is a separate database from platform_core, so there is no foreign
-- key to the tenants table — the dev tenant's UUID is referenced directly. The
-- assignment is a development fixture (far-future expiry) and is idempotent.
-- =============================================================================

BEGIN;

INSERT INTO license_plans (id, key, name, description, source)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'business-plus', 'Business Plus',
     'Cyber, Data, SIEM, Acta, Watheeq and BOSALAH with a bounded seat allocation.',
     'catalog'),
    ('22222222-2222-2222-2222-222222222222', 'enterprise', 'Enterprise',
     'Full platform access across every suite with unlimited seats.',
     'catalog')
ON CONFLICT (key) DO NOTHING;

-- Business Plus: every gateway-gated key granted, seats capped at 500.
INSERT INTO plan_entitlements (plan_id, key, limit_value)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'suite.cyber', NULL),
    ('11111111-1111-1111-1111-111111111111', 'suite.data', NULL),
    ('11111111-1111-1111-1111-111111111111', 'suite.siem', NULL),
    ('11111111-1111-1111-1111-111111111111', 'app.acta', NULL),
    ('11111111-1111-1111-1111-111111111111', 'app.watheeq', NULL),
    ('11111111-1111-1111-1111-111111111111', 'app.bosalah', NULL),
    ('11111111-1111-1111-1111-111111111111', 'suite.datastream', NULL),
    ('11111111-1111-1111-1111-111111111111', 'respond.major_incident', NULL),
    ('11111111-1111-1111-1111-111111111111', 'seats.users', 500)
ON CONFLICT (plan_id, key) DO NOTHING;

-- Enterprise: every key granted, seats unlimited.
INSERT INTO plan_entitlements (plan_id, key, limit_value)
VALUES
    ('22222222-2222-2222-2222-222222222222', 'suite.cyber', NULL),
    ('22222222-2222-2222-2222-222222222222', 'suite.data', NULL),
    ('22222222-2222-2222-2222-222222222222', 'suite.siem', NULL),
    ('22222222-2222-2222-2222-222222222222', 'app.acta', NULL),
    ('22222222-2222-2222-2222-222222222222', 'app.watheeq', NULL),
    ('22222222-2222-2222-2222-222222222222', 'app.bosalah', NULL),
    ('22222222-2222-2222-2222-222222222222', 'suite.datastream', NULL),
    ('22222222-2222-2222-2222-222222222222', 'respond.major_incident', NULL),
    ('22222222-2222-2222-2222-222222222222', 'seats.users', NULL)
ON CONFLICT (plan_id, key) DO NOTHING;

-- Development tenant (clario-dev) gets Business Plus, far-future expiry.
INSERT INTO tenant_licenses (
    tenant_id, plan_id, status, seats, starts_at, expires_at, grace_days, metadata
)
VALUES (
    'aaaaaaaa-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'active',
    100,
    now(),
    '2099-12-31 23:59:59+00',
    14,
    '{"environment":"development","seeded":true}'::jsonb
)
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;
