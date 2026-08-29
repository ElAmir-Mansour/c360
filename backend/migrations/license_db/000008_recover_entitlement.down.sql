DELETE FROM plan_entitlements
WHERE key IN ('recover.it_dr', 'recover.cloud_dr', 'recover.cyber_recovery')
  AND plan_id IN (
      SELECT id
      FROM license_plans
      WHERE key IN ('business-plus', 'enterprise', 'trial')
  );
