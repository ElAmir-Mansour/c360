-- Grant the three Clario Recover sub-solution entitlement keys to the standard
-- paid/trial plans so an entitled tenant's Recover sub-solutions resolve `active`.
--
-- Mirrors 000006_respond_entitlement. The recover.* keys are already recognised
-- by the entitlement resolver and the sub-solution activation model records the
-- tenant's opt-in (`activated:true`), but the keys were never added to any plan,
-- so the effective entitlement stayed {active:false, reason:"not included in
-- plan"}. Adding them here flips entitled sub-solutions to active for tenants on
-- these plans (the demo tenant is on business-plus).
INSERT INTO plan_entitlements (plan_id, key, limit_value)
SELECT p.id, k.key, NULL
FROM license_plans p
CROSS JOIN (VALUES
    ('recover.it_dr'),
    ('recover.cloud_dr'),
    ('recover.cyber_recovery')
) AS k(key)
WHERE p.key IN ('business-plus', 'enterprise', 'trial')
ON CONFLICT (plan_id, key) DO NOTHING;
