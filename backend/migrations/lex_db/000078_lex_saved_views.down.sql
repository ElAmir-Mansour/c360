-- Reverse of lex_saved_views.up.sql (#12 server saved views). Saved views are a
-- pure UX preference store — dropping the table (indexes + RLS policies go with
-- it) loses no legal-record data.
DROP TABLE IF EXISTS lex_saved_views;
