DROP POLICY IF EXISTS tenant_delete ON dr_journal_bookmark;
DROP POLICY IF EXISTS tenant_update ON dr_journal_bookmark;
DROP POLICY IF EXISTS tenant_insert ON dr_journal_bookmark;
DROP POLICY IF EXISTS tenant_isolation ON dr_journal_bookmark;

DROP POLICY IF EXISTS tenant_delete ON dr_journal_segment;
DROP POLICY IF EXISTS tenant_update ON dr_journal_segment;
DROP POLICY IF EXISTS tenant_insert ON dr_journal_segment;
DROP POLICY IF EXISTS tenant_isolation ON dr_journal_segment;

DROP TRIGGER IF EXISTS dr_journal_segment_append_only_guard ON dr_journal_segment;
DROP FUNCTION IF EXISTS prevent_dr_journal_segment_mutation();

DROP TABLE IF EXISTS dr_journal_bookmark;
DROP TABLE IF EXISTS dr_journal_segment;
