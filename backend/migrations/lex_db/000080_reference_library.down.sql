-- Reverse of 000080_reference_library.up.sql. Drops the global reference-library
-- catalog outright (indexes + RLS policy fall with it). The physical PDF bytes
-- live in the file-service object store / mounted volume, not in this table, and
-- are left untouched.
DROP TABLE IF EXISTS reference_library_documents;
