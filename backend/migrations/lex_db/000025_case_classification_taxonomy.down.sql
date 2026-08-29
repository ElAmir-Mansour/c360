-- Reverse the case-classification taxonomy. Audit log (no FK) first, then the
-- self-referencing taxonomy table.
DROP TABLE IF EXISTS legal_case_classification_audit_log;
DROP TABLE IF EXISTS legal_case_classifications;
