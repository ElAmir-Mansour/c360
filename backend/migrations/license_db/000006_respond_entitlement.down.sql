DELETE FROM plan_entitlements
WHERE key = 'respond.major_incident'
  AND plan_id IN (
      SELECT id
      FROM license_plans
      WHERE key IN ('business-plus', 'enterprise', 'trial')
  );
