-- Reverse 000010. Removes the seeded platform-default email templates. Only the
-- default-tenant seed rows are deleted; per-tenant overrides are left intact.
DELETE FROM notification_templates
WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
  AND channel = 'email'
  AND id IN (
    'alert.created', 'alert.escalated', 'task.assigned', 'security.incident',
    'system.maintenance', 'pipeline.failed', 'contract.expiring', 'generic', 'digest'
  );
