DROP POLICY IF EXISTS tenant_delete ON migrate_approval_binding;
DROP POLICY IF EXISTS tenant_update ON migrate_approval_binding;
DROP POLICY IF EXISTS tenant_insert ON migrate_approval_binding;
DROP POLICY IF EXISTS tenant_select ON migrate_approval_binding;

DROP INDEX IF EXISTS idx_migrate_approval_binding_pending;
DROP INDEX IF EXISTS idx_migrate_approval_binding_subject;
DROP INDEX IF EXISTS idx_migrate_approval_binding_instance;
DROP INDEX IF EXISTS uq_migrate_approval_binding_active_subject;

DROP TABLE IF EXISTS migrate_approval_binding;
