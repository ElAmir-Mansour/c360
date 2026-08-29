-- Case & Investigation Control Panel read-path indexes.
--
-- resolved_last_7_days reads immutable close transitions in reverse chronological
-- order, tenant-scoped. The partial predicate keeps the index compact and avoids
-- adding write cost for unrelated case audit actions.
CREATE INDEX IF NOT EXISTS idx_legal_case_audit_closed_at
    ON legal_case_audit_log (tenant_id, created_at DESC, case_id)
    WHERE to_status = 'closed';

