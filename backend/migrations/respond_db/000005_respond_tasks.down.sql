DROP POLICY IF EXISTS tenant_delete ON respond_incident_task_status_history;
DROP POLICY IF EXISTS tenant_update ON respond_incident_task_status_history;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_task_status_history;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_task_status_history;

DROP POLICY IF EXISTS tenant_delete ON respond_incident_task_assignment;
DROP POLICY IF EXISTS tenant_update ON respond_incident_task_assignment;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_task_assignment;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_task_assignment;

DROP POLICY IF EXISTS tenant_delete ON respond_incident_task_dependency;
DROP POLICY IF EXISTS tenant_update ON respond_incident_task_dependency;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_task_dependency;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_task_dependency;

DROP POLICY IF EXISTS tenant_delete ON respond_incident_task;
DROP POLICY IF EXISTS tenant_update ON respond_incident_task;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_task;
DROP POLICY IF EXISTS tenant_isolation ON respond_incident_task;

DROP POLICY IF EXISTS template_step_delete ON respond_task_template_step;
DROP POLICY IF EXISTS template_step_update ON respond_task_template_step;
DROP POLICY IF EXISTS template_step_insert ON respond_task_template_step;
DROP POLICY IF EXISTS template_step_select ON respond_task_template_step;

DROP POLICY IF EXISTS template_delete ON respond_task_template;
DROP POLICY IF EXISTS template_update ON respond_task_template;
DROP POLICY IF EXISTS template_insert ON respond_task_template;
DROP POLICY IF EXISTS template_select ON respond_task_template;

DROP TRIGGER IF EXISTS trg_respond_task_status_no_delete ON respond_incident_task_status_history;
DROP TRIGGER IF EXISTS trg_respond_task_status_no_update ON respond_incident_task_status_history;
DROP TRIGGER IF EXISTS trg_respond_task_assignment_no_delete ON respond_incident_task_assignment;
DROP TRIGGER IF EXISTS trg_respond_task_assignment_no_update ON respond_incident_task_assignment;
DROP FUNCTION IF EXISTS respond_task_history_no_mutation();

DROP TABLE IF EXISTS respond_incident_task_status_history;
DROP TABLE IF EXISTS respond_incident_task_assignment;
DROP TABLE IF EXISTS respond_incident_task_dependency;
DROP TABLE IF EXISTS respond_incident_task;
DROP TABLE IF EXISTS respond_task_template_step;
DROP TABLE IF EXISTS respond_task_template;
