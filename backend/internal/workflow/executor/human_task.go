package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/expression"
	"github.com/clario360/platform/internal/workflow/model"
)

// TaskCreator is a narrow interface for creating human task records, avoiding
// a circular dependency with the full task repository.
type TaskCreator interface {
	Create(ctx context.Context, task *model.HumanTask) error
}

// ResolvedForm is the by-ref form schema a FormLoader returns: the inline-shape
// []model.FormField the task carries (bilingual labels already localized), plus
// the form definition's stable id and version so the completion path can re-load
// and re-validate the submission against the SAME definition (WP-3, DESIGN §3.2,
// "never trust the client — re-validate on submit"). Keeping this in the executor
// package (rather than importing internal/forms here) keeps the executor free of
// a forms dependency and lets the loader live in main.go where the DB pool is.
type ResolvedForm struct {
	// Fields is the legacy inline schema the HumanTask.FormSchema column stores,
	// derived from the forms.FormDefinition with each bilingual label localized.
	Fields []model.FormField
	// FormID is the resolved form definition id (for completion re-validation).
	FormID string
	// FormVersion is the resolved form definition version.
	FormVersion int
}

// FormLoader resolves a Config form reference (id / name) to a ResolvedForm. It
// is the seam the INTEGRATE phase wires to internal/forms via main.go; when no
// loader is set the executor keeps the legacy inline form_fields path unchanged.
// locale selects which side of each bilingual label to render; "" defaults to en.
type FormLoader interface {
	// LoadFormByID resolves a form by its id.
	LoadFormByID(ctx context.Context, tenantID, formID, locale string) (*ResolvedForm, error)
	// LoadFormByName resolves the latest version of a form by name.
	LoadFormByName(ctx context.Context, tenantID, name, locale string) (*ResolvedForm, error)
}

// SubstitutionResolver is the OPTIONAL out-of-office / substitute seam the
// human-task assignment/create path consults. Given the user a task WOULD be
// assigned to, it returns the effective assignee after applying any active
// deputy substitution (walking a bounded, loop-detected deputy chain). It is
// discovered via SetSubstitutionResolver; when unset the executor assigns tasks
// exactly as before — a user with no active OOO window (and every deployment
// that never wires a resolver) is completely unaffected. The concrete
// implementation is service.SubstitutionService.
//
// The return shape is intentionally minimal (an interface method returning a
// small value type declared here) so the executor package takes NO dependency on
// the service package — mirroring the FormLoader / EventPublisher seams.
type SubstitutionResolver interface {
	// ResolveAssignee returns the effective assignee for a task that would be
	// assigned to userID, and whether a substitution was applied plus the ordered
	// hand-off chain for the audit trail. It must be fail-open (never error): a
	// registry problem returns the original user, never blocking task creation.
	ResolveAssignee(ctx context.Context, tenantID, userID string) SubstitutionOutcome
}

// SubstitutionOutcome is the executor-side view of a substitution resolution. It
// is structurally compatible with service.SubstitutionDecision so the service
// can be adapted with a trivial shim; keeping the type here avoids an import
// cycle (executor must not import service).
type SubstitutionOutcome struct {
	// Assignee is the effective assignee after applying any active substitution.
	Assignee string
	// Substituted reports whether at least one hand-off was applied.
	Substituted bool
	// Chain is the ordered list of hops taken (from out-of-office user -> deputy).
	Chain []SubstitutionHop
	// Truncated is true when the deputy chain hit the depth limit.
	Truncated bool
}

// SubstitutionHop is one resolved hand-off in a deputy chain (audit payload).
type SubstitutionHop struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Reason string `json:"reason,omitempty"`
}

// HumanTaskExecutor creates a human task record and parks the workflow until
// a human completes the task. The task includes a form schema, assignee
// information, SLA deadline, and priority derived from the workflow context.
type HumanTaskExecutor struct {
	taskRepo    TaskCreator
	producer    EventPublisher
	formLoader  FormLoader
	substitutes SubstitutionResolver
	resolver    *expression.VariableResolver
	logger      zerolog.Logger
}

// NewHumanTaskExecutor creates a HumanTaskExecutor. The form loader is optional
// and set separately via SetFormLoader so this constructor's signature (and its
// existing callers/tests) stays unchanged.
func NewHumanTaskExecutor(taskRepo TaskCreator, producer EventPublisher, logger zerolog.Logger) *HumanTaskExecutor {
	return &HumanTaskExecutor{
		taskRepo: taskRepo,
		producer: producer,
		resolver: expression.NewVariableResolver(),
		logger:   logger.With().Str("executor", "human_task").Logger(),
	}
}

// SetFormLoader installs the optional by-ref form loader (WP-3). When set, a step
// whose Config names a form ref (form_id / form_name) loads its schema from the
// forms store; when unset, or when a step carries no ref, the legacy inline
// form_fields path is used unchanged.
func (e *HumanTaskExecutor) SetFormLoader(loader FormLoader) {
	e.formLoader = loader
}

// SetSubstitutionResolver installs the optional out-of-office / substitute
// resolver. When set, a task that WOULD be assigned to a specific user is
// re-routed to that user's active deputy (walking a bounded, loop-detected
// chain) during their OOO window, and a workflow.task.reassigned_ooo audit event
// is emitted. When unset, assignment is unchanged (legacy behaviour).
func (e *HumanTaskExecutor) SetSubstitutionResolver(r SubstitutionResolver) {
	e.substitutes = r
}

// Config keys that name a by-ref form definition (WP-3). form_id pins a specific
// version; form_name resolves the latest version of a logical form.
const (
	configFormID     = "form_id"
	configFormName   = "form_name"
	configFormLocale = "form_locale"
)

// Metadata keys stamped on a task created from a form ref so the completion path
// can re-load and re-validate the submission against the same definition.
const (
	metaFormID      = "form_id"
	metaFormVersion = "form_version"
	metaFormLocale  = "form_locale"
)

// Metadata keys stamped on a task that was re-routed to a deputy by the
// out-of-office / substitute engine, so the hand-off is durably recorded on the
// task in addition to the tamper-evident audit event.
const (
	metaOOOReassigned       = "ooo_reassigned"
	metaOOOOriginalAssignee = "ooo_original_assignee"
	metaOOOChain            = "ooo_chain"
	metaOOOTruncated        = "ooo_chain_truncated"
)

// OriginalOrFirst returns the user the task was originally intended for (the head
// of the deputy chain). It prefers the recorded chain's first hop's From, which
// is always the out-of-office user the resolver started from.
func (o *SubstitutionOutcome) OriginalOrFirst() string {
	if o != nil && len(o.Chain) > 0 {
		return o.Chain[0].From
	}
	return ""
}

// Execute creates a human task from the step configuration and parks the workflow.
//
// Expected step.Config keys:
//   - form_fields ([]interface{}, required): form field definitions
//   - assignee (string, optional): user ID or ${...} variable reference
//   - assignee_role (string, optional): role name for group assignment
//   - sla_hours (float64, optional): hours until SLA deadline, default 24
//   - escalation_role (string, optional): role to escalate to on SLA breach
//   - description (string, optional): task description
func (e *HumanTaskExecutor) Execute(ctx context.Context, instance *model.WorkflowInstance, step *model.StepDefinition, exec *model.StepExecution) (*ExecutionResult, error) {
	dataCtx := buildDataContext(instance)

	// Resolve the form schema. When the step Config names a by-ref form
	// (form_id / form_name) AND a loader is installed, load the canonical
	// forms.FormDefinition and project its bilingual fields into the inline
	// FormSchema shape; stash the resolved (id, version) so completion can
	// re-validate against the same definition. Otherwise fall back to the
	// UNCHANGED inline form_fields path.
	formSchema, resolved, err := e.resolveFormSchema(ctx, instance.TenantID, step.Config)
	if err != nil {
		return nil, fmt.Errorf("human_task %s: %w", step.ID, err)
	}

	// Resolve assignee: may be a ${...} variable reference.
	var assigneeID *string
	if assigneeRaw := configStringOptional(step.Config, "assignee"); assigneeRaw != "" {
		if strings.Contains(assigneeRaw, "${") {
			resolved, err := e.resolver.Resolve(assigneeRaw, dataCtx)
			if err != nil {
				return nil, fmt.Errorf("human_task %s: resolving assignee: %w", step.ID, err)
			}
			s := fmt.Sprintf("%v", resolved)
			assigneeID = &s
		} else {
			assigneeID = &assigneeRaw
		}
	}

	// OUT-OF-OFFICE / SUBSTITUTE hand-off: when the task is assigned to a SPECIFIC
	// user and a substitution resolver is wired, consult the OOO registry. If that
	// user is out of office in the current window, the task is re-routed to their
	// active deputy (following a bounded, loop-detected deputy chain). A user with
	// no active window resolves to themselves (fast-path no-op) so non-OOO users
	// and every deployment without a resolver are unaffected. Role-only tasks (no
	// specific assignee) are left to the claim path and are not re-routed here.
	var oooOutcome *SubstitutionOutcome
	if e.substitutes != nil && assigneeID != nil && *assigneeID != "" {
		outcome := e.substitutes.ResolveAssignee(ctx, instance.TenantID, *assigneeID)
		if outcome.Substituted && outcome.Assignee != "" && outcome.Assignee != *assigneeID {
			deputy := outcome.Assignee
			assigneeID = &deputy
			oooOutcome = &outcome
		}
	}

	// Resolve assignee role.
	var assigneeRole *string
	if role := configStringOptional(step.Config, "assignee_role"); role != "" {
		assigneeRole = &role
	}

	// Resolve candidate groups / candidate users (candidate-group / work-queue
	// assignment). These are ADDITIVE to the single assignee/role above: a step
	// that names neither yields empty pools and behaves exactly as before. Each
	// element may be a literal or a ${...} variable reference (resolved against the
	// instance data context, mirroring the single-assignee path).
	candidateGroups := e.resolveStringSlice(step.Config, "candidate_groups", dataCtx)
	candidateUsers := e.resolveStringSlice(step.Config, "candidate_users", dataCtx)

	// Parse SLA hours (default 24h).
	slaHours := 24.0
	if v, ok := step.Config["sla_hours"]; ok {
		if h := toFloat(v); h > 0 {
			slaHours = h
		}
	}
	slaDeadline := time.Now().UTC().Add(time.Duration(slaHours * float64(time.Hour)))

	// Resolve escalation role.
	var escalationRole *string
	if role := configStringOptional(step.Config, "escalation_role"); role != "" {
		escalationRole = &role
	}

	// Determine priority from instance variables.
	priority := determinePriority(instance.Variables)

	// Resolve task description.
	description := step.Name
	if desc := configStringOptional(step.Config, "description"); desc != "" {
		resolved, err := e.resolver.Resolve(desc, dataCtx)
		if err == nil {
			description = fmt.Sprintf("%v", resolved)
		}
	}

	// Build metadata for the task.
	metadata := map[string]interface{}{
		"workflow_instance_id": instance.ID,
		"workflow_definition":  instance.DefinitionID,
		"definition_version":   instance.DefinitionVer,
		"step_id":              step.ID,
		"step_execution_id":    exec.ID,
	}
	// Stamp the form ref so CompleteTask can re-validate the submission against
	// the same canonical form definition (WP-3). Only present on by-ref tasks.
	if resolved != nil {
		metadata[metaFormID] = resolved.FormID
		metadata[metaFormVersion] = resolved.FormVersion
		if loc := configStringOptional(step.Config, configFormLocale); loc != "" {
			metadata[metaFormLocale] = loc
		}
	}
	// Stamp the OOO hand-off on the task so the substitution is durably recorded on
	// the task itself (in addition to the audit event): who it was originally for
	// and the full deputy chain that was followed. Both the typed delegated_by
	// column AND the metadata are set so the durability claim holds through
	// persistence (the repository INSERT writes the typed columns).
	now := time.Now().UTC()
	var (
		delegatedBy *string
		delegatedAt *time.Time
	)
	if oooOutcome != nil {
		original := oooOutcome.OriginalOrFirst()
		metadata[metaOOOReassigned] = true
		metadata[metaOOOOriginalAssignee] = original
		metadata[metaOOOChain] = oooOutcome.Chain
		if oooOutcome.Truncated {
			metadata[metaOOOTruncated] = true
		}
		delegatedBy = &original
		at := now
		delegatedAt = &at
	}

	task := &model.HumanTask{
		ID:              events.GenerateUUID(),
		TenantID:        instance.TenantID,
		InstanceID:      instance.ID,
		StepID:          step.ID,
		StepExecID:      exec.ID,
		Name:            step.Name,
		Description:     description,
		Status:          model.TaskStatusPending,
		AssigneeID:      assigneeID,
		AssigneeRole:    assigneeRole,
		CandidateGroups: candidateGroups,
		CandidateUsers:  candidateUsers,
		FormSchema:      formSchema,
		FormData:        make(map[string]interface{}),
		SLADeadline:     &slaDeadline,
		EscalationRole:  escalationRole,
		Priority:        priority,
		Metadata:        metadata,
		DelegatedBy:     delegatedBy,
		DelegatedAt:     delegatedAt,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := e.taskRepo.Create(ctx, task); err != nil {
		return nil, fmt.Errorf("human_task %s: creating task: %w", step.ID, err)
	}

	e.logger.Info().
		Str("task_id", task.ID).
		Str("step_id", step.ID).
		Str("instance_id", instance.ID).
		Int("priority", priority).
		Time("sla_deadline", slaDeadline).
		Msg("human task created, parking workflow")

	e.publishTaskCreated(ctx, instance, task)
	// Emit the tamper-evident OOO reassignment event AFTER the task is persisted,
	// so the substitution is on the audit trail only for tasks that actually exist.
	if oooOutcome != nil {
		e.publishReassignedOOO(ctx, instance, task, oooOutcome)
	}

	return &ExecutionResult{
		Output: map[string]interface{}{
			"task_id":      task.ID,
			"sla_deadline": slaDeadline.Format(time.RFC3339),
			"priority":     priority,
		},
		Parked: true,
	}, nil
}

// publishReassignedOOO emits the workflow.task.reassigned_ooo audit event to the
// workflow events topic (where the platform hash-chain audit subsystem records it
// as a tamper-evident entry), capturing the original assignee, the effective
// deputy, and the full hand-off chain. Best-effort: a publish failure is logged
// but never fails the step (the task is already persisted and re-routed).
func (e *HumanTaskExecutor) publishReassignedOOO(ctx context.Context, instance *model.WorkflowInstance, task *model.HumanTask, outcome *SubstitutionOutcome) {
	if e.producer == nil || outcome == nil {
		return
	}
	payload := map[string]interface{}{
		"task_id":           task.ID,
		"instance_id":       task.InstanceID,
		"step_id":           task.StepID,
		"original_assignee": outcome.OriginalOrFirst(),
		"deputy_assignee":   outcome.Assignee,
		"chain":             outcome.Chain,
		"chain_truncated":   outcome.Truncated,
	}
	if instance.StartedBy != nil {
		payload["initiator_id"] = *instance.StartedBy
	}
	evt, err := events.NewEvent("workflow.task.reassigned_ooo", "workflow-engine", task.TenantID, payload)
	if err != nil {
		e.logger.Warn().Err(err).Str("task_id", task.ID).Msg("failed to build ooo reassignment event")
		return
	}
	if err := e.producer.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		e.logger.Warn().Err(err).Str("task_id", task.ID).Msg("failed to publish ooo reassignment event")
		return
	}
	e.logger.Info().
		Str("task_id", task.ID).
		Str("original_assignee", outcome.OriginalOrFirst()).
		Str("deputy_assignee", outcome.Assignee).
		Int("chain_hops", len(outcome.Chain)).
		Bool("truncated", outcome.Truncated).
		Msg("human task reassigned to deputy (out-of-office)")
}

func (e *HumanTaskExecutor) publishTaskCreated(ctx context.Context, instance *model.WorkflowInstance, task *model.HumanTask) {
	if e.producer == nil {
		return
	}

	payload := map[string]interface{}{
		"task_id":      task.ID,
		"instance_id":  task.InstanceID,
		"step_id":      task.StepID,
		"task_name":    task.Name,
		"priority":     task.Priority,
		"sla_deadline": task.SLADeadline,
	}
	if task.AssigneeID != nil {
		payload["assignee_id"] = *task.AssigneeID
	}
	if task.AssigneeRole != nil {
		payload["assignee_role"] = *task.AssigneeRole
	}
	if len(task.CandidateGroups) > 0 {
		payload["candidate_groups"] = task.CandidateGroups
	}
	if len(task.CandidateUsers) > 0 {
		payload["candidate_users"] = task.CandidateUsers
	}
	if task.EscalationRole != nil {
		payload["escalation_role"] = *task.EscalationRole
	}
	if instance.StartedBy != nil {
		payload["initiator_id"] = *instance.StartedBy
	}

	evt, err := events.NewEvent("workflow.task.created", "workflow-engine", task.TenantID, payload)
	if err != nil {
		e.logger.Warn().Err(err).Str("task_id", task.ID).Msg("failed to build workflow task created event")
		return
	}
	if err := e.producer.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		e.logger.Warn().Err(err).Str("task_id", task.ID).Msg("failed to publish workflow task created event")
	}
}

// resolveFormSchema returns the task's form schema and, when the schema came
// from a by-ref form definition, the ResolvedForm (id/version) for completion
// re-validation. It selects the by-ref path only when a loader is installed AND
// the Config names a form ref; otherwise it returns the legacy inline schema and
// a nil ResolvedForm — preserving the existing behavior (and the missing
// form_fields error) for every step that does not opt into a ref.
func (e *HumanTaskExecutor) resolveFormSchema(ctx context.Context, tenantID string, config map[string]interface{}) ([]model.FormField, *ResolvedForm, error) {
	formID := configStringOptional(config, configFormID)
	formName := configStringOptional(config, configFormName)
	if e.formLoader == nil || (formID == "" && formName == "") {
		fields, err := e.buildFormSchema(config)
		return fields, nil, err
	}

	locale := configStringOptional(config, configFormLocale)
	var (
		resolved *ResolvedForm
		err      error
	)
	if formID != "" {
		resolved, err = e.formLoader.LoadFormByID(ctx, tenantID, formID, locale)
	} else {
		resolved, err = e.formLoader.LoadFormByName(ctx, tenantID, formName, locale)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("loading referenced form: %w", err)
	}
	if resolved == nil {
		return nil, nil, fmt.Errorf("form loader returned no form for ref")
	}
	return resolved.Fields, resolved, nil
}

// resolveStringSlice reads a config key holding a list of strings (the JSON
// shape is []interface{}; a []string is also accepted) and returns the resolved
// values. Each element may be a literal group/role or user id, or a ${...}
// variable reference resolved against dataCtx (mirroring the single-assignee
// resolution). A missing key, an empty list, or a non-list value yields nil so
// the candidate pool stays empty and the task behaves as a legacy single-
// assignee / single-role task. Blank / unresolved elements are dropped.
func (e *HumanTaskExecutor) resolveStringSlice(config map[string]interface{}, key string, dataCtx map[string]interface{}) []string {
	raw, ok := config[key]
	if !ok || raw == nil {
		return nil
	}

	var items []interface{}
	switch v := raw.(type) {
	case []interface{}:
		items = v
	case []string:
		items = make([]interface{}, len(v))
		for i, s := range v {
			items[i] = s
		}
	default:
		return nil
	}

	out := make([]string, 0, len(items))
	for _, it := range items {
		s, ok := it.(string)
		if !ok {
			s = fmt.Sprintf("%v", it)
		}
		if strings.Contains(s, "${") {
			if resolved, err := e.resolver.Resolve(s, dataCtx); err == nil {
				s = fmt.Sprintf("%v", resolved)
			}
		}
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// buildFormSchema converts the "form_fields" config into a []model.FormField slice.
func (e *HumanTaskExecutor) buildFormSchema(config map[string]interface{}) ([]model.FormField, error) {
	fieldsRaw, ok := config["form_fields"]
	if !ok {
		return nil, fmt.Errorf("missing required config key %q", "form_fields")
	}

	fieldsSlice, ok := fieldsRaw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("config key %q must be an array", "form_fields")
	}

	fields := make([]model.FormField, 0, len(fieldsSlice))
	for i, raw := range fieldsSlice {
		fieldMap, ok := raw.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("form_fields[%d] must be an object", i)
		}

		field := model.FormField{}

		if name, ok := fieldMap["name"].(string); ok {
			field.Name = name
		} else {
			return nil, fmt.Errorf("form_fields[%d]: missing or invalid 'name'", i)
		}

		if typ, ok := fieldMap["type"].(string); ok {
			field.Type = typ
		} else {
			return nil, fmt.Errorf("form_fields[%d]: missing or invalid 'type'", i)
		}

		if label, ok := fieldMap["label"].(string); ok {
			field.Label = label
		} else {
			field.Label = field.Name
		}

		if req, ok := fieldMap["required"].(bool); ok {
			field.Required = req
		}

		if opts, ok := fieldMap["options"].([]interface{}); ok {
			for _, o := range opts {
				if s, ok := o.(string); ok {
					field.Options = append(field.Options, s)
				}
			}
		}

		if def, ok := fieldMap["default"]; ok {
			field.Default = def
		}

		if vw, ok := fieldMap["visible_when"].(string); ok {
			field.VisibleWhen = vw
		}

		fields = append(fields, field)
	}

	return fields, nil
}

// determinePriority returns a numeric priority based on the workflow's severity variable.
// critical -> 2, high -> 1, everything else -> 0
func determinePriority(variables map[string]interface{}) int {
	if variables == nil {
		return 0
	}

	severity, ok := variables["severity"]
	if !ok {
		return 0
	}

	// Handle both direct string and JSON-decoded values.
	var sevStr string
	switch v := severity.(type) {
	case string:
		sevStr = strings.ToLower(v)
	case json.Number:
		sevStr = v.String()
	default:
		sevStr = fmt.Sprintf("%v", v)
		sevStr = strings.ToLower(sevStr)
	}

	switch sevStr {
	case "critical":
		return 2
	case "high":
		return 1
	default:
		return 0
	}
}
