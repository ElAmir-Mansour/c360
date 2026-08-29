-- SIEM-03 down — reverses 000003_sources.up.sql.
--
-- Order matters: drop triggers + functions first, then dependent tables, then
-- the parent siem.sources table, then the ENUM types.
--
-- Idempotent: every drop is guarded with IF EXISTS so re-running is a no-op.

DROP TRIGGER IF EXISTS sources_touch ON siem.sources;
DROP FUNCTION IF EXISTS siem.touch_updated_at();

DROP TABLE IF EXISTS siem.enrollment_tokens;
DROP TABLE IF EXISTS siem.source_cert_revocations;
DROP TABLE IF EXISTS siem.source_eps_samples;
DROP TABLE IF EXISTS siem.source_credentials;
DROP TABLE IF EXISTS siem.sources;

DROP TYPE IF EXISTS siem.source_transport;
DROP TYPE IF EXISTS siem.source_status;
