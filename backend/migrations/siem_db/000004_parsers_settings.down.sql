-- SIEM-04 down — reverses parser catalogue and tenant settings.

ALTER TABLE IF EXISTS siem.sources
  DROP CONSTRAINT IF EXISTS sources_parser_fk;

DROP TABLE IF EXISTS siem.settings;
DROP TABLE IF EXISTS siem.parsers;
