package executor

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/expression"
	"github.com/clario360/platform/internal/workflow/model"
)

// WP-5 — approval chains (Design §3.4).
//
// ApprovalChainExecutor implements StepExecutor for a new step type
// "approval_chain". Its Config declares an ordered or parallel list of approvers
// (user or role), a quorum rule (all | any | n_of_m), an execution mode
// (sequential | parallel), and a per-approver SLA. On Execute it parks the
// workflow (Parked: true) after creating HumanTask records:
//   - parallel: one task per approver up front, so a parallel branch can contain
//     parking tasks (this fixes the seed limitation called out in §3.4);
//   - sequential: only the first approver's task, the next being created on
//     resume.
//
// The resume side is the pure ResolveApproval function: given the recorded
// approver decisions it computes whether the quorum is met (advance), someone
// rejected such that the quorum can no longer be met (reject), or more decisions
// are still needed (wait). The INTEGRATE phase wires ResolveApproval into the
// engine's task-completion path and registers this executor; this file is
// self-contained and side-effect-free beyond task creation + event publishing.

// Approval step type identifier (registered into the ExecutorRegistry by the
// INTEGRATE phase).
const StepTypeApprovalChain = "approval_chain"

// Approval mode constants.
const (
	// ApprovalModeSequential creates one approver task at a time, in order.
	ApprovalModeSequential = "sequential"
	// ApprovalModeParallel creates all pending approver tasks up front.
	ApprovalModeParallel = "parallel"
)

// Quorum rule constants.
const (
	// QuorumAll requires every approver to approve.
	QuorumAll = "all"
	// QuorumAny requires a single approval.
	QuorumAny = "any"
	// QuorumNofM requires N approvals out of the M approvers.
	QuorumNofM = "n_of_m"
)

// Approver identifies a single approver in a chain: either a specific user or a
// role (anyone holding the role may act). Exactly one of Type's interpretations
// applies. Ref is a ${...}-resolvable expression for user refs.
type Approver struct {
	// Type is "user" or "role".
	Type string `json:"type"`
	// Ref is the user id / variable reference (for user) or the role name (for
	// role).
	Ref string `json:"ref"`
}

// IsRole reports whether the approver is a role assignment.
func (a Approver) IsRole() bool { return strings.EqualFold(a.Type, "role") }

// IsUser reports whether the approver is a specific-user assignment.
func (a Approver) IsUser() bool { return strings.EqualFold(a.Type, "user") }

// ApprovalConfig is the parsed, validated configuration of an approval_chain
// step.
type ApprovalConfig struct {
	Approvers []Approver
	Mode      string        // sequential | parallel
	Quorum    string        // all | any | n_of_m
	QuorumN   int           // required count when Quorum == n_of_m
	SLA       time.Duration // per-approver SLA; 0 means no deadline
	// RequireDistinctApprovers, when true, enforces separation of duties across
	// the chain: no single actor may decide more than one step/tier of the same
	// chain instance. Defaults false so existing approval flows (Cyber, Acta,
	// Automation, Onboarding) are byte-for-byte unchanged; the Lex legal suite
	// opts in (config key "require_distinct_approvers": true).
	RequireDistinctApprovers bool
}

// ApproverDecision is a recorded decision for one approver task, fed to
// ResolveApproval.
type ApproverDecision struct {
	// Approver identifies who the task was assigned to.
	Approver Approver
	// Decision is "approve", "reject", or "" (pending / not yet decided).
	Decision string
	// DecidedBy is the user id that recorded the decision (for roles, the actual
	// actor). Optional.
	DecidedBy string
	// DecidedAt is when the decision was recorded. Optional.
	DecidedAt time.Time
}

// Decision verb constants.
const (
	DecisionApprove = "approve"
	DecisionReject  = "reject"
)

// Resolution is the outcome of ResolveApproval.
type Resolution string

const (
	// ResolutionAdvance means the quorum is satisfied; the workflow may proceed.
	ResolutionAdvance Resolution = "advance"
	// ResolutionReject means the quorum can no longer be met (or a hard reject
	// occurred); the workflow should take its reject path.
	ResolutionReject Resolution = "reject"
	// ResolutionWait means more decisions are required before resolving.
	ResolutionWait Resolution = "wait"
)

// ApprovalChainExecutor creates approver HumanTasks and parks the workflow.
type ApprovalChainExecutor struct {
	taskRepo TaskCreator
	producer EventPublisher
	resolver *expression.VariableResolver
	logger   zerolog.Logger
}

// NewApprovalChainExecutor constructs an ApprovalChainExecutor. It mirrors
// NewHumanTaskExecutor's dependencies so the INTEGRATE phase can register it
// alongside the human-task executor.
func NewApprovalChainExecutor(taskRepo TaskCreator, producer EventPublisher, logger zerolog.Logger) *ApprovalChainExecutor {
	return &ApprovalChainExecutor{
		taskRepo: taskRepo,
		producer: producer,
		resolver: expression.NewVariableResolver(),
		logger:   logger.With().Str("executor", "approval_chain").Logger(),
	}
}

// Execute parses the approval config, creates the pending approver task(s)
// (all of them for parallel mode, only the first for sequential), publishes a
// workflow.task.created event for each, and parks the workflow.
//
// Expected step.Config keys:
//   - approvers ([]{type,ref}, required): the ordered approver list
//   - mode (string, optional): "sequential" (default) | "parallel"
//   - quorum (string, optional): "all" (default) | "any" | "n_of_m"
//   - quorum_n (number, required when quorum == n_of_m): the N in N-of-M
//   - sla_hours (number, optional): per-approver SLA hours
//   - description (string, optional): task description, ${...}-resolvable
func (e *ApprovalChainExecutor) Execute(ctx context.Context, instance *model.WorkflowInstance, step *model.StepDefinition, exec *model.StepExecution) (*ExecutionResult, error) {
	cfg, err := ParseApprovalConfig(step.Config)
	if err != nil {
		return nil, fmt.Errorf("approval_chain %s: %w", step.ID, err)
	}

	dataCtx := buildDataContext(instance)

	description := step.Name
	if desc := configStringOptional(step.Config, "description"); desc != "" {
		if resolved, rerr := e.resolver.Resolve(desc, dataCtx); rerr == nil {
			description = fmt.Sprintf("%v", resolved)
		}
	}

	priority := determinePriority(instance.Variables)

	// In parallel mode every approver gets a task immediately. In sequential
	// mode only the first approver does; subsequent tasks are created on resume.
	pending := cfg.Approvers
	if cfg.Mode == ApprovalModeSequential {
		pending = cfg.Approvers[:1]
	}

	createdIDs := make([]string, 0, len(pending))
	for idx, approver := range pending {
		task, err := e.buildApproverTask(instance, step, exec, approver, idx, len(cfg.Approvers), cfg, description, priority, dataCtx)
		if err != nil {
			return nil, fmt.Errorf("approval_chain %s: building task for approver %d: %w", step.ID, idx, err)
		}
		if err := e.taskRepo.Create(ctx, task); err != nil {
			return nil, fmt.Errorf("approval_chain %s: creating task for approver %d: %w", step.ID, idx, err)
		}
		createdIDs = append(createdIDs, task.ID)
		e.publishTaskCreated(ctx, instance, task, cfg, idx)
	}

	e.logger.Info().
		Str("step_id", step.ID).
		Str("instance_id", instance.ID).
		Str("mode", cfg.Mode).
		Str("quorum", cfg.Quorum).
		Int("approvers", len(cfg.Approvers)).
		Int("tasks_created", len(createdIDs)).
		Msg("approval chain started, parking workflow")

	return &ExecutionResult{
		Output: map[string]interface{}{
			"approval_task_ids": createdIDs,
			"mode":              cfg.Mode,
			"quorum":            cfg.Quorum,
			"approver_count":    len(cfg.Approvers),
		},
		Parked: true,
	}, nil
}

// buildApproverTask constructs a HumanTask for a single approver. The task
// carries approval metadata (approver index, quorum, mode) so the resume path
// can correlate decisions back to the chain.
func (e *ApprovalChainExecutor) buildApproverTask(
	instance *model.WorkflowInstance,
	step *model.StepDefinition,
	exec *model.StepExecution,
	approver Approver,
	approverIdx, totalApprovers int,
	cfg ApprovalConfig,
	description string,
	priority int,
	dataCtx map[string]interface{},
) (*model.HumanTask, error) {
	var assigneeID *string
	var assigneeRole *string

	switch {
	case approver.IsRole():
		role := approver.Ref
		assigneeRole = &role
	case approver.IsUser():
		ref := approver.Ref
		if strings.Contains(ref, "${") {
			resolved, err := e.resolver.Resolve(ref, dataCtx)
			if err != nil {
				return nil, fmt.Errorf("resolving approver ref %q: %w", ref, err)
			}
			s := fmt.Sprintf("%v", resolved)
			assigneeID = &s
		} else {
			assigneeID = &ref
		}
	default:
		return nil, fmt.Errorf("approver %d has invalid type %q (want user|role)", approverIdx, approver.Type)
	}

	var slaDeadline *time.Time
	if cfg.SLA > 0 {
		d := time.Now().UTC().Add(cfg.SLA)
		slaDeadline = &d
	}

	// A standard approve/reject decision form so the human-task UI can render it.
	formSchema := []model.FormField{
		{
			Name:     "decision",
			Type:     "select",
			Label:    "Decision",
			Required: true,
			Options:  []string{DecisionApprove, DecisionReject},
		},
		{
			Name:  "comment",
			Type:  "textarea",
			Label: "Comment",
		},
	}

	metadata := map[string]interface{}{
		"workflow_instance_id": instance.ID,
		"workflow_definition":  instance.DefinitionID,
		"definition_version":   instance.DefinitionVer,
		"step_id":              step.ID,
		"step_execution_id":    exec.ID,
		"approval_chain":       true,
		"approver_index":       approverIdx,
		"approver_total":       totalApprovers,
		"approver_type":        approver.Type,
		"approval_mode":        cfg.Mode,
		"approval_quorum":      cfg.Quorum,
	}
	if cfg.Quorum == QuorumNofM {
		metadata["approval_quorum_n"] = cfg.QuorumN
	}

	now := time.Now().UTC()
	return &model.HumanTask{
		ID:           events.GenerateUUID(),
		TenantID:     instance.TenantID,
		InstanceID:   instance.ID,
		StepID:       step.ID,
		StepExecID:   exec.ID,
		Name:         step.Name,
		Description:  description,
		Status:       model.TaskStatusPending,
		AssigneeID:   assigneeID,
		AssigneeRole: assigneeRole,
		FormSchema:   formSchema,
		FormData:     make(map[string]interface{}),
		SLADeadline:  slaDeadline,
		Priority:     priority,
		Metadata:     metadata,
		CreatedAt:    now,
		UpdatedAt:    now,
	}, nil
}

// publishTaskCreated emits a best-effort workflow.task.created event for an
// approver task. Failures are logged, never fatal (mirrors HumanTaskExecutor).
func (e *ApprovalChainExecutor) publishTaskCreated(ctx context.Context, instance *model.WorkflowInstance, task *model.HumanTask, cfg ApprovalConfig, approverIdx int) {
	if e.producer == nil {
		return
	}
	payload := map[string]interface{}{
		"task_id":         task.ID,
		"instance_id":     task.InstanceID,
		"step_id":         task.StepID,
		"task_name":       task.Name,
		"priority":        task.Priority,
		"approval_chain":  true,
		"approver_index":  approverIdx,
		"approval_mode":   cfg.Mode,
		"approval_quorum": cfg.Quorum,
	}
	if task.AssigneeID != nil {
		payload["assignee_id"] = *task.AssigneeID
	}
	if task.AssigneeRole != nil {
		payload["assignee_role"] = *task.AssigneeRole
	}
	if task.SLADeadline != nil {
		payload["sla_deadline"] = *task.SLADeadline
	}
	if instance.StartedBy != nil {
		payload["initiator_id"] = *instance.StartedBy
	}

	evt, err := events.NewEvent("workflow.task.created", "workflow-engine", task.TenantID, payload)
	if err != nil {
		e.logger.Warn().Err(err).Str("task_id", task.ID).Msg("failed to build approval task created event")
		return
	}
	if err := e.producer.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		e.logger.Warn().Err(err).Str("task_id", task.ID).Msg("failed to publish approval task created event")
	}
}

// ParseApprovalConfig validates and parses an approval_chain step config into an
// ApprovalConfig. It rejects malformed configs (empty approvers, unknown mode /
// quorum, missing or out-of-range quorum_n) so a bad definition fails at
// execution rather than silently mis-behaving.
func ParseApprovalConfig(config map[string]interface{}) (ApprovalConfig, error) {
	cfg := ApprovalConfig{
		Mode:   ApprovalModeSequential,
		Quorum: QuorumAll,
	}

	raw, ok := config["approvers"]
	if !ok {
		return cfg, fmt.Errorf("missing required config key %q", "approvers")
	}
	list, ok := raw.([]interface{})
	if !ok {
		return cfg, fmt.Errorf("config key %q must be an array", "approvers")
	}
	if len(list) == 0 {
		return cfg, fmt.Errorf("config key %q must contain at least one approver", "approvers")
	}
	for i, item := range list {
		m, ok := item.(map[string]interface{})
		if !ok {
			return cfg, fmt.Errorf("approvers[%d] must be an object", i)
		}
		typ, _ := m["type"].(string)
		ref, _ := m["ref"].(string)
		typ = strings.ToLower(strings.TrimSpace(typ))
		if typ != "user" && typ != "role" {
			return cfg, fmt.Errorf("approvers[%d]: type must be \"user\" or \"role\", got %q", i, typ)
		}
		if strings.TrimSpace(ref) == "" {
			return cfg, fmt.Errorf("approvers[%d]: ref is required", i)
		}
		cfg.Approvers = append(cfg.Approvers, Approver{Type: typ, Ref: ref})
	}

	if mode := configStringOptional(config, "mode"); mode != "" {
		mode = strings.ToLower(strings.TrimSpace(mode))
		if mode != ApprovalModeSequential && mode != ApprovalModeParallel {
			return cfg, fmt.Errorf("mode must be %q or %q, got %q", ApprovalModeSequential, ApprovalModeParallel, mode)
		}
		cfg.Mode = mode
	}

	if quorum := configStringOptional(config, "quorum"); quorum != "" {
		quorum = strings.ToLower(strings.TrimSpace(quorum))
		switch quorum {
		case QuorumAll, QuorumAny, QuorumNofM:
			cfg.Quorum = quorum
		default:
			return cfg, fmt.Errorf("quorum must be %q, %q, or %q, got %q", QuorumAll, QuorumAny, QuorumNofM, quorum)
		}
	}

	if cfg.Quorum == QuorumNofM {
		n := toInt(config["quorum_n"])
		if n <= 0 {
			return cfg, fmt.Errorf("quorum %q requires a positive %q", QuorumNofM, "quorum_n")
		}
		if n > len(cfg.Approvers) {
			return cfg, fmt.Errorf("quorum_n (%d) cannot exceed the number of approvers (%d)", n, len(cfg.Approvers))
		}
		cfg.QuorumN = n
	}

	if v, ok := config["sla_hours"]; ok {
		if h := toFloat(v); h > 0 {
			cfg.SLA = time.Duration(h * float64(time.Hour))
		}
	}

	cfg.RequireDistinctApprovers = configBoolOptional(config, "require_distinct_approvers")

	return cfg, nil
}

// requiredApprovals returns the number of approvals needed to satisfy the quorum
// for a chain of `total` approvers.
func (c ApprovalConfig) requiredApprovals() int {
	switch c.Quorum {
	case QuorumAny:
		return 1
	case QuorumNofM:
		return c.QuorumN
	default: // QuorumAll
		return len(c.Approvers)
	}
}

// ResolveApproval computes the chain outcome from the recorded decisions.
//
// Algorithm (deterministic, side-effect free):
//   - approvals := count of decisions == approve
//   - rejections := count of decisions == reject
//   - pending := decisions with empty/unknown verb (not yet decided) + approvers
//     that have no decision recorded yet
//   - need := required approvals for the quorum (all=>M, any=>1, n_of_m=>N)
//   - If approvals >= need                       -> advance (quorum met)
//   - Else if approvals + pending < need         -> reject  (quorum unreachable)
//   - Else                                        -> wait    (still resolvable)
//
// `total` is the total number of approvers in the chain (M). decisions may be a
// partial slice (e.g. only the tasks created so far in sequential mode); the
// remaining approvers are counted as pending. A single hard reject is NOT
// special-cased — rejecting simply removes capacity, and the function reports
// reject precisely when the quorum can no longer be reached, which is the
// correct semantics for all of all/any/n_of_m.
func ResolveApproval(cfg ApprovalConfig, decisions []ApproverDecision) Resolution {
	need := cfg.requiredApprovals()
	total := len(cfg.Approvers)

	approvals := 0
	rejections := 0
	decided := 0
	for _, d := range decisions {
		switch strings.ToLower(strings.TrimSpace(d.Decision)) {
		case DecisionApprove:
			approvals++
			decided++
		case DecisionReject:
			rejections++
			decided++
		default:
			// recorded-but-undecided task counts as pending, not decided.
		}
	}

	// Approvers with no decision row yet (sequential mode hasn't created their
	// task) plus recorded-but-undecided tasks are still-pending capacity.
	pending := total - decided
	if pending < 0 {
		pending = 0
	}

	switch {
	case approvals >= need:
		return ResolutionAdvance
	case approvals+pending < need:
		return ResolutionReject
	default:
		return ResolutionWait
	}
}

// ErrDistinctApproverConflict is returned when RequireDistinctApprovers is set
// and a single actor has decided more than one step/tier of the same chain
// instance (a separation-of-duties / four-eyes violation).
var ErrDistinctApproverConflict = errors.New("separation-of-duties conflict: an approver may not decide more than one tier of the same approval chain")

// DistinctApproverConflict inspects the recorded decisions for a
// separation-of-duties violation. It returns the offending actor id (the
// decider that appears on more than one decided step) and true when a conflict
// exists; otherwise ("", false).
//
// The check is a no-op (always reports no conflict) unless
// cfg.RequireDistinctApprovers is true, so chains that have not opted in are
// never affected. Only decisions that have actually been decided (approve /
// reject) AND carry a non-empty DecidedBy are considered — undecided/pending
// tasks and decisions whose actor is unknown cannot constitute a conflict. The
// comparison is case-insensitive on the actor id and ignores surrounding
// whitespace.
func DistinctApproverConflict(cfg ApprovalConfig, decisions []ApproverDecision) (string, bool) {
	if !cfg.RequireDistinctApprovers {
		return "", false
	}
	seen := make(map[string]struct{}, len(decisions))
	for _, d := range decisions {
		switch strings.ToLower(strings.TrimSpace(d.Decision)) {
		case DecisionApprove, DecisionReject:
		default:
			continue // pending / undecided — not a decider yet.
		}
		actor := strings.ToLower(strings.TrimSpace(d.DecidedBy))
		if actor == "" {
			continue // unknown decider cannot establish a conflict.
		}
		if _, dup := seen[actor]; dup {
			return strings.TrimSpace(d.DecidedBy), true
		}
		seen[actor] = struct{}{}
	}
	return "", false
}

// NextSequentialApprover returns the next approver whose task should be created
// in sequential mode, given the decisions recorded so far, and whether one
// exists. It returns the approver at index len(decided-approve-or-reject) — i.e.
// the first approver that has not yet acted — but only while the chain is still
// in the wait state. When the chain has advanced or rejected, ok is false.
func NextSequentialApprover(cfg ApprovalConfig, decisions []ApproverDecision) (Approver, int, bool) {
	if cfg.Mode != ApprovalModeSequential {
		return Approver{}, 0, false
	}
	if ResolveApproval(cfg, decisions) != ResolutionWait {
		return Approver{}, 0, false
	}
	// Count how many sequential approvers have actually decided.
	decided := 0
	for _, d := range decisions {
		v := strings.ToLower(strings.TrimSpace(d.Decision))
		if v == DecisionApprove || v == DecisionReject {
			decided++
		}
	}
	if decided >= len(cfg.Approvers) {
		return Approver{}, 0, false
	}
	return cfg.Approvers[decided], decided, true
}

// SummarizeDecisions returns a stable, sorted breakdown of decisions for
// logging / event payloads: counts keyed by verb. Pending (undecided) entries
// are reported under the empty-string key.
func SummarizeDecisions(decisions []ApproverDecision) map[string]int {
	counts := map[string]int{}
	for _, d := range decisions {
		v := strings.ToLower(strings.TrimSpace(d.Decision))
		counts[v]++
	}
	return counts
}

// DecisionVerbs returns the recognised decision verbs in deterministic order —
// used by callers building UI / validation.
func DecisionVerbs() []string {
	verbs := []string{DecisionApprove, DecisionReject}
	sort.Strings(verbs)
	return verbs
}
