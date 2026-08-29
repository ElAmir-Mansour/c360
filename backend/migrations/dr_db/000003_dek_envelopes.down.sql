ALTER TABLE recovery_point DROP COLUMN IF EXISTS legal_hold;

DROP TABLE IF EXISTS siem.index_metadata;
-- Leave the siem schema in place: dropping it could remove objects another
-- co-located component created. An empty schema is harmless.
