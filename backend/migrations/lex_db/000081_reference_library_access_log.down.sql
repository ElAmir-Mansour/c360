-- Reverse of 000081_reference_library_access_log.up.sql. Drops the audit log
-- (its indexes + RLS policy fall with it). The catalog it referenced and the PDF
-- bytes are untouched.
DROP TABLE IF EXISTS reference_library_access_log;
