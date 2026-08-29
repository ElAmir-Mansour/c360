-- SIEM-02 — rollback of store metadata.

DROP INDEX IF EXISTS siem.index_metadata_tenant_state_idx;
DROP TABLE IF EXISTS siem.index_metadata;
DROP TABLE IF EXISTS siem.tenant_store_status;
