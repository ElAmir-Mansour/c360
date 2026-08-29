-- =============================================================================
-- Pricing & Quoting Phase 4 (commercial loop): seed the four TIER PLANS.
--
-- The four pricing tiers (standard / growth / professional / customized) map
-- 1:1 to license_plans BY KEY. This migration seeds those four catalog plans so
-- the tier→plan mapping (internal/pricing/service.DefaultTierPlanMap, identity-
-- mapped) resolves to real, assignable plans. Provision-from-quote then assigns
-- one of these to a tenant via the existing AssignLicense lifecycle.
--
-- Each tier plan grants the full product surface (suite/app keys) so a
-- provisioned tenant has access; seats are unlimited at the plan level (the
-- per-tenant seat count comes from the license's seats field, which takes
-- precedence). The metered `ai.tokens` key carries a per-tier PLAN DEFAULT
-- monthly allowance (millions); the actual per-tenant allowance is set as an
-- override at provision time (ai_allowance_millions * units), which takes
-- precedence over this default. Customized grants ai.tokens WITHOUT a quota
-- (NULL = uncapped dedicated AI), mirroring how enterprise grants seats.users.
--
-- Additive / reversible / idempotent: INSERT ... ON CONFLICT DO NOTHING with
-- fixed UUIDs; it seeds catalog rows only and references no other table beyond
-- the plan_entitlements FK, so existing license-service tests cannot regress.
-- The down migration removes exactly these four plans (cascading their
-- entitlements) and nothing else.
-- =============================================================================

BEGIN;

INSERT INTO license_plans (id, key, name, description, source, status)
VALUES
    ('cccccccc-0000-0000-0000-000000000001', 'standard', 'Standard',
     'Standard tier — entry commercial tier from the pricing calculator.', 'catalog', 'active'),
    ('cccccccc-0000-0000-0000-000000000002', 'growth', 'Growth',
     'Growth tier — scaled resources and AI allowance.', 'catalog', 'active'),
    ('cccccccc-0000-0000-0000-000000000003', 'professional', 'Professional',
     'Professional tier — highest capped AI allowance.', 'catalog', 'active'),
    ('cccccccc-0000-0000-0000-000000000004', 'customized', 'Customized',
     'Customized tier — dedicated AI infrastructure (uncapped) and bespoke scope.', 'catalog', 'active')
ON CONFLICT (key) DO NOTHING;

-- Standard: full product surface, unlimited plan seats, ai.tokens default 2M/mo.
INSERT INTO plan_entitlements (plan_id, key, limit_value)
VALUES
    ('cccccccc-0000-0000-0000-000000000001', 'suite.cyber', NULL),
    ('cccccccc-0000-0000-0000-000000000001', 'suite.data', NULL),
    ('cccccccc-0000-0000-0000-000000000001', 'suite.siem', NULL),
    ('cccccccc-0000-0000-0000-000000000001', 'suite.datastream', NULL),
    ('cccccccc-0000-0000-0000-000000000001', 'app.acta', NULL),
    ('cccccccc-0000-0000-0000-000000000001', 'app.watheeq', NULL),
    ('cccccccc-0000-0000-0000-000000000001', 'app.bosalah', NULL),
    ('cccccccc-0000-0000-0000-000000000001', 'ai.tokens', 2),
    ('cccccccc-0000-0000-0000-000000000001', 'seats.users', NULL)
ON CONFLICT (plan_id, key) DO NOTHING;

-- Growth: ai.tokens default 5M/mo.
INSERT INTO plan_entitlements (plan_id, key, limit_value)
VALUES
    ('cccccccc-0000-0000-0000-000000000002', 'suite.cyber', NULL),
    ('cccccccc-0000-0000-0000-000000000002', 'suite.data', NULL),
    ('cccccccc-0000-0000-0000-000000000002', 'suite.siem', NULL),
    ('cccccccc-0000-0000-0000-000000000002', 'suite.datastream', NULL),
    ('cccccccc-0000-0000-0000-000000000002', 'app.acta', NULL),
    ('cccccccc-0000-0000-0000-000000000002', 'app.watheeq', NULL),
    ('cccccccc-0000-0000-0000-000000000002', 'app.bosalah', NULL),
    ('cccccccc-0000-0000-0000-000000000002', 'ai.tokens', 5),
    ('cccccccc-0000-0000-0000-000000000002', 'seats.users', NULL)
ON CONFLICT (plan_id, key) DO NOTHING;

-- Professional: ai.tokens default 10M/mo.
INSERT INTO plan_entitlements (plan_id, key, limit_value)
VALUES
    ('cccccccc-0000-0000-0000-000000000003', 'suite.cyber', NULL),
    ('cccccccc-0000-0000-0000-000000000003', 'suite.data', NULL),
    ('cccccccc-0000-0000-0000-000000000003', 'suite.siem', NULL),
    ('cccccccc-0000-0000-0000-000000000003', 'suite.datastream', NULL),
    ('cccccccc-0000-0000-0000-000000000003', 'app.acta', NULL),
    ('cccccccc-0000-0000-0000-000000000003', 'app.watheeq', NULL),
    ('cccccccc-0000-0000-0000-000000000003', 'app.bosalah', NULL),
    ('cccccccc-0000-0000-0000-000000000003', 'ai.tokens', 10),
    ('cccccccc-0000-0000-0000-000000000003', 'seats.users', NULL)
ON CONFLICT (plan_id, key) DO NOTHING;

-- Customized: ai.tokens granted WITHOUT quota (NULL = uncapped dedicated AI).
INSERT INTO plan_entitlements (plan_id, key, limit_value)
VALUES
    ('cccccccc-0000-0000-0000-000000000004', 'suite.cyber', NULL),
    ('cccccccc-0000-0000-0000-000000000004', 'suite.data', NULL),
    ('cccccccc-0000-0000-0000-000000000004', 'suite.siem', NULL),
    ('cccccccc-0000-0000-0000-000000000004', 'suite.datastream', NULL),
    ('cccccccc-0000-0000-0000-000000000004', 'app.acta', NULL),
    ('cccccccc-0000-0000-0000-000000000004', 'app.watheeq', NULL),
    ('cccccccc-0000-0000-0000-000000000004', 'app.bosalah', NULL),
    ('cccccccc-0000-0000-0000-000000000004', 'ai.tokens', NULL),
    ('cccccccc-0000-0000-0000-000000000004', 'seats.users', NULL)
ON CONFLICT (plan_id, key) DO NOTHING;

COMMIT;
