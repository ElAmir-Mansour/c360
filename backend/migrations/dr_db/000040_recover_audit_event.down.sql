-- Reverse of 000040_recover_audit_event: drop the append-only cross-sub-solution
-- audit log (its indexes and RLS policies drop with the table). The evidence
-- export owns no other schema — it composes the Metastore seam and the existing
-- dr/* + cyber-recovery records in place — so nothing else to undo.
DROP TABLE IF EXISTS recover_audit_event;
