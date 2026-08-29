DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'legal_case_sub_audit_log_resource_type_check'
          AND conrelid = 'legal_case_sub_audit_log'::regclass
    ) THEN
        ALTER TABLE legal_case_sub_audit_log DROP CONSTRAINT legal_case_sub_audit_log_resource_type_check;
    END IF;
END$$;

DELETE FROM legal_case_sub_audit_log
WHERE resource_type IN ('comment', 'document_link');

ALTER TABLE legal_case_sub_audit_log
    ADD CONSTRAINT legal_case_sub_audit_log_resource_type_check
    CHECK (resource_type IN ('party', 'hearing', 'task'));

DROP TABLE IF EXISTS legal_case_documents;
DROP TABLE IF EXISTS legal_case_comments;
