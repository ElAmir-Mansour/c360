package consumer

import (
	"encoding/json"
	"strings"

	"github.com/clario360/platform/internal/cyber/cti"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/notification/model"
)

// RecipientMode describes how to resolve recipients for a rule.
type RecipientMode string

const (
	RecipientRoleBased       RecipientMode = "role_based"
	RecipientDirect          RecipientMode = "direct"
	RecipientMixed           RecipientMode = "mixed"
	RecipientComputed        RecipientMode = "computed"
	RecipientTenantBroadcast RecipientMode = "tenant_broadcast"
)

// NotificationRule defines the mapping from a domain event to a notification.
type NotificationRule struct {
	Topic             string
	EventType         string
	Condition         func(data map[string]interface{}) bool
	NotifType         model.NotificationType
	Category          string
	Priority          string
	PriorityFunc      func(data map[string]interface{}) string
	Channels          []string
	RecipientMode     RecipientMode
	Roles             []string
	RoleField         string
	DirectFields      []string
	ComputedRecipient string
	TitleTemplate     string
	BodyTemplate      string
	ActionURLTmpl     string
}

// MatchedRule is a rule that matched an event.
type MatchedRule struct {
	Rule *NotificationRule
	Data map[string]interface{}
}

// RuleEngine matches domain events to notification rules.
type RuleEngine struct {
	rules map[string][]*NotificationRule // eventType -> rules
}

// NewRuleEngine creates a new RuleEngine with all pre-configured rules.
func NewRuleEngine() *RuleEngine {
	re := &RuleEngine{rules: make(map[string][]*NotificationRule)}

	re.addRule(&NotificationRule{
		Topic:         events.Topics.AlertEvents,
		EventType:     "com.clario360.cyber.alert.created",
		NotifType:     model.NotifAlertCreated,
		Category:      model.CategorySecurity,
		Priority:      model.PriorityCritical,
		Channels:      []string{"email", "in_app", "push"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"security-manager"},
		Condition: func(data map[string]interface{}) bool {
			return stringValue(data["severity"]) == "critical"
		},
		TitleTemplate: "{{.title}}",
		BodyTemplate:  "A critical security alert was raised: {{.title}}.",
		ActionURLTmpl: "/cyber/alerts/{{.id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.AlertEvents,
		EventType:     "com.clario360.cyber.alert.created",
		NotifType:     model.NotifAlertCreated,
		Category:      model.CategorySecurity,
		Priority:      model.PriorityHigh,
		Channels:      []string{"in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"security-analyst"},
		Condition: func(data map[string]interface{}) bool {
			return stringValue(data["severity"]) == "high"
		},
		TitleTemplate: "{{.title}}",
		BodyTemplate:  "A high-severity security alert was raised: {{.title}}.",
		ActionURLTmpl: "/cyber/alerts/{{.id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         cti.TopicCTIAlerts,
		EventType:     "com.clario360." + cti.EventCriticalThreatAlert,
		NotifType:     model.NotifSecurityIncident,
		Category:      model.CategorySecurity,
		Priority:      model.PriorityCritical,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"security-manager", "security-analyst"},
		TitleTemplate: "{{.title}}",
		BodyTemplate:  "{{.description}}",
		ActionURLTmpl: "{{.action_url}}",
	})
	re.addRule(&NotificationRule{
		Topic:         cti.TopicCTIAlerts,
		EventType:     "com.clario360." + cti.EventCampaignEscalation,
		NotifType:     model.NotifSecurityIncident,
		Category:      model.CategorySecurity,
		Priority:      model.PriorityCritical,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"security-manager", "security-analyst"},
		TitleTemplate: "{{.title}}",
		BodyTemplate:  "{{.description}}",
		ActionURLTmpl: "{{.action_url}}",
	})
	re.addRule(&NotificationRule{
		Topic:         cti.TopicCTIAlerts,
		EventType:     "com.clario360." + cti.EventBrandAbuseUrgent,
		NotifType:     model.NotifSecurityIncident,
		Category:      model.CategorySecurity,
		Priority:      model.PriorityCritical,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"security-manager", "security-analyst"},
		TitleTemplate: "{{.title}}",
		BodyTemplate:  "{{.description}}",
		ActionURLTmpl: "{{.action_url}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.RemediationEvents,
		EventType:     "com.clario360.cyber.remediation.execution_failed",
		NotifType:     model.NotifRemediationFailed,
		Category:      model.CategorySecurity,
		Priority:      model.PriorityCritical,
		Channels:      []string{"email", "in_app", "push"},
		RecipientMode: RecipientMixed,
		Roles:         []string{"security-manager"},
		DirectFields:  []string{"created_by"},
		TitleTemplate: "Remediation Failed",
		BodyTemplate:  "Automated remediation {{.id}} failed. Error: {{.error}}",
		ActionURLTmpl: "/cyber/remediation/{{.id}}",
	})
	re.addRule(&NotificationRule{
		Topic:             events.Topics.RemediationEvents,
		EventType:         "com.clario360.cyber.remediation.executed",
		NotifType:         model.NotifRemediationCompleted,
		Category:          model.CategorySecurity,
		Priority:          model.PriorityMedium,
		Channels:          []string{"in_app"},
		RecipientMode:     RecipientComputed,
		ComputedRecipient: "asset_owners_from_event",
		TitleTemplate:     "Remediation Completed",
		BodyTemplate:      "Remediation {{.id}} completed successfully.",
		ActionURLTmpl:     "/cyber/remediation/{{.id}}",
	})

	re.addRule(&NotificationRule{
		Topic:             events.Topics.PipelineEvents,
		EventType:         "com.clario360.data.pipeline.run.failed",
		NotifType:         model.NotifPipelineFailed,
		Category:          model.CategoryData,
		Priority:          model.PriorityHigh,
		Channels:          []string{"email", "in_app"},
		RecipientMode:     RecipientComputed,
		ComputedRecipient: "pipeline_owner_from_event",
		TitleTemplate:     "Pipeline Failed: {{.pipeline_name}}",
		BodyTemplate:      "Pipeline {{.pipeline_name}} failed. {{.error_message}}",
		ActionURLTmpl:     "/data/pipelines/{{.pipeline_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.QualityEvents,
		EventType:     "com.clario360.data.quality.check_failed",
		NotifType:     model.NotifQualityIssue,
		Category:      model.CategoryData,
		Priority:      model.PriorityHigh,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"data-steward"},
		Condition: func(data map[string]interface{}) bool {
			sev := stringValue(data["severity"])
			return sev == "critical" || sev == "high"
		},
		TitleTemplate: "Data Quality Check Failed",
		BodyTemplate:  "Rule {{.rule_id}} failed with severity {{.severity}}.",
		ActionURLTmpl: "/data/quality/results",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.ContradictionEvents,
		EventType:     "com.clario360.data.contradiction.detected",
		NotifType:     model.NotifContradictionFound,
		Category:      model.CategoryData,
		Priority:      model.PriorityMedium,
		Channels:      []string{"in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"data-steward", "data-analyst"},
		Condition: func(data map[string]interface{}) bool {
			sev := stringValue(data["severity"])
			return sev == "high" || sev == "critical"
		},
		TitleTemplate: "Data Contradiction Detected",
		BodyTemplate:  "{{.title}}",
		ActionURLTmpl: "/data/contradictions/{{.id}}",
	})

	re.addRule(&NotificationRule{
		Topic:             events.Topics.ActaEvents,
		EventType:         "com.clario360.acta.meeting.scheduled",
		NotifType:         model.NotifMeetingScheduled,
		Category:          model.CategoryGovernance,
		Priority:          model.PriorityMedium,
		Channels:          []string{"email", "in_app"},
		RecipientMode:     RecipientComputed,
		ComputedRecipient: "committee_members_from_event",
		TitleTemplate:     "Meeting Scheduled: {{.title}}",
		BodyTemplate:      "Meeting {{.title}} is scheduled for {{formatDate .scheduled_at}}.",
		ActionURLTmpl:     "/acta/meetings/{{.id}}",
	})
	re.addRule(&NotificationRule{
		Topic:             events.Topics.ActaEvents,
		EventType:         "com.clario360.acta.meeting.reminder",
		NotifType:         model.NotifMeetingReminder,
		Category:          model.CategoryGovernance,
		Channels:          []string{"email", "in_app"},
		RecipientMode:     RecipientComputed,
		ComputedRecipient: "meeting_attendees_from_event",
		PriorityFunc: func(data map[string]interface{}) string {
			if floatValue(data["hours_until"]) <= 1 {
				return model.PriorityHigh
			}
			return model.PriorityMedium
		},
		TitleTemplate: "Meeting Reminder: {{.title}}",
		BodyTemplate:  "Meeting {{.title}} starts in {{.hours_until}} hour(s).",
		ActionURLTmpl: "/acta/meetings/{{.meeting_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.ActaEvents,
		EventType:     "com.clario360.acta.action_item.created",
		NotifType:     model.NotifActionItemAssigned,
		Category:      model.CategoryGovernance,
		Priority:      model.PriorityMedium,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientDirect,
		DirectFields:  []string{"assigned_to"},
		TitleTemplate: "Action Item Assigned",
		BodyTemplate:  "A new action item has been assigned to you.",
		ActionURLTmpl: "/acta/action-items/{{.id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.ActaEvents,
		EventType:     "com.clario360.acta.action_item.overdue",
		NotifType:     model.NotifActionItemOverdue,
		Category:      model.CategoryGovernance,
		Priority:      model.PriorityHigh,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientDirect,
		DirectFields:  []string{"assigned_to", "chair_user_id"},
		TitleTemplate: "Action Item Overdue: {{.title}}",
		BodyTemplate:  "Action item {{.title}} is overdue as of {{.due_date}}.",
		ActionURLTmpl: "/acta/action-items/{{.id}}",
	})
	re.addRule(&NotificationRule{
		Topic:             events.Topics.ActaEvents,
		EventType:         "com.clario360.acta.minutes.approved",
		NotifType:         model.NotifMinutesApproved,
		Category:          model.CategoryGovernance,
		Priority:          model.PriorityMedium,
		Channels:          []string{"email", "in_app"},
		RecipientMode:     RecipientComputed,
		ComputedRecipient: "committee_members_from_event",
		TitleTemplate:     "Minutes Approved",
		BodyTemplate:      "Meeting minutes have been approved.",
		ActionURLTmpl:     "/acta/meetings/{{.meeting_id}}",
	})

	re.addRule(&NotificationRule{
		Topic:         events.Topics.LexEvents,
		EventType:     "com.clario360.lex.contract.created",
		NotifType:     model.NotifContractCreated,
		Category:      model.CategoryLegal,
		Priority:      model.PriorityMedium,
		Channels:      []string{"in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"legal-analyst", "legal-manager"},
		TitleTemplate: "Contract Created: {{.title}}",
		BodyTemplate:  "A new contract was created: {{.title}}.",
		ActionURLTmpl: "/lex/contracts/{{.id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.LexEvents,
		EventType:     "com.clario360.lex.contract.expiring",
		NotifType:     model.NotifContractExpiring,
		Category:      model.CategoryLegal,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientMixed,
		Roles:         []string{"legal-manager"},
		DirectFields:  []string{"owner_user_id"},
		PriorityFunc: func(data map[string]interface{}) string {
			if floatValue(data["days_until_expiry"]) <= 7 {
				return model.PriorityCritical
			}
			return model.PriorityHigh
		},
		TitleTemplate: "Contract Expiring: {{.title}}",
		BodyTemplate:  "{{.title}} expires in {{.days_until_expiry}} days.",
		ActionURLTmpl: "/lex/contracts/{{.id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.LexEvents,
		EventType:     "com.clario360.enterprise.lex.contract.expiring",
		NotifType:     model.NotifContractExpiring,
		Category:      model.CategoryLegal,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientMixed,
		Roles:         []string{"legal-manager"},
		DirectFields:  []string{"owner_user_id"},
		PriorityFunc: func(data map[string]interface{}) string {
			if floatValue(data["days_until_expiry"]) <= 7 {
				return model.PriorityCritical
			}
			return model.PriorityHigh
		},
		TitleTemplate: "Contract Expiring: {{.title}}",
		BodyTemplate:  "{{.title}} expires in {{.days_until_expiry}} days.",
		ActionURLTmpl: "/lex/contracts/{{.id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.LexEvents,
		EventType:     "com.clario360.lex.contract.analyzed",
		NotifType:     model.NotifAnalysisReady,
		Category:      model.CategoryLegal,
		Priority:      model.PriorityMedium,
		Channels:      []string{"in_app"},
		RecipientMode: RecipientDirect,
		DirectFields:  []string{"created_by"},
		TitleTemplate: "Contract Analysis Ready",
		BodyTemplate:  "Analysis for {{.title}} is ready.",
		ActionURLTmpl: "/lex/contracts/{{.id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.LexEvents,
		EventType:     "com.clario360.lex.clause.risk_flagged",
		NotifType:     model.NotifClauseRiskFlagged,
		Category:      model.CategoryLegal,
		Priority:      model.PriorityHigh,
		Channels:      []string{"in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"legal-analyst"},
		Condition: func(data map[string]interface{}) bool {
			sev := stringValue(data["severity"])
			return sev == "high" || sev == "critical"
		},
		TitleTemplate: "Clause Risk Flagged",
		BodyTemplate:  "A high-risk clause was flagged in {{.contract_title}}.",
		ActionURLTmpl: "/lex/contracts/{{.contract_id}}",
	})

	// WTQ-RSK-02 #10: playbook clause-deviation alert. Fires when a contract's
	// clause-deviation report carries a high/critical-severity deviation OR a missing
	// REQUIRED clause, so the legal team is alerted to a material non-conformance with
	// the standard playbook. Additive: a NEW EventType key, so no existing rule
	// changes behaviour. Routed in-app to the legal reviewer roles. Category is
	// "legal" (the FE filters on data.event_type / data.contract_id). contract_id,
	// playbook_id, the per-kind counts and max_severity all travel in the
	// notification data payload (set by playbook_service.deviationsDetectedPayload).
	re.addRule(&NotificationRule{
		Topic:         events.Topics.LexEvents,
		EventType:     "com.clario360.lex.playbook.deviations_detected",
		NotifType:     model.NotifPlaybookDeviation,
		Category:      model.CategoryLegal,
		Priority:      model.PriorityHigh,
		Channels:      []string{"in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"legal-analyst", "legal-manager"},
		Condition: func(data map[string]interface{}) bool {
			sev := stringValue(data["max_severity"])
			if sev == "high" || sev == "critical" {
				return true
			}
			return floatValue(data["missing_required_count"]) > 0
		},
		PriorityFunc: func(data map[string]interface{}) string {
			if stringValue(data["max_severity"]) == "critical" {
				return model.PriorityCritical
			}
			return model.PriorityHigh
		},
		TitleTemplate: "Playbook Deviation Detected",
		BodyTemplate:  "Contract clauses deviate from playbook {{.playbook_name}}: {{.missing_count}} missing, {{.altered_count}} altered, {{.extra_count}} extra.",
		ActionURLTmpl: "/lex/contracts/{{.contract_id}}/clause-deviations",
	})

	// #19 Case-timeline realtime — relay the 8 matter timeline / external-hold /
	// delay / deadline CloudEvents to a notification.new WS push. Additive: each is
	// a NEW EventType key, so no existing rule changes behaviour. Routed in-app only
	// to the actor (DirectFields actor_id, injected by MatchData); the matter owner
	// could be added later if the event carries owner_user_id. Category is "legal"
	// (the matter_db/notification CHECK constraint does not allow "case"); the FE
	// filters on data.event_type / data.matter_id, not the category. matter_id,
	// event_type and actor_id all travel in the notification data payload.
	for _, mt := range []struct {
		eventType string
		title     string
		body      string
	}{
		{"com.clario360.lex.matter.timeline_updated", "Matter timeline updated", "The timeline estimate for a matter was updated."},
		{"com.clario360.lex.matter.external_hold_set", "Matter placed on hold", "A matter was placed on external hold."},
		{"com.clario360.lex.matter.external_hold_cleared", "Matter hold cleared", "An external hold on a matter was cleared."},
		{"com.clario360.lex.matter.delay_recorded", "Delay recorded", "A delay was recorded on a matter."},
		{"com.clario360.lex.matter.delay_resolved", "Delay resolved", "A delay on a matter was resolved."},
		{"com.clario360.lex.matter.delay_updated", "Delay updated", "A delay record on a matter was updated."},
		{"com.clario360.lex.matter.delay_reopened", "Delay reopened", "A delay on a matter was reopened."},
		{"com.clario360.lex.matter.deadline_obligation_created", "Deadline added", "A deadline was added to a matter."},
	} {
		re.addRule(&NotificationRule{
			Topic:         events.Topics.LexEvents,
			EventType:     mt.eventType,
			NotifType:     model.NotifMatterTimeline,
			Category:      model.CategoryLegal,
			Priority:      model.PriorityMedium,
			Channels:      []string{"in_app"},
			RecipientMode: RecipientDirect,
			DirectFields:  []string{"actor_id"},
			TitleTemplate: mt.title,
			BodyTemplate:  mt.body,
			ActionURLTmpl: "/lex/matters/{{.matter_id}}",
		})
	}

	re.addRule(&NotificationRule{
		Topic:         events.Topics.WorkflowEvents,
		EventType:     "com.clario360.workflow.task.created",
		NotifType:     model.NotifTaskAssigned,
		Category:      model.CategoryWorkflow,
		Priority:      model.PriorityMedium,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientMixed,
		DirectFields:  []string{"assignee_id"},
		RoleField:     "assignee_role",
		TitleTemplate: "New Task: {{.task_name}}",
		BodyTemplate:  "You have been assigned a workflow task: {{.task_name}}.",
		ActionURLTmpl: "/workflow/tasks/{{.task_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.WorkflowEvents,
		EventType:     "com.clario360.workflow.task.sla_breached",
		NotifType:     model.NotifTaskOverdue,
		Category:      model.CategoryWorkflow,
		Priority:      model.PriorityHigh,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientMixed,
		DirectFields:  []string{"claimed_by", "assignee_id"},
		TitleTemplate: "Task Overdue: {{.task_name}}",
		BodyTemplate:  "Workflow task {{.task_name}} breached its SLA.",
		ActionURLTmpl: "/workflow/tasks/{{.task_id}}",
	})
	// Pre-breach SLA reminder — fires BEFORE the deadline (remind_before ahead of
	// breach) so the assignee/claimant is warned in time, not after breach. Mirrors
	// the sla_breached rule's recipient fan-out; the emitter is the workflow
	// scheduler's reminder branch (previously log-only). Additive: a NEW EventType
	// key, so no existing rule changes behaviour.
	re.addRule(&NotificationRule{
		Topic:         events.Topics.WorkflowEvents,
		EventType:     "com.clario360.workflow.task.sla_reminder",
		NotifType:     model.NotifTaskSLAReminder,
		Category:      model.CategoryWorkflow,
		Priority:      model.PriorityMedium,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientMixed,
		DirectFields:  []string{"claimed_by", "assignee_id"},
		RoleField:     "assignee_role",
		TitleTemplate: "SLA Reminder: {{.task_name}}",
		BodyTemplate:  "Workflow task {{.task_name}} is approaching its SLA deadline.",
		ActionURLTmpl: "/workflow/tasks/{{.task_id}}",
	})
	// At-risk warning — a single escalated "approaching breach" signal for the
	// task (emitted once per evaluation, not per reminder tier). Higher priority
	// than a plain reminder because a due reminder tier means the deadline is near.
	re.addRule(&NotificationRule{
		Topic:         events.Topics.WorkflowEvents,
		EventType:     "com.clario360.workflow.task.at_risk",
		NotifType:     model.NotifTaskAtRisk,
		Category:      model.CategoryWorkflow,
		Priority:      model.PriorityHigh,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientMixed,
		DirectFields:  []string{"claimed_by", "assignee_id"},
		RoleField:     "assignee_role",
		TitleTemplate: "Task At Risk: {{.task_name}}",
		BodyTemplate:  "Workflow task {{.task_name}} is at risk of breaching its SLA. Please act before the deadline.",
		ActionURLTmpl: "/workflow/tasks/{{.task_id}}",
	})
	// OOO deputy reassignment — notify the DEPUTY that a task was auto-routed to
	// them while the original assignee is out of office. Previously the executor
	// emitted workflow.task.reassigned_ooo but NO notification rule consumed it, so
	// the deputy was never told. Routed direct to the deputy (and, best-effort, the
	// initiator). Additive: a NEW EventType key.
	re.addRule(&NotificationRule{
		Topic:         events.Topics.WorkflowEvents,
		EventType:     "com.clario360.workflow.task.reassigned_ooo",
		NotifType:     model.NotifTaskReassigned,
		Category:      model.CategoryWorkflow,
		Priority:      model.PriorityMedium,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientDirect,
		DirectFields:  []string{"deputy_assignee"},
		TitleTemplate: "Task Reassigned to You",
		BodyTemplate:  "A workflow task was reassigned to you because the original assignee is out of office.",
		ActionURLTmpl: "/workflow/tasks/{{.task_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.WorkflowEvents,
		EventType:     "com.clario360.workflow.instance.failed",
		NotifType:     model.NotifWorkflowFailed,
		Category:      model.CategoryWorkflow,
		Priority:      model.PriorityHigh,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientDirect,
		DirectFields:  []string{"initiator_id"},
		TitleTemplate: "Workflow Failed",
		BodyTemplate:  "Workflow instance {{.instance_id}} failed. {{.error}}",
		ActionURLTmpl: "/workflow/instances/{{.instance_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.WorkflowEvents,
		EventType:     "com.clario360.workflow.instance.completed",
		NotifType:     model.NotifWorkflowCompleted,
		Category:      model.CategoryWorkflow,
		Priority:      model.PriorityMedium,
		Channels:      []string{"in_app"},
		RecipientMode: RecipientDirect,
		DirectFields:  []string{"initiator_id"},
		TitleTemplate: "Workflow Completed",
		BodyTemplate:  "Workflow instance {{.instance_id}} completed successfully.",
		ActionURLTmpl: "/workflow/instances/{{.instance_id}}",
	})

	re.addRule(&NotificationRule{
		Topic:         events.Topics.IAMEvents,
		EventType:     "com.clario360.iam.user.registered",
		NotifType:     model.NotifWelcome,
		Category:      model.CategorySystem,
		Priority:      model.PriorityMedium,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientDirect,
		DirectFields:  []string{"user_id"},
		TitleTemplate: "Welcome to Clario 360",
		BodyTemplate:  "Your account has been created successfully.",
		ActionURLTmpl: "/",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.FileEvents,
		EventType:     "com.clario360.file.scan.infected",
		NotifType:     model.NotifMalwareDetected,
		Category:      model.CategorySecurity,
		Priority:      model.PriorityCritical,
		Channels:      []string{"email", "in_app", "push"},
		RecipientMode: RecipientMixed,
		Roles:         []string{"tenant-admin"},
		DirectFields:  []string{"uploaded_by"},
		TitleTemplate: "Malware Detected in Uploaded File",
		BodyTemplate:  "Uploaded file {{.file_id}} was flagged as infected with {{.virus_name}}.",
		ActionURLTmpl: "/files/quarantine",
	})

	re.addRule(&NotificationRule{
		Topic:         events.Topics.NotificationEvents,
		EventType:     "com.clario360.platform.system.maintenance",
		NotifType:     model.NotifSystemMaintenance,
		Category:      model.CategorySystem,
		Priority:      model.PriorityLow,
		Channels:      []string{"in_app"},
		RecipientMode: RecipientTenantBroadcast,
		TitleTemplate: "Scheduled Maintenance: {{.title}}",
		BodyTemplate:  "{{.description}}",
	})

	// Clario Migrate (Wave 5, H1) — migration program lifecycle notifications.
	// These consume the migrate.events topic staged transactionally by the migrate
	// service through the SHARED outbox; they route wave/cutover/rollback/gate
	// transitions to the migration roles. Additive: each is a NEW EventType key, so
	// no existing rule changes behaviour. The FE filters on data.event_type /
	// data.program_id / data.window_id.
	re.addRule(&NotificationRule{
		Topic:         events.Topics.MigrateEvents,
		EventType:     "com.clario360.migrate.move_group.submitted",
		NotifType:     model.NotifMoveGroupApprovalNeeded,
		Category:      model.CategoryMigration,
		Priority:      model.PriorityHigh,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"migrate-approver"},
		TitleTemplate: "Move Group Awaiting Approval: {{.reference}}",
		BodyTemplate:  "Move group {{.name}} ({{.reference}}) was submitted for approval.",
		ActionURLTmpl: "/migrate/move-groups/{{.move_group_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.MigrateEvents,
		EventType:     "com.clario360.migrate.move_group.decided",
		NotifType:     model.NotifMoveGroupDecided,
		Category:      model.CategoryMigration,
		Priority:      model.PriorityMedium,
		Channels:      []string{"in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"migrate-manager", "migrate-executor"},
		TitleTemplate: "Move Group Decision: {{.reference}}",
		BodyTemplate:  "A decision was recorded on move group {{.name}} ({{.reference}}).",
		ActionURLTmpl: "/migrate/move-groups/{{.move_group_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.MigrateEvents,
		EventType:     "com.clario360.migrate.gate.decided",
		NotifType:     model.NotifGateDecided,
		Category:      model.CategoryMigration,
		Priority:      model.PriorityHigh,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"migrate-executor", "migrate-manager"},
		TitleTemplate: "Cutover Go/No-Go Decided: {{.reference}}",
		BodyTemplate:  "A {{.decision}} decision was recorded for cutover window {{.reference}}.",
		ActionURLTmpl: "/migrate/windows/{{.window_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.MigrateEvents,
		EventType:     "com.clario360.migrate.cutover.started",
		NotifType:     model.NotifCutoverStarted,
		Category:      model.CategoryMigration,
		Priority:      model.PriorityCritical,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"migrate-executor", "migrate-manager"},
		TitleTemplate: "Cutover Started: {{.reference}}",
		BodyTemplate:  "Cutover has started for window {{.reference}}.",
		ActionURLTmpl: "/migrate/windows/{{.window_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.MigrateEvents,
		EventType:     "com.clario360.migrate.cutover.completed",
		NotifType:     model.NotifCutoverCompleted,
		Category:      model.CategoryMigration,
		Priority:      model.PriorityHigh,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"migrate-executor", "migrate-manager"},
		TitleTemplate: "Cutover Completed: {{.reference}}",
		BodyTemplate:  "Cutover completed and workloads are live for window {{.reference}}.",
		ActionURLTmpl: "/migrate/windows/{{.window_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.MigrateEvents,
		EventType:     "com.clario360.migrate.cutover.failed",
		NotifType:     model.NotifCutoverFailed,
		Category:      model.CategoryMigration,
		Priority:      model.PriorityCritical,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"migrate-executor", "migrate-manager"},
		TitleTemplate: "Cutover Failed: {{.reference}}",
		BodyTemplate:  "Cutover run failed for window {{.reference}} (status {{.run_status}}).",
		ActionURLTmpl: "/migrate/windows/{{.window_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.MigrateEvents,
		EventType:     "com.clario360.migrate.rollback.initiated",
		NotifType:     model.NotifRollbackInitiated,
		Category:      model.CategoryMigration,
		Priority:      model.PriorityCritical,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"migrate-executor", "migrate-manager"},
		TitleTemplate: "Rollback Initiated: {{.reference}}",
		BodyTemplate:  "A rollback was initiated for window {{.reference}}. Reason: {{.reason}}",
		ActionURLTmpl: "/migrate/windows/{{.window_id}}",
	})
	re.addRule(&NotificationRule{
		Topic:         events.Topics.MigrateEvents,
		EventType:     "com.clario360.migrate.rollback.completed",
		NotifType:     model.NotifRollbackCompleted,
		Category:      model.CategoryMigration,
		Priority:      model.PriorityHigh,
		Channels:      []string{"email", "in_app"},
		RecipientMode: RecipientRoleBased,
		Roles:         []string{"migrate-executor", "migrate-manager"},
		TitleTemplate: "Rollback Completed: {{.reference}}",
		BodyTemplate:  "Rollback completed for window {{.reference}}; workloads rolled back.",
		ActionURLTmpl: "/migrate/windows/{{.window_id}}",
	})

	return re
}

func (re *RuleEngine) addRule(rule *NotificationRule) {
	re.rules[rule.EventType] = append(re.rules[rule.EventType], rule)
}

// Match returns all rules that match the given event.
func (re *RuleEngine) Match(event *events.Event) []MatchedRule {
	var data map[string]interface{}
	if len(event.Data) > 0 {
		if err := json.Unmarshal(event.Data, &data); err != nil {
			return nil
		}
	}
	return re.MatchData(event, data)
}

// MatchData returns all rules that match the given event using a pre-decoded payload.
func (re *RuleEngine) MatchData(event *events.Event, data map[string]interface{}) []MatchedRule {
	rules, ok := re.rules[event.Type]
	if !ok {
		return nil
	}
	if data == nil {
		data = make(map[string]interface{})
	}

	enriched := cloneMap(data)
	enriched["_event_id"] = event.ID
	enriched["_tenant_id"] = event.TenantID
	enriched["_user_id"] = event.UserID
	enriched["_source"] = event.Source
	enriched["_correlation_id"] = event.CorrelationID
	// Stable, FE-facing routing keys (additive, applied to every matched event so
	// no existing rule changes behaviour): the raw CloudEvent type and the actor
	// (event user) id. These let a subscriber filter the WS payload to a specific
	// domain event / resolve the actor's display name. Existing payload keys win on
	// collision (set only when absent).
	if _, ok := enriched["event_type"]; !ok {
		enriched["event_type"] = event.Type
	}
	if _, ok := enriched["actor_id"]; !ok {
		enriched["actor_id"] = event.UserID
	}

	var matched []MatchedRule
	for _, rule := range rules {
		if rule.Condition != nil && !rule.Condition(enriched) {
			continue
		}
		matched = append(matched, MatchedRule{Rule: rule, Data: cloneMap(enriched)})
	}
	return matched
}

// ResolvePriority returns the priority for a matched rule.
func ResolvePriority(rule *NotificationRule, data map[string]interface{}) string {
	if rule.PriorityFunc != nil {
		return rule.PriorityFunc(data)
	}
	return rule.Priority
}

// ResolveRoles returns the IAM roles for recipient resolution.
func ResolveRoles(rule *NotificationRule, data map[string]interface{}) []string {
	roles := append([]string(nil), rule.Roles...)
	if rule.RoleField != "" {
		if roleStr, ok := data[rule.RoleField].(string); ok && strings.TrimSpace(roleStr) != "" {
			roles = append(roles, roleStr)
		}
	}
	return uniqueStrings(roles)
}

// ResolveDirectUserIDs extracts user IDs from event data for direct recipient mode.
func ResolveDirectUserIDs(rule *NotificationRule, data map[string]interface{}) []string {
	if len(rule.DirectFields) == 0 {
		return nil
	}

	var userIDs []string
	for _, field := range rule.DirectFields {
		val, ok := data[field]
		if !ok {
			continue
		}

		switch typed := val.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				userIDs = append(userIDs, typed)
			}
		case []string:
			userIDs = append(userIDs, typed...)
		case []interface{}:
			for _, item := range typed {
				if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
					userIDs = append(userIDs, s)
				}
			}
		}
	}
	return uniqueStrings(userIDs)
}

// ExtractEventTopics returns all Kafka topics the notification consumer should subscribe to.
func ExtractEventTopics() []string {
	re := NewRuleEngine()
	seen := make(map[string]struct{})
	topics := make([]string, 0, len(re.rules))

	for _, rules := range re.rules {
		for _, rule := range rules {
			if rule.Topic == "" {
				continue
			}
			if _, ok := seen[rule.Topic]; ok {
				continue
			}
			seen[rule.Topic] = struct{}{}
			topics = append(topics, rule.Topic)
		}
	}

	return topics
}

func cloneMap(source map[string]interface{}) map[string]interface{} {
	if source == nil {
		return map[string]interface{}{}
	}
	cloned := make(map[string]interface{}, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func stringValue(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return strings.ToLower(strings.TrimSpace(typed))
	default:
		return ""
	}
}

func floatValue(value interface{}) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case int32:
		return float64(typed)
	default:
		return 0
	}
}
