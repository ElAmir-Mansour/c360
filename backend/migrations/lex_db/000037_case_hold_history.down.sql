-- #12 — drop the external-hold history table (and its dependent index + RLS
-- policies, which are removed implicitly with the table).
DROP TABLE IF EXISTS legal_case_hold_history;
