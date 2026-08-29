package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/expression"
	"github.com/clario360/platform/internal/workflow/model"
)

// instanceRepo defines the persistence operations for workflow instances.
type instanceRepo interface {
	Create(ctx context.Context, inst *model.WorkflowInstance) error
	GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowInstance, error)
	UpdateWithLock(ctx context.Context, inst *model.WorkflowInstance) error
	List(ctx context.Context, tenantID, status, definitionID, startedBy string, dateFrom, dateTo *time.Time, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowInstance, int, error)
	ListRunning(ctx context.Context, limit, offset int) ([]*model.WorkflowInstance, error)
	CreateStepExecution(ctx context.Context, exec *model.StepExecution) error
	UpdateStepExecution(ctx context.Context, exec *model.StepExecution) error
	GetStepExecutions(ctx context.Context, instanceID string) ([]*model.StepExecution, error)
	GetLastFailedStep(ctx context.Context, instanceID string) (*model.StepExecution, error)
}

// taskRepo defines the persistence operations for human tasks.
type taskRepo interface {
	Create(ctx context.Context, task *model.HumanTask) error
	GetByID(ctx context.Context, tenantID, id string) (*model.HumanTask, error)
	ListForUser(ctx context.Context, tenantID, userID string, roles []string, statuses []string, sortBy, sortOrder string, limit, offset int) ([]*model.HumanTask, int, error)
	ListMyQueues(ctx context.Context, tenantID, userID string, roles []string, limit, offset int) ([]*model.HumanTask, int, error)
	ClaimTask(ctx context.Context, tenantID, taskID, userID string) error
	UnclaimTask(ctx context.Context, tenantID, taskID, userID string) error
	CompleteTask(ctx context.Context, tenantID, taskID string, formData map[string]interface{}, sensitive map[string]bool) error
	DelegateTask(ctx context.Context, tenantID, taskID, fromUserID, toUserID, reason string) error
	RejectTask(ctx context.Context, tenantID, taskID, userID, reason string) error
	CountByStatus(ctx context.Context, tenantID, userID string, roles []string) (map[string]int, error)
	ListByInstanceStep(ctx context.Context, tenantID, instanceID, stepID string) ([]*model.HumanTask, error)
	GetOverdueTasks(ctx context.Context, limit int) ([]*model.HumanTask, error)
	MarkSLABreached(ctx context.Context, taskID string) error
	EscalateTask(ctx context.Context, taskID, escalationRole string) error
	CancelByInstance(ctx context.Context, instanceID string) error
	CancelOpenByInstanceStep(ctx context.Context, instanceID, stepID string) error
	UpdateMetadata(ctx context.Context, tenantID, taskID string, metadata map[string]interface{}) error
	DailyCreatedCounts(ctx context.Context, tenantID string, days int) ([]int, error)
}

// executorRegistry dispatches step execution to the appropriate executor.
type executorRegistry interface {
	Execute(ctx context.Context, instance *model.WorkflowInstance, step *model.StepDefinition, exec *model.StepExecution) (*executor.ExecutionResult, error)
}

// stepCommitter is an OPTIONAL capability an instance repository may implement to
// commit a workflow advance atomically. When the wired instanceRepo satisfies it
// (the production *repository.InstanceRepository does), the engine routes the
// per-advance writes — create step execution + instance state transition — through
// ONE transaction so a crash mid-advance can no longer tear state. Test doubles
// that do not implement it transparently fall back to the historical three
// autocommit writes, so existing behaviour is byte-for-byte unchanged.
type stepCommitter interface {
	CommitStepTransition(ctx context.Context, inst *model.WorkflowInstance, stepExec *model.StepExecution) error
}

// lifecycleCommitter is an OPTIONAL capability an instance repository may implement
// to make a LIFECYCLE state transition (complete / fail / cancel / suspend /
// resume / retry) and its workflow.* audit event commit ATOMICALLY: the instance
// state UPDATE, an optional end-step audit row, AND the outbox staging of the
// audit event all land in ONE database transaction. When the wired instanceRepo
// satisfies it (the production *repository.InstanceRepository does), the engine
// stages the audit event in the SAME tx as the state change — so a committed
// transition can no longer LOSE its audit event if the broker is down, and the
// relay delivers it exactly-once to platform.workflow.events.
//
// Test doubles that do NOT implement it transparently fall back to the historical
// UpdateWithLock + best-effort direct publishEvent path (an optional-capability
// type assertion discovered at construction), so the existing workflow test
// packages and un-migrated deployments are byte-for-byte unchanged.
type lifecycleCommitter interface {
	CommitInstanceStateWithEvent(ctx context.Context, inst *model.WorkflowInstance, endStepExec *model.StepExecution, topic string, evt *events.Event) error
}

// instanceSerializer is an OPTIONAL capability an instance repository may implement
// to serialize the hot execute/advance entry across processes (a Postgres advisory
// lock keyed on the instance). When present the engine wraps each transition entry
// so concurrent re-entries (a timer fire racing a task resume, or parallel forks)
// cannot double-advance. Absent it, the engine relies on the optimistic
// lock_version guard alone (unchanged legacy behaviour).
type instanceSerializer interface {
	SerializeInstance(ctx context.Context, instanceID string, fn func() error) error
}

// incidentStore is the OPTIONAL persistence capability that turns retry
// exhaustion into a GOVERNED INCIDENT (GAP 4) instead of terminating the whole
// instance. When an incidentStore is wired, handleStepFailure raises an incident
// that PARKS the failed step (Camunda-incident pattern) and leaves the rest of
// the instance / sibling parallel branches intact; operators then retry / skip /
// modify-variables through the maker-checker override flow. When NO incident
// store is wired (test doubles, embedded suites that have not adopted incidents),
// the engine falls back to the historical failInstance() behaviour, so the eight
// existing workflow test packages and existing instances are byte-for-byte
// unchanged.
type incidentStore interface {
	RaiseIncidentAtomic(ctx context.Context, inst *model.WorkflowInstance, inc *model.Incident) error
	GetOpenByInstance(ctx context.Context, tenantID, instanceID string) (*model.Incident, error)
	GetByID(ctx context.Context, tenantID, id string) (*model.Incident, error)
	ListByInstance(ctx context.Context, tenantID, instanceID string) ([]*model.Incident, error)
	ResolveIncident(ctx context.Context, id, resolvedBy, kind string) error
	MarkIncidentDeadLettered(ctx context.Context, id, resolvedBy string) error
	CreateOverride(ctx context.Context, ov *model.IncidentOverride) error
	GetOverride(ctx context.Context, tenantID, id string) (*model.IncidentOverride, error)
	ApproveOverride(ctx context.Context, id, approvedBy string) error
	RejectOverride(ctx context.Context, id, rejectedBy, reason string) error
	CreateDeadLetter(ctx context.Context, dl *model.DeadLetter) error
	ListDeadLetter(ctx context.Context, tenantID string, limit int) ([]*model.DeadLetter, error)
}

// eventPublisher defines the interface for publishing events.
type eventPublisher interface {
	Publish(ctx context.Context, topic string, event *events.Event) error
}

// EngineService is the core workflow engine that orchestrates instance lifecycle,
// step execution, transition evaluation, and state management.
type EngineService struct {
	instanceRepo instanceRepo
	defRepo      definitionRepo
	taskRepo     taskRepo
	executors    executorRegistry
	evaluator    *expression.Evaluator
	resolver     *expression.VariableResolver
	producer     eventPublisher
	logger       zerolog.Logger

	// committer and serializer are the OPTIONAL durable-execution capabilities
	// discovered from instanceRepo at construction (nil when the wired repo — a
	// test double — does not implement them, preserving legacy behaviour).
	committer  stepCommitter
	serializer instanceSerializer

	// lifecycleTx is the OPTIONAL capability (production *repository.InstanceRepository)
	// that commits a lifecycle state transition AND stages its audit event in ONE
	// transaction. When set, the six lifecycle emits (completed/failed/cancelled/
	// suspended/resumed/retried) route through it so the audit event commits
	// atomically with the state — no lossy best-effort direct publish. When nil
	// (test doubles), the engine keeps the legacy UpdateWithLock + publishEvent path.
	lifecycleTx lifecycleCommitter

	// incidents is the OPTIONAL incident/dead-letter store (GAP 4). It is set via
	// WithIncidentStore after construction so NewEngineService's signature — and
	// every existing caller/test — is unchanged. When nil, retry exhaustion falls
	// back to failInstance() (legacy behaviour); when set, it raises a governed
	// incident that parks the failed step instead.
	incidents incidentStore

	// localLocks provides an in-process, per-instance critical section so a single
	// engine process never runs two transitions for the same instance
	// concurrently. It complements the cross-process advisory lock (serializer)
	// and, unlike it, works even against test doubles that lack a database.
	localLocks *instanceLockMap

	// childDefResolver and miLedger are the OPTIONAL composition stores (BPMN
	// call-activity / sub-process + multi_instance for-each). They are discovered
	// from the wired repos (childDefResolver from the definition repo, miLedger set
	// via WithCompositionStores). When childDefResolver is nil the engine cannot
	// start children by definition_key (the call_activity/multi_instance executors
	// fail loudly); when miLedger is nil the async multi_instance fan-in is
	// unavailable. Both nil == the pre-composition engine, byte-for-byte unchanged
	// for every definition that uses none of the new step types.
	childDefResolver childDefinitionResolver
	miLedger         miChildLedger
	canceler         childCanceler

	// maxCallDepth bounds the composition (call_activity / multi_instance)
	// parent->child spawn chain. It is set to model.DefaultMaxCallDepth in
	// NewEngineService and overridable via WithMaxCallDepth. createChildInstance
	// walks parent_instance_id and fails closed (raising an incident on the parent
	// step) before creating a child that would exceed it, so a cyclic /
	// deeply-nested composition cannot exhaust the DB/process.
	maxCallDepth int

	// boundaryReg is the OPTIONAL durable-scheduling capability (the scheduler)
	// used to ARM/CANCEL a step's interrupting boundary events (timer/message) and
	// an event-based gateway's arms. Set via SetBoundaryRegistrar; when nil,
	// boundary events are never armed and a step behaves exactly as before —
	// keeping the feature reversible/additive for every existing definition.
	boundaryReg boundaryRegistrar
}

// childDefinitionResolver is the OPTIONAL capability (implemented by
// *repository.DefinitionRepository) to resolve the ACTIVE child definition for a
// stable lineage key. Discovered on the definition repo at construction; when
// absent the composition step types cannot start children.
type childDefinitionResolver interface {
	GetActiveByDefinitionKey(ctx context.Context, tenantID, definitionKey string) (*model.WorkflowDefinition, error)
}

// miChildLedger is the OPTIONAL multi_instance fan-in ledger the engine consults
// on each child completion to decide whether the parent step's policy is met.
// Implemented by *repository.MIChildRepository and wired via WithCompositionStores.
type miChildLedger interface {
	CreateChild(ctx context.Context, child *model.MIChild) error
	MarkChildTerminalByInstance(ctx context.Context, childInstanceID, status string, output map[string]interface{}, errMsg *string) (bool, error)
	GetChildByInstance(ctx context.Context, childInstanceID string) (*model.MIChild, error)
	ListChildren(ctx context.Context, parentInstanceID, parentStepID string) ([]*model.MIChild, error)
	AttachChildInstance(ctx context.Context, parentInstanceID, parentStepID string, childIndex int, childInstanceID string) error
}

// childCanceler is the OPTIONAL capability used to early-cancel the still-running
// fan-out children of a multi_instance step once its completion policy is met
// (e.g. "any"/n_of_m). It is satisfied by EngineService itself (CancelInstance);
// wired via WithCompositionStores so the engine can cancel a child without a
// self-referential field at construction.
type childCanceler interface {
	CancelInstance(ctx context.Context, tenantID, instanceID string) error
}

// NewEngineService creates a new EngineService with all required dependencies.
func NewEngineService(
	instanceRepo instanceRepo,
	defRepo definitionRepo,
	taskRepo taskRepo,
	executors executorRegistry,
	producer eventPublisher,
	logger zerolog.Logger,
) *EngineService {
	s := &EngineService{
		instanceRepo: instanceRepo,
		defRepo:      defRepo,
		taskRepo:     taskRepo,
		executors:    executors,
		evaluator:    expression.NewEvaluator(),
		resolver:     expression.NewVariableResolver(),
		producer:     producer,
		logger:       logger.With().Str("service", "workflow-engine").Logger(),
		localLocks:   newInstanceLockMap(),
		maxCallDepth: model.DefaultMaxCallDepth,
	}
	// Discover optional durable-execution capabilities on the instance repo.
	if c, ok := instanceRepo.(stepCommitter); ok {
		s.committer = c
	}
	if ser, ok := instanceRepo.(instanceSerializer); ok {
		s.serializer = ser
	}
	// Discover the OPTIONAL atomic lifecycle-emit capability: when present, a
	// lifecycle state transition and its audit event commit in one transaction
	// (lossless audit). Absent it, the engine keeps the legacy commit-then-publish
	// path so test doubles are unchanged.
	if lc, ok := instanceRepo.(lifecycleCommitter); ok {
		s.lifecycleTx = lc
	}
	// Discover the OPTIONAL composition capability on the definition repo: the
	// production *repository.DefinitionRepository resolves a child definition by
	// its stable lineage key. Test doubles that do not implement it leave the
	// resolver nil and the composition step types unavailable (unchanged behaviour
	// for every non-composition definition).
	if r, ok := defRepo.(childDefinitionResolver); ok {
		s.childDefResolver = r
	}
	// The engine itself provides child cancellation (multi_instance early-cancel).
	s.canceler = s
	return s
}

// WithIncidentStore wires the OPTIONAL incident/dead-letter store (GAP 4) so
// retry exhaustion raises a governed incident that parks the failed step instead
// of terminating the whole instance. It returns the receiver for chaining and is
// a no-op when store is nil (keeping the legacy failInstance() behaviour). It is
// separate from NewEngineService so every existing caller/test that does not use
// incidents compiles and behaves unchanged.
func (s *EngineService) WithIncidentStore(store incidentStore) *EngineService {
	s.incidents = store
	return s
}

// WithMaxCallDepth overrides the composition (call_activity / multi_instance)
// spawn-chain depth bound (default model.DefaultMaxCallDepth). A value <= 0 is
// ignored (keeps the default) so a mis-wired zero cannot disable the guard and
// re-open the self-DoS footgun. Returns the receiver for chaining.
func (s *EngineService) WithMaxCallDepth(depth int) *EngineService {
	if depth > 0 {
		s.maxCallDepth = depth
	}
	return s
}

// serializeTransition runs fn under the per-instance critical section: first the
// in-process mutex (always), then — when the repo supports it — the cross-process
// Postgres advisory lock. This guarantees that concurrent re-entries for the same
// instance (a timer fire racing a task resume, or parallel forks) are serialized
// rather than double-advancing. When no serializer capability is present (test
// doubles), the in-process mutex still holds within a single process.
//
// COMPOSITION re-entrancy: it also threads a compContext on ctx that tracks the
// instance ids currently HELD by this call stack and a queue of DEFERRED
// parent-resume closures. When a child completes SYNCHRONOUSLY while its parent's
// critical section is still held higher in the same stack, the parent-resume hook
// cannot re-acquire the (non-reentrant) parent lock — so it enqueues the resume,
// and the OUTERMOST serializeTransition drains the queue AFTER releasing its lock.
func (s *EngineService) serializeTransition(ctx context.Context, instanceID string, fn func(context.Context) error) error {
	cc, outermost := compContextFrom(ctx)
	if outermost {
		ctx = withCompContext(ctx, cc)
	}
	cc.hold(instanceID)

	err := s.serializeTransitionInner(ctx, instanceID, fn)

	cc.release(instanceID)

	// The OUTERMOST entry drains any deferred parent-resumes now that every lock
	// this stack held has been released, so each deferred resume can freshly
	// acquire the parent's critical section without self-deadlocking.
	if outermost {
		s.drainDeferred(ctx, cc)
	}
	return err
}

// serializeTransitionInner performs the actual lock acquisition + fn dispatch.
// fn receives the compContext-enriched ctx so nested transitions and the
// synchronous child-completion hook see the held-lock set.
func (s *EngineService) serializeTransitionInner(ctx context.Context, instanceID string, fn func(context.Context) error) error {
	unlock := s.localLocks.lock(instanceID)
	defer unlock()

	if s.serializer != nil {
		return s.serializer.SerializeInstance(ctx, instanceID, func() error { return fn(ctx) })
	}
	return fn(ctx)
}

// resolveStartDefinition resolves the ACTIVE definition version a start request
// targets. DefinitionID (an exact version) takes precedence; when only
// DefinitionKey is supplied it resolves the runtime-selected version of that
// lineage via the OPTIONAL childDefResolver (GetActiveByDefinitionKey, which is
// stage-aware + fails closed on ambiguity). Errors are wrapped with actionable
// guidance distinguishing missing/not-yet-published/ambiguous.
func (s *EngineService) resolveStartDefinition(ctx context.Context, tenantID string, req dto.StartInstanceRequest) (*model.WorkflowDefinition, error) {
	// Lineage start (no explicit id): resolve the single runtime-active version.
	if req.DefinitionID == "" && req.DefinitionKey != "" {
		if s.childDefResolver == nil {
			return nil, fmt.Errorf("starting by definition_key is unavailable (no lineage resolver wired)")
		}
		def, err := s.childDefResolver.GetActiveByDefinitionKey(ctx, tenantID, req.DefinitionKey)
		if err != nil {
			if errors.Is(err, model.ErrConflict) {
				return nil, fmt.Errorf("workflow lineage %s has an ambiguous active version and cannot be started: %w", req.DefinitionKey, err)
			}
			if errors.Is(err, model.ErrNotFound) {
				return nil, fmt.Errorf("workflow lineage %s has no active version to start", req.DefinitionKey)
			}
			return nil, fmt.Errorf("resolving workflow lineage %s: %w", req.DefinitionKey, err)
		}
		return def, nil
	}

	if req.DefinitionID == "" {
		return nil, fmt.Errorf("either definition_id or definition_key is required to start a workflow")
	}

	// Exact-version start (legacy path): load the specific active version by id.
	def, err := s.defRepo.GetActiveByID(ctx, tenantID, req.DefinitionID)
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			// The active lookup found nothing. Distinguish a genuinely-missing
			// definition from one that exists but is not active (most commonly a
			// draft that has not been published) so the caller gets actionable
			// guidance instead of an ambiguous "not found".
			if existing, lookupErr := s.defRepo.GetByID(ctx, tenantID, req.DefinitionID); lookupErr == nil && existing != nil {
				if existing.Status == model.DefinitionStatusDraft {
					return nil, fmt.Errorf("workflow definition %s is in draft and must be published before instances can be started", req.DefinitionID)
				}
				return nil, fmt.Errorf("workflow definition %s is not active (status: %s); only active definitions can be started", req.DefinitionID, existing.Status)
			}
			return nil, fmt.Errorf("workflow definition %s not found", req.DefinitionID)
		}
		return nil, fmt.Errorf("loading workflow definition: %w", err)
	}
	return def, nil
}

// StartInstance creates and begins executing a new workflow instance.
//
// The version to run is resolved deterministically: when req.DefinitionID is set
// the engine starts that EXACT active version (legacy behaviour). When only
// req.DefinitionKey is set, it resolves the RUNTIME-SELECTED version of the
// lineage (the prod-promoted active version, tie-break version DESC — never by
// name), so a lineage/manual start uses the same canonical version an event start
// resolves to, and it FAILS CLOSED (ErrConflict) if the lineage is ambiguous.
func (s *EngineService) StartInstance(ctx context.Context, tenantID, userID string, req dto.StartInstanceRequest) (*model.WorkflowInstance, error) {
	// 1. Resolve the definition to run (must be active).
	def, err := s.resolveStartDefinition(ctx, tenantID, req)
	if err != nil {
		return nil, err
	}

	if def.Status != model.DefinitionStatusActive {
		return nil, fmt.Errorf("workflow definition %s is not active (status: %s)", def.ID, def.Status)
	}

	// 2. Create instance.
	now := time.Now().UTC()
	firstStepID := ""
	if len(def.Steps) > 0 {
		firstStepID = def.Steps[0].ID
	}

	inst := &model.WorkflowInstance{
		ID:            generateUUID(),
		TenantID:      tenantID,
		DefinitionID:  def.ID,
		DefinitionVer: def.Version,
		Status:        model.InstanceStatusRunning,
		CurrentStepID: &firstStepID,
		Variables:     make(map[string]interface{}),
		StepOutputs:   make(map[string]interface{}),
		TriggerData:   req.TriggerData,
		StartedBy:     &userID,
		StartedAt:     now,
		UpdatedAt:     now,
		LockVersion:   0,
	}

	// 3. Resolve initial variables from trigger data and defaults.
	inst.Variables = s.resolveInitialVariables(def.Variables, req.InputVariables, req.TriggerData)

	// 3b. CLASSIFICATION: stamp the transient set of top-level keys that must be
	// encrypted at rest (definition-declared sensitive variables + classified
	// human-task form fields). It is empty for legacy definitions, so the write
	// stays on the exact plaintext path; when a payload codec is wired the
	// repository envelopes exactly these keys. The set is transient (json:"-"
	// db:"-") and re-derived from the at-rest envelopes on every subsequent read,
	// so it need only be stamped on the FIRST write here.
	if keys := def.ClassifiedVariableKeys(); len(keys) > 0 {
		inst.SensitiveKeys = keys
	}

	if err := s.instanceRepo.Create(ctx, inst); err != nil {
		return nil, fmt.Errorf("creating workflow instance: %w", err)
	}

	s.logger.Info().
		Str("instance_id", inst.ID).
		Str("definition_id", def.ID).
		Str("tenant_id", tenantID).
		Str("started_by", userID).
		Msg("workflow instance started")

	// 4. Publish workflow.instance.started event.
	s.publishEvent(ctx, "workflow.instance.started", tenantID, map[string]interface{}{
		"instance_id":   inst.ID,
		"definition_id": def.ID,
		"started_by":    userID,
	})

	// 5. Advance workflow from the first step. This is a hot-path entry, so it is
	// serialized per-instance (in-process mutex + cross-process advisory lock).
	if firstStepID != "" {
		if err := s.serializeTransition(ctx, inst.ID, func(ctx context.Context) error {
			return s.executeStepLocked(ctx, inst, def, firstStepID)
		}); err != nil {
			s.logger.Error().Err(err).
				Str("instance_id", inst.ID).
				Str("step_id", firstStepID).
				Msg("failed to execute first step")
			// Do not fail the whole start; the instance is created and can be retried.
		}
	}

	return inst, nil
}

// AdvanceWorkflow moves a workflow instance forward from a given step. It is a
// hot-path ENTRY (called by the scheduler, recovery, task resume, and event
// consumers), so it acquires the per-instance critical section before doing any
// work. Transitions that recurse from within (executeStepLocked -> advanceLocked)
// run under the same already-held lock via advanceLocked.
func (s *EngineService) AdvanceWorkflow(ctx context.Context, instanceID, fromStepID string) error {
	return s.serializeTransition(ctx, instanceID, func(ctx context.Context) error {
		return s.advanceLocked(ctx, instanceID, fromStepID)
	})
}

// advanceLocked is the body of AdvanceWorkflow. The caller MUST already hold the
// per-instance critical section (via serializeTransition).
func (s *EngineService) advanceLocked(ctx context.Context, instanceID, fromStepID string) error {
	// Load instance without tenant filter (called internally).
	inst, err := s.instanceRepo.GetByID(ctx, "", instanceID)
	if err != nil {
		return fmt.Errorf("loading instance for advance: %w", err)
	}

	// If status is not running, do nothing.
	if !inst.IsRunnable() {
		s.logger.Debug().
			Str("instance_id", instanceID).
			Str("status", inst.Status).
			Msg("instance is not runnable, skipping advance")
		return nil
	}

	// Load definition.
	def, err := s.defRepo.GetByID(ctx, inst.TenantID, inst.DefinitionID)
	if err != nil {
		return fmt.Errorf("loading definition for advance: %w", err)
	}

	// The step we are advancing AWAY from has completed normally. Cancel any
	// interrupting boundary events it had armed (timer/message) so a boundary that
	// was racing this completion is torn down — the completion won the single-winner
	// race. No-op when the step had no boundaries or no registrar is wired.
	if fromStep := findStep(def.Steps, fromStepID); fromStep != nil {
		s.cancelBoundaryEvents(ctx, inst, fromStep)
	}

	// Determine next step by evaluating transitions from fromStepID.
	nextStepID, err := s.evaluateTransitions(def.Steps, fromStepID, inst)
	if err != nil {
		return fmt.Errorf("evaluating transitions from step %s: %w", fromStepID, err)
	}

	if nextStepID == "" {
		// No transitions found; this shouldn't happen in a well-formed workflow.
		s.logger.Warn().
			Str("instance_id", instanceID).
			Str("from_step", fromStepID).
			Msg("no matching transition found")
		return nil
	}

	// Check if the next step is "end".
	nextStep := findStep(def.Steps, nextStepID)
	if nextStep == nil {
		return fmt.Errorf("transition target step %s not found in definition", nextStepID)
	}

	if nextStep.Type == model.StepTypeEnd {
		return s.completeInstance(ctx, inst, nextStepID)
	}

	// Execute the next step (already inside the per-instance critical section).
	return s.executeStepLocked(ctx, inst, def, nextStepID)
}

// executeStep is retained for callers (recovery, retry) that enter outside the
// per-instance critical section. It acquires the lock and delegates. Internal
// transition code paths call executeStepLocked directly.
func (s *EngineService) executeStep(ctx context.Context, inst *model.WorkflowInstance, def *model.WorkflowDefinition, stepID string) error {
	return s.serializeTransition(ctx, inst.ID, func(ctx context.Context) error {
		return s.executeStepLocked(ctx, inst, def, stepID)
	})
}

// executeStepLocked creates a step execution record and dispatches to the
// executor. The caller MUST already hold the per-instance critical section.
//
// The state transition (create step-execution + update instance current_step_id)
// is committed ATOMICALLY through the stepCommitter capability when available, so
// a crash between the two writes can no longer leave a step-execution row without
// its matching instance pointer (or vice versa). The executor dispatch (which may
// do I/O) stays OUTSIDE that transaction.
func (s *EngineService) executeStepLocked(ctx context.Context, inst *model.WorkflowInstance, def *model.WorkflowDefinition, stepID string) error {
	step := findStep(def.Steps, stepID)
	if step == nil {
		return fmt.Errorf("step %s not found in definition %s", stepID, def.ID)
	}

	// Re-stamp the transient at-rest classification from the definition before any
	// storeStepOutput on this advance. GetByID re-derives SensitiveKeys only from
	// EXISTING at-rest envelopes, so on the FIRST write of a classified value (no
	// envelope yet) the definition-declared field names would otherwise be missing
	// and the value would land in step_outputs in plaintext. This closes the
	// no-leak hole. No-op (empty set merged) for legacy definitions.
	classifyInstanceFromDefinition(inst, def)

	// Create step execution record.
	now := time.Now().UTC()
	stepExec := &model.StepExecution{
		ID:         generateUUID(),
		InstanceID: inst.ID,
		StepID:     stepID,
		StepType:   step.Type,
		Status:     model.StepStatusRunning,
		Attempt:    1,
		StartedAt:  &now,
		CreatedAt:  now,
	}

	// Serialize the step config as input data.
	inputData, _ := json.Marshal(step.Config)
	stepExec.InputData = inputData

	// Atomic state transition: create the step-execution row AND advance the
	// instance's current_step_id in ONE transaction (with the instance row locked
	// FOR UPDATE) when the repo supports it. Fall back to the historical two
	// autocommit writes for repos (test doubles) that do not.
	inst.CurrentStepID = &stepID
	inst.UpdatedAt = time.Now().UTC()
	if s.committer != nil {
		if err := s.committer.CommitStepTransition(ctx, inst, stepExec); err != nil {
			return fmt.Errorf("committing step transition: %w", err)
		}
	} else {
		if err := s.instanceRepo.CreateStepExecution(ctx, stepExec); err != nil {
			return fmt.Errorf("creating step execution: %w", err)
		}
		if err := s.instanceRepo.UpdateWithLock(ctx, inst); err != nil {
			s.logger.Error().Err(err).
				Str("instance_id", inst.ID).
				Str("step_id", stepID).
				Msg("failed to update instance current step")
		}
	}

	// Dispatch to executor.
	result, err := s.executors.Execute(ctx, inst, step, stepExec)
	if err != nil {
		if errors.Is(err, executor.ErrParked) {
			// Step is parked (waiting for external signal).
			stepExec.Status = model.StepStatusRunning
			completedAt := time.Now().UTC()
			stepExec.CompletedAt = nil
			_ = s.instanceRepo.UpdateStepExecution(ctx, stepExec)

			s.logger.Info().
				Str("instance_id", inst.ID).
				Str("step_id", stepID).
				Str("step_type", step.Type).
				Msg("step parked, waiting for external completion")

			// Store partial output if the result contains data.
			if result != nil && result.Output != nil {
				s.storeStepOutput(ctx, inst, stepID, result.Output)
			}
			// ARM any interrupting boundary events (timer/message) attached to this
			// now-parked step so they can INTERRUPT it while it waits. Error
			// boundaries need no arming (evaluated inline on failure). No-op when no
			// registrar is wired or the step declares no boundaries.
			s.armBoundaryEvents(ctx, inst, step, stepExec)
			_ = completedAt // suppress unused
			return nil
		}

		// Execution failed.
		return s.handleStepFailure(ctx, inst, def, step, stepExec, err)
	}

	// Success: store output and advance.
	completedAt := time.Now().UTC()
	stepExec.Status = model.StepStatusCompleted
	stepExec.CompletedAt = &completedAt

	if result != nil && result.Output != nil {
		outputData, _ := json.Marshal(result.Output)
		stepExec.OutputData = outputData
		s.storeStepOutput(ctx, inst, stepID, result.Output)
	}

	if err := s.instanceRepo.UpdateStepExecution(ctx, stepExec); err != nil {
		s.logger.Error().Err(err).
			Str("instance_id", inst.ID).
			Str("step_id", stepID).
			Msg("failed to update step execution on completion")
	}

	s.logger.Info().
		Str("instance_id", inst.ID).
		Str("step_id", stepID).
		Str("step_type", step.Type).
		Msg("step completed successfully")

	// Check if result indicates parked (executor returned success but with Parked flag).
	if result != nil && result.Parked {
		s.logger.Info().
			Str("instance_id", inst.ID).
			Str("step_id", stepID).
			Msg("step returned parked status, waiting for external signal")
		// ARM any interrupting boundary events attached to this now-parked step
		// (same as the ErrParked path). An event-based gateway's arms are also armed
		// here (the gateway executor parks via the Parked flag). stepExec is
		// re-asserted RUNNING for interruptible steps so the single-winner guard has
		// a running exec to claim.
		s.armBoundaryEvents(ctx, inst, step, stepExec)
		return nil
	}

	// Advance to next step (already inside the per-instance critical section).
	return s.advanceLocked(ctx, inst.ID, stepID)
}

// handleStepFailure handles a failed step execution, including retry logic. The
// caller MUST already hold the per-instance critical section.
//
// Retry is expressed as a BOUNDED ITERATION rather than per-attempt recursion:
// the previous implementation recursed once per failed retry, so a step
// configured with a large max_retries could grow the stack proportionally to the
// retry count (and interleave defers). The loop below caps memory at O(1) frames
// regardless of max_retries while preserving the exact retry/advance/park/fail
// semantics.
func (s *EngineService) handleStepFailure(ctx context.Context, inst *model.WorkflowInstance, def *model.WorkflowDefinition, step *model.StepDefinition, stepExec *model.StepExecution, execErr error) error {
	// Check retry configuration once; it does not change between attempts.
	maxRetries := 0
	if v, ok := step.Config["max_retries"]; ok {
		switch rv := v.(type) {
		case float64:
			maxRetries = int(rv)
		case int:
			maxRetries = rv
		}
	}

	// currentExec/currentErr track the just-failed attempt at the top of each loop
	// iteration; the loop either retries (producing a new attempt) or falls through
	// to fail the instance once attempts are exhausted.
	currentExec := stepExec
	currentErr := execErr

	for {
		completedAt := time.Now().UTC()
		errMsg := currentErr.Error()
		currentExec.Status = model.StepStatusFailed
		currentExec.CompletedAt = &completedAt
		currentExec.ErrorMessage = &errMsg

		if err := s.instanceRepo.UpdateStepExecution(ctx, currentExec); err != nil {
			s.logger.Error().Err(err).
				Str("instance_id", inst.ID).
				Str("step_id", step.ID).
				Msg("failed to update step execution on failure")
		}

		if currentExec.Attempt >= maxRetries {
			// All retries exhausted. INTERRUPTING ERROR BOUNDARY: when the step
			// declares an error boundary that matches this failure, route the flow to
			// the boundary's handler instead of raising an incident / failing the
			// instance. This takes precedence over the incident/fail path (BPMN error
			// boundary catches the error). No-op when the step declares no error
			// boundary, so existing behaviour is unchanged.
			if hasErrorBoundary(step) {
				failMsg := fmt.Sprintf("step %s failed after %d attempts: %s", step.ID, currentExec.Attempt, currentErr.Error())
				if handled, herr := s.fireErrorBoundary(ctx, inst, def, step, failMsg); handled || herr != nil {
					return herr
				}
			}
			// GAP 4: when an incident store is wired, raise a GOVERNED INCIDENT that
			// parks THIS failed step (Camunda-incident pattern) and leaves the rest of
			// the instance / sibling parallel branches intact — an operator then
			// retries / skips / modifies. When no incident store is wired (legacy),
			// fall back to failing the whole instance so existing behaviour is
			// byte-for-byte unchanged.
			if s.incidents != nil {
				return s.raiseIncident(ctx, inst, step, currentExec, currentErr, maxRetries)
			}
			return s.failInstance(ctx, inst, fmt.Sprintf("step %s failed after %d attempts: %s", step.ID, currentExec.Attempt, currentErr.Error()))
		}

		// Retry the step.
		s.logger.Info().
			Str("instance_id", inst.ID).
			Str("step_id", step.ID).
			Int("attempt", currentExec.Attempt).
			Int("max_retries", maxRetries).
			Msg("retrying failed step")

		now := time.Now().UTC()
		retryExec := &model.StepExecution{
			ID:         generateUUID(),
			InstanceID: inst.ID,
			StepID:     step.ID,
			StepType:   step.Type,
			Status:     model.StepStatusRunning,
			Attempt:    currentExec.Attempt + 1,
			StartedAt:  &now,
			CreatedAt:  now,
		}

		inputData, _ := json.Marshal(step.Config)
		retryExec.InputData = inputData

		if err := s.instanceRepo.CreateStepExecution(ctx, retryExec); err != nil {
			return fmt.Errorf("creating retry step execution: %w", err)
		}

		result, err := s.executors.Execute(ctx, inst, step, retryExec)
		if err != nil {
			if errors.Is(err, executor.ErrParked) {
				if result != nil && result.Output != nil {
					s.storeStepOutput(ctx, inst, step.ID, result.Output)
				}
				return nil
			}
			// Loop to handle this failed retry (bounded, no recursion).
			currentExec = retryExec
			currentErr = err
			continue
		}

		// Retry succeeded.
		retryCompletedAt := time.Now().UTC()
		retryExec.Status = model.StepStatusCompleted
		retryExec.CompletedAt = &retryCompletedAt
		if result != nil && result.Output != nil {
			outputData, _ := json.Marshal(result.Output)
			retryExec.OutputData = outputData
			s.storeStepOutput(ctx, inst, step.ID, result.Output)
		}
		_ = s.instanceRepo.UpdateStepExecution(ctx, retryExec)

		if result != nil && result.Parked {
			return nil
		}

		return s.advanceLocked(ctx, inst.ID, step.ID)
	}
}

// ResumeFromTask is called when a human task is completed, storing the form data
// as step output and advancing the workflow. It is a hot-path ENTRY, so it runs
// under the per-instance critical section — this is exactly the race the design
// calls out (a task resume racing a timer fire or a sibling approver).
func (s *EngineService) ResumeFromTask(ctx context.Context, task *model.HumanTask) error {
	return s.serializeTransition(ctx, task.InstanceID, func(ctx context.Context) error {
		return s.resumeFromTaskLocked(ctx, task)
	})
}

// resumeFromTaskLocked is the body of ResumeFromTask. The caller MUST already
// hold the per-instance critical section.
func (s *EngineService) resumeFromTaskLocked(ctx context.Context, task *model.HumanTask) error {
	// Load the instance.
	inst, err := s.instanceRepo.GetByID(ctx, task.TenantID, task.InstanceID)
	if err != nil {
		return fmt.Errorf("loading instance for task resume: %w", err)
	}

	if !inst.IsRunnable() {
		return fmt.Errorf("instance %s is not in a runnable state (status: %s)", inst.ID, inst.Status)
	}

	def, err := s.defRepo.GetByID(ctx, inst.TenantID, inst.DefinitionID)
	if err != nil {
		return fmt.Errorf("loading definition for task resume: %w", err)
	}
	// Re-stamp the transient at-rest classification from the definition so the
	// task's submitted form values (stored under the step id as step_outputs) are
	// encrypted at rest on this FIRST write. See executeStepLocked for why GetByID
	// alone is insufficient. No-op for legacy definitions.
	classifyInstanceFromDefinition(inst, def)
	step := findStep(def.Steps, task.StepID)
	if step == nil {
		return fmt.Errorf("step %s not found in definition %s", task.StepID, def.ID)
	}
	if step.Type == model.StepTypeApprovalChain {
		return s.resumeApprovalChain(ctx, inst, step, task)
	}

	// Store the task form_data as step output.
	if task.FormData != nil {
		s.storeStepOutput(ctx, inst, task.StepID, task.FormData)
	}

	// SINGLE-WINNER GUARD (completion side). Complete the RUNNING step execution for
	// this task's step, UNLESS a boundary event already CLAIMED it by flipping its
	// exec to 'cancelled'. In that case this completion LOST the single-winner race
	// and MUST no-op rather than advance from the original step (which would
	// double-advance past the boundary handler that is already running). This
	// mirrors the running-exec arbiter in fireBoundaryLocked.
	executions, err := s.instanceRepo.GetStepExecutions(ctx, inst.ID)
	if err == nil {
		for _, exec := range executions {
			if exec.StepID == task.StepID && exec.Status == model.StepStatusCancelled {
				s.logger.Info().
					Str("instance_id", inst.ID).
					Str("task_id", task.ID).
					Str("step_id", task.StepID).
					Msg("task completion found the step cancelled (lost race to boundary/sibling), ignoring")
				return nil
			}
		}
		for _, exec := range executions {
			if exec.StepID == task.StepID && exec.Status == model.StepStatusRunning {
				completedAt := time.Now().UTC()
				exec.Status = model.StepStatusCompleted
				exec.CompletedAt = &completedAt
				if task.FormData != nil {
					outputData, _ := json.Marshal(task.FormData)
					exec.OutputData = outputData
				}
				_ = s.instanceRepo.UpdateStepExecution(ctx, exec)
				break
			}
		}
	}

	s.logger.Info().
		Str("instance_id", inst.ID).
		Str("task_id", task.ID).
		Str("step_id", task.StepID).
		Msg("resuming workflow from completed task")

	// Advance workflow from the task's step (already inside the critical section).
	return s.advanceLocked(ctx, inst.ID, task.StepID)
}

func (s *EngineService) resumeApprovalChain(ctx context.Context, inst *model.WorkflowInstance, step *model.StepDefinition, task *model.HumanTask) error {
	cfg, err := executor.ParseApprovalConfig(step.Config)
	if err != nil {
		return fmt.Errorf("parsing approval chain config for step %s: %w", step.ID, err)
	}

	tasks, err := s.taskRepo.ListByInstanceStep(ctx, inst.TenantID, inst.ID, step.ID)
	if err != nil {
		return fmt.Errorf("loading approval chain tasks: %w", err)
	}
	decisions := approvalDecisionsFromTasks(cfg, tasks)

	// Separation-of-duties: when the chain opts in via
	// require_distinct_approvers, reject a decision whose actor already decided a
	// prior step/tier of this same chain instead of silently advancing. Default
	// (flag off) keeps behaviour byte-for-byte unchanged for every other suite.
	if actor, conflict := executor.DistinctApproverConflict(cfg, decisions); conflict {
		s.logger.Warn().
			Str("instance_id", inst.ID).
			Str("task_id", task.ID).
			Str("step_id", step.ID).
			Str("conflicting_actor", actor).
			Msg("approval chain rejected: distinct-approver (separation-of-duties) conflict")
		return fmt.Errorf("%w (actor %s, step %s)", executor.ErrDistinctApproverConflict, actor, step.ID)
	}

	resolution := executor.ResolveApproval(cfg, decisions)
	output := approvalChainOutput(cfg, decisions, resolution)

	s.logger.Info().
		Str("instance_id", inst.ID).
		Str("task_id", task.ID).
		Str("step_id", step.ID).
		Str("resolution", string(resolution)).
		Interface("decision_counts", executor.SummarizeDecisions(decisions)).
		Msg("approval chain task resolved")

	if resolution == executor.ResolutionWait {
		s.storeStepOutput(ctx, inst, step.ID, output)
		if next, idx, ok := executor.NextSequentialApprover(cfg, decisions); ok && !approvalTaskExistsForIndex(tasks, idx) {
			return s.createSequentialApprovalTask(ctx, inst, step, task.StepExecID, cfg, next, idx)
		}
		return nil
	}

	if err := s.taskRepo.CancelOpenByInstanceStep(ctx, inst.ID, step.ID); err != nil {
		return fmt.Errorf("cancelling unresolved approval tasks: %w", err)
	}
	s.storeStepOutput(ctx, inst, step.ID, output)
	// SINGLE-WINNER GUARD (approval-chain completion side): only advance if we
	// actually claimed the RUNNING step-exec. If a boundary event interrupted the
	// approval-chain step first, its exec is already cancelled; this resolution
	// lost the race and MUST no-op rather than advance from the chain step.
	found, err := s.completeRunningStepExecutionFound(ctx, inst.ID, step.ID, output)
	if err != nil {
		return err
	}
	if !found {
		s.logger.Info().
			Str("instance_id", inst.ID).
			Str("task_id", task.ID).
			Str("step_id", step.ID).
			Msg("approval chain resolution found no running step-exec (lost race to boundary/sibling), ignoring")
		return nil
	}
	// Already inside the per-instance critical section (via ResumeFromTask).
	return s.advanceLocked(ctx, inst.ID, step.ID)
}

func (s *EngineService) createSequentialApprovalTask(ctx context.Context, inst *model.WorkflowInstance, step *model.StepDefinition, stepExecID string, cfg executor.ApprovalConfig, approver executor.Approver, approverIdx int) error {
	var assigneeID *string
	var assigneeRole *string
	switch {
	case approver.IsRole():
		role := approver.Ref
		assigneeRole = &role
	case approver.IsUser():
		ref := approver.Ref
		if strings.Contains(ref, "${") {
			resolved, err := s.resolver.Resolve(ref, s.buildExpressionContext(inst))
			if err != nil {
				return fmt.Errorf("resolving sequential approver ref %q: %w", ref, err)
			}
			ref = fmt.Sprintf("%v", resolved)
		}
		assigneeID = &ref
	default:
		return fmt.Errorf("approver %d has invalid type %q", approverIdx, approver.Type)
	}

	description := step.Name
	if desc, _ := step.Config["description"].(string); strings.TrimSpace(desc) != "" {
		if resolved, err := s.resolver.Resolve(desc, s.buildExpressionContext(inst)); err == nil {
			description = fmt.Sprintf("%v", resolved)
		}
	}

	var slaDeadline *time.Time
	if cfg.SLA > 0 {
		d := time.Now().UTC().Add(cfg.SLA)
		slaDeadline = &d
	}

	now := time.Now().UTC()
	newTask := &model.HumanTask{
		ID:           generateUUID(),
		TenantID:     inst.TenantID,
		InstanceID:   inst.ID,
		StepID:       step.ID,
		StepExecID:   stepExecID,
		Name:         step.Name,
		Description:  description,
		Status:       model.TaskStatusPending,
		AssigneeID:   assigneeID,
		AssigneeRole: assigneeRole,
		FormSchema: []model.FormField{
			{Name: "decision", Type: "select", Label: "Decision", Required: true, Options: []string{executor.DecisionApprove, executor.DecisionReject}},
			{Name: "comment", Type: "textarea", Label: "Comment"},
		},
		FormData:    map[string]interface{}{},
		SLADeadline: slaDeadline,
		Priority:    approvalPriority(inst.Variables),
		Metadata: map[string]interface{}{
			"workflow_instance_id": inst.ID,
			"workflow_definition":  inst.DefinitionID,
			"definition_version":   inst.DefinitionVer,
			"step_id":              step.ID,
			"step_execution_id":    stepExecID,
			"approval_chain":       true,
			"approver_index":       approverIdx,
			"approver_total":       len(cfg.Approvers),
			"approver_type":        approver.Type,
			"approval_mode":        cfg.Mode,
			"approval_quorum":      cfg.Quorum,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if cfg.Quorum == executor.QuorumNofM {
		newTask.Metadata["approval_quorum_n"] = cfg.QuorumN
	}

	if err := s.taskRepo.Create(ctx, newTask); err != nil {
		return fmt.Errorf("creating sequential approval task: %w", err)
	}
	s.publishEvent(ctx, "workflow.task.created", inst.TenantID, map[string]interface{}{
		"task_id":         newTask.ID,
		"instance_id":     newTask.InstanceID,
		"step_id":         newTask.StepID,
		"task_name":       newTask.Name,
		"approval_chain":  true,
		"approver_index":  approverIdx,
		"approval_mode":   cfg.Mode,
		"approval_quorum": cfg.Quorum,
	})
	return nil
}

func (s *EngineService) completeRunningStepExecution(ctx context.Context, instanceID, stepID string, output map[string]interface{}) error {
	found, err := s.completeRunningStepExecutionFound(ctx, instanceID, stepID, output)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("running step execution not found for step %s", stepID)
	}
	return nil
}

// completeRunningStepExecutionFound flips the RUNNING step-execution for
// (instance, step) to completed with the given output, and reports whether the
// completion should proceed to advance. It returns proceed=false ONLY when a
// boundary event has already CLAIMED this step (an exec flipped to 'cancelled') —
// that is the single-winner loss and the caller MUST NOT advance. A step-exec that
// is already 'completed' (the benign parked-leaf pattern where a composition step
// marks its exec completed while it parks, or a benign replay) is NOT a race loss:
// proceed=true so the caller advances exactly as before. This preserves the legacy
// composition park/advance behaviour while adding the boundary single-winner guard.
func (s *EngineService) completeRunningStepExecutionFound(ctx context.Context, instanceID, stepID string, output map[string]interface{}) (proceed bool, err error) {
	executions, err := s.instanceRepo.GetStepExecutions(ctx, instanceID)
	if err != nil {
		return false, fmt.Errorf("loading step executions: %w", err)
	}
	// A boundary interruption sets the step-exec to 'cancelled'. If any exec for
	// this step is cancelled, a boundary won the single-winner race: no-op.
	for _, exec := range executions {
		if exec.StepID == stepID && exec.Status == model.StepStatusCancelled {
			return false, nil
		}
	}
	outputData, _ := json.Marshal(output)
	for _, exec := range executions {
		if exec.StepID == stepID && exec.Status == model.StepStatusRunning {
			completedAt := time.Now().UTC()
			exec.Status = model.StepStatusCompleted
			exec.CompletedAt = &completedAt
			exec.OutputData = outputData
			if err := s.instanceRepo.UpdateStepExecution(ctx, exec); err != nil {
				return false, fmt.Errorf("completing step execution: %w", err)
			}
			return true, nil
		}
	}
	// No running exec and no cancellation: the step-exec is already completed (a
	// parked composition leaf or a benign replay). Proceed to advance as before.
	return true, nil
}

// RetryInstance retries a failed workflow instance from its last failed step.
func (s *EngineService) RetryInstance(ctx context.Context, tenantID, instanceID string) error {
	inst, err := s.instanceRepo.GetByID(ctx, tenantID, instanceID)
	if err != nil {
		return fmt.Errorf("loading instance for retry: %w", err)
	}

	if inst.Status != model.InstanceStatusFailed {
		return fmt.Errorf("only failed instances can be retried, current status: %s", inst.Status)
	}

	// Find the last failed step.
	failedStep, err := s.instanceRepo.GetLastFailedStep(ctx, instanceID)
	if err != nil {
		return fmt.Errorf("finding last failed step: %w", err)
	}
	if failedStep == nil {
		return fmt.Errorf("no failed step found for instance %s", instanceID)
	}

	// Reset instance to running.
	inst.Status = model.InstanceStatusRunning
	inst.ErrorMessage = nil
	inst.CurrentStepID = &failedStep.StepID
	inst.UpdatedAt = time.Now().UTC()

	// Commit the running (retry) state AND its audit event atomically (or legacy
	// commit + direct publish when the atomic capability is not wired).
	if err := s.commitInstanceLifecycle(ctx, inst, nil, "workflow.instance.retried", map[string]interface{}{
		"instance_id": instanceID,
		"step_id":     failedStep.StepID,
	}); err != nil {
		return fmt.Errorf("resetting instance to running: %w", err)
	}

	s.logger.Info().
		Str("instance_id", instanceID).
		Str("retry_step_id", failedStep.StepID).
		Msg("retrying failed workflow instance")

	// Load definition and re-execute from failed step.
	def, err := s.defRepo.GetByID(ctx, inst.TenantID, inst.DefinitionID)
	if err != nil {
		return fmt.Errorf("loading definition for retry: %w", err)
	}

	return s.executeStep(ctx, inst, def, failedStep.StepID)
}

// CancelInstance cancels a running or suspended workflow instance and all pending tasks.
func (s *EngineService) CancelInstance(ctx context.Context, tenantID, instanceID string) error {
	inst, err := s.instanceRepo.GetByID(ctx, tenantID, instanceID)
	if err != nil {
		return fmt.Errorf("loading instance for cancellation: %w", err)
	}

	if inst.IsTerminal() {
		return fmt.Errorf("cannot cancel instance in terminal state: %s", inst.Status)
	}

	now := time.Now().UTC()
	inst.Status = model.InstanceStatusCancelled
	inst.CompletedAt = &now
	inst.UpdatedAt = now

	// Commit the cancelled state AND its audit event atomically (or legacy commit +
	// direct publish when the atomic capability is not wired).
	if err := s.commitInstanceLifecycle(ctx, inst, nil, "workflow.instance.cancelled", map[string]interface{}{
		"instance_id": instanceID,
	}); err != nil {
		return fmt.Errorf("cancelling instance: %w", err)
	}

	// Cancel any pending tasks for this instance (best-effort, distinct concern
	// from the state+audit commit above).
	if err := s.taskRepo.CancelByInstance(ctx, instanceID); err != nil {
		s.logger.Error().Err(err).
			Str("instance_id", instanceID).
			Msg("failed to cancel pending tasks")
	}

	s.logger.Info().
		Str("instance_id", instanceID).
		Str("tenant_id", tenantID).
		Msg("workflow instance cancelled")

	return nil
}

// SuspendInstance suspends a running workflow instance.
func (s *EngineService) SuspendInstance(ctx context.Context, tenantID, instanceID string) error {
	inst, err := s.instanceRepo.GetByID(ctx, tenantID, instanceID)
	if err != nil {
		return fmt.Errorf("loading instance for suspension: %w", err)
	}

	if inst.Status != model.InstanceStatusRunning {
		return fmt.Errorf("only running instances can be suspended, current status: %s", inst.Status)
	}

	inst.Status = model.InstanceStatusSuspended
	inst.UpdatedAt = time.Now().UTC()

	// Commit the suspended state AND its audit event atomically (or legacy commit +
	// direct publish when the atomic capability is not wired).
	if err := s.commitInstanceLifecycle(ctx, inst, nil, "workflow.instance.suspended", map[string]interface{}{
		"instance_id": instanceID,
	}); err != nil {
		return fmt.Errorf("suspending instance: %w", err)
	}

	s.logger.Info().
		Str("instance_id", instanceID).
		Str("tenant_id", tenantID).
		Msg("workflow instance suspended")

	return nil
}

// ResumeInstance resumes a suspended workflow instance and continues execution.
func (s *EngineService) ResumeInstance(ctx context.Context, tenantID, instanceID string) error {
	inst, err := s.instanceRepo.GetByID(ctx, tenantID, instanceID)
	if err != nil {
		return fmt.Errorf("loading instance for resume: %w", err)
	}

	if inst.Status != model.InstanceStatusSuspended {
		return fmt.Errorf("only suspended instances can be resumed, current status: %s", inst.Status)
	}

	inst.Status = model.InstanceStatusRunning
	inst.UpdatedAt = time.Now().UTC()

	// Commit the resumed state AND its audit event atomically (or legacy commit +
	// direct publish when the atomic capability is not wired).
	if err := s.commitInstanceLifecycle(ctx, inst, nil, "workflow.instance.resumed", map[string]interface{}{
		"instance_id": instanceID,
	}); err != nil {
		return fmt.Errorf("resuming instance: %w", err)
	}

	s.logger.Info().
		Str("instance_id", instanceID).
		Str("tenant_id", tenantID).
		Msg("workflow instance resumed")

	// Continue from the current step if available.
	if inst.CurrentStepID != nil && *inst.CurrentStepID != "" {
		return s.AdvanceWorkflow(ctx, instanceID, *inst.CurrentStepID)
	}

	return nil
}

// GetHistory returns the step execution history for a workflow instance.
func (s *EngineService) GetHistory(ctx context.Context, tenantID, instanceID string) ([]*model.StepExecution, error) {
	// Verify the instance belongs to this tenant.
	_, err := s.instanceRepo.GetByID(ctx, tenantID, instanceID)
	if err != nil {
		return nil, fmt.Errorf("loading instance for history: %w", err)
	}

	executions, err := s.instanceRepo.GetStepExecutions(ctx, instanceID)
	if err != nil {
		return nil, fmt.Errorf("getting step executions: %w", err)
	}

	return executions, nil
}

// ListInstances returns a paginated list of workflow instances for a tenant.
func (s *EngineService) ListInstances(ctx context.Context, tenantID, status, definitionID, startedBy string, dateFrom, dateTo *time.Time, sortBy, sortOrder string, page, pageSize int) ([]*model.WorkflowInstance, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	limit := pageSize
	offset := (page - 1) * pageSize

	return s.instanceRepo.List(ctx, tenantID, status, definitionID, startedBy, dateFrom, dateTo, sortBy, sortOrder, limit, offset)
}

// GetInstance retrieves a single workflow instance.
func (s *EngineService) GetInstance(ctx context.Context, tenantID, instanceID string) (*model.WorkflowInstance, error) {
	inst, err := s.instanceRepo.GetByID(ctx, tenantID, instanceID)
	if err != nil {
		return nil, fmt.Errorf("getting workflow instance: %w", err)
	}
	return inst, nil
}

// completeInstance marks a workflow instance as completed.
func (s *EngineService) completeInstance(ctx context.Context, inst *model.WorkflowInstance, endStepID string) error {
	now := time.Now().UTC()

	// Create step execution for the end step.
	endExec := &model.StepExecution{
		ID:          generateUUID(),
		InstanceID:  inst.ID,
		StepID:      endStepID,
		StepType:    model.StepTypeEnd,
		Status:      model.StepStatusCompleted,
		Attempt:     1,
		StartedAt:   &now,
		CompletedAt: &now,
		CreatedAt:   now,
	}
	inst.Status = model.InstanceStatusCompleted
	inst.CurrentStepID = &endStepID
	inst.CompletedAt = &now
	inst.UpdatedAt = now

	// Commit the completed state AND its audit event atomically (end-step audit row
	// folded into the same tx when the atomic capability is wired); otherwise the
	// legacy CreateStepExecution + UpdateWithLock + direct publish path is used.
	if err := s.commitInstanceLifecycle(ctx, inst, endExec, "workflow.instance.completed", map[string]interface{}{
		"instance_id":   inst.ID,
		"definition_id": inst.DefinitionID,
		"initiator_id":  inst.StartedBy,
	}); err != nil {
		return fmt.Errorf("completing instance: %w", err)
	}

	s.logger.Info().
		Str("instance_id", inst.ID).
		Str("tenant_id", inst.TenantID).
		Str("definition_id", inst.DefinitionID).
		Msg("workflow instance completed")

	// COMPOSITION: if this completed instance was spawned by a parent
	// call_activity / multi_instance step, map its outputs back and resume the
	// parent. Fired after the child's own transition committed; acquires only the
	// PARENT's critical section (a distinct instance key), so it cannot deadlock
	// against the child lock held by the caller.
	if inst.HasParent() {
		s.onChildInstanceTerminal(ctx, inst, model.InstanceStatusCompleted, "")
	}

	return nil
}

// failInstance marks a workflow instance as failed with an error message.
func (s *EngineService) failInstance(ctx context.Context, inst *model.WorkflowInstance, errMsg string) error {
	now := time.Now().UTC()
	inst.Status = model.InstanceStatusFailed
	inst.ErrorMessage = &errMsg
	inst.CompletedAt = &now
	inst.UpdatedAt = now

	// Commit the failed state AND its audit event atomically (or legacy commit +
	// direct publish when the atomic capability is not wired).
	if err := s.commitInstanceLifecycle(ctx, inst, nil, "workflow.instance.failed", map[string]interface{}{
		"instance_id":  inst.ID,
		"error":        errMsg,
		"initiator_id": inst.StartedBy,
	}); err != nil {
		return fmt.Errorf("failing instance: %w", err)
	}

	s.logger.Error().
		Str("instance_id", inst.ID).
		Str("tenant_id", inst.TenantID).
		Str("error", errMsg).
		Msg("workflow instance failed")

	// COMPOSITION: propagate a child's failure to its parent call_activity /
	// multi_instance step (default policy fails the parent step, entering its own
	// retry/incident path). Acquires only the parent's critical section.
	if inst.HasParent() {
		s.onChildInstanceTerminal(ctx, inst, model.InstanceStatusFailed, errMsg)
	}

	return nil
}

// evaluateTransitions finds the first matching transition from a given step
// by evaluating each transition's condition against the instance context.
func (s *EngineService) evaluateTransitions(steps []model.StepDefinition, fromStepID string, inst *model.WorkflowInstance) (string, error) {
	step := findStep(steps, fromStepID)
	if step == nil {
		return "", fmt.Errorf("step %s not found in definition", fromStepID)
	}

	if len(step.Transitions) == 0 {
		return "", nil
	}

	exprCtx := s.buildExpressionContext(inst)

	for _, t := range step.Transitions {
		// Unconditional transition (no condition means always true).
		if t.Condition == "" {
			return t.Target, nil
		}

		// Evaluate the condition expression.
		result, err := s.evaluator.Evaluate(t.Condition, exprCtx)
		if err != nil {
			s.logger.Warn().Err(err).
				Str("instance_id", inst.ID).
				Str("step_id", fromStepID).
				Str("condition", t.Condition).
				Str("target", t.Target).
				Msg("failed to evaluate transition condition, skipping")
			continue
		}

		if result {
			return t.Target, nil
		}
	}

	// No condition matched; try to find a default (unconditional) transition.
	// This handles the case where conditional transitions are listed first,
	// followed by a fallback.
	return "", fmt.Errorf("no matching transition from step %s", fromStepID)
}

// buildExpressionContext constructs the data context map used for expression
// evaluation and variable resolution within a workflow instance.
func (s *EngineService) buildExpressionContext(inst *model.WorkflowInstance) map[string]interface{} {
	ctx := map[string]interface{}{
		"variables": inst.Variables,
		"steps":     inst.StepOutputs,
	}

	// Add trigger data.
	triggerData := make(map[string]interface{})
	if inst.TriggerData != nil {
		var td map[string]interface{}
		if err := json.Unmarshal(inst.TriggerData, &td); err == nil {
			triggerData = td
		}
	}
	ctx["trigger"] = map[string]interface{}{
		"data": triggerData,
	}

	return ctx
}

// classifyInstanceFromDefinition MERGES the definition-declared at-rest
// classification (SensitiveVariableKeys + classified variable defs + classified
// human-task form fields) into the instance's TRANSIENT SensitiveKeys set. It is
// idempotent and additive: it never removes a key already present (e.g. one
// re-derived from an existing at-rest envelope by the repository on read), so a
// value that was protected stays protected and a newly-classified value is
// protected on its FIRST write. A nil/empty classification is a no-op — the exact
// legacy plaintext path — so every existing definition and test double is
// unaffected.
func classifyInstanceFromDefinition(inst *model.WorkflowInstance, def *model.WorkflowDefinition) {
	if inst == nil || def == nil {
		return
	}
	keys := def.ClassifiedVariableKeys()
	if len(keys) == 0 {
		return
	}
	if inst.SensitiveKeys == nil {
		inst.SensitiveKeys = make(map[string]bool, len(keys))
	}
	for k := range keys {
		inst.SensitiveKeys[k] = true
	}
}

// storeStepOutput stores the output of a step execution in the instance's step outputs map.
func (s *EngineService) storeStepOutput(ctx context.Context, inst *model.WorkflowInstance, stepID string, output map[string]interface{}) {
	if inst.StepOutputs == nil {
		inst.StepOutputs = make(map[string]interface{})
	}
	inst.StepOutputs[stepID] = map[string]interface{}{
		"output": output,
	}
	inst.UpdatedAt = time.Now().UTC()

	if err := s.instanceRepo.UpdateWithLock(ctx, inst); err != nil {
		s.logger.Error().Err(err).
			Str("instance_id", inst.ID).
			Str("step_id", stepID).
			Msg("failed to store step output")
	}
}

// resolveInitialVariables builds the initial variable map for a new instance
// by combining defaults, input overrides, and trigger data.
func (s *EngineService) resolveInitialVariables(
	defs map[string]model.VariableDef,
	inputVars map[string]interface{},
	triggerData json.RawMessage,
) map[string]interface{} {
	result := make(map[string]interface{})

	// Parse trigger data.
	var td map[string]interface{}
	if triggerData != nil {
		_ = json.Unmarshal(triggerData, &td)
	}

	for name, def := range defs {
		// Start with default value.
		if def.Default != nil {
			result[name] = def.Default
		}

		// Override with trigger data if source is specified.
		if def.Source != "" && td != nil {
			if val, ok := td[def.Source]; ok {
				result[name] = val
			}
		}

		// Override with explicitly provided input variables.
		if inputVars != nil {
			if val, ok := inputVars[name]; ok {
				result[name] = val
			}
		}
	}

	// Also include any input variables not declared in the definition.
	for name, val := range inputVars {
		if _, exists := result[name]; !exists {
			result[name] = val
		}
	}

	return result
}

// commitInstanceLifecycle commits an instance LIFECYCLE state transition and emits
// its workflow.* audit event. When the repository supports the atomic
// lifecycleCommitter capability, the state UPDATE (plus an optional endStepExec
// audit row) and the audit event are staged in ONE transaction via the outbox, so
// the event commits atomically with the state and the relay delivers it
// exactly-once to platform.workflow.events (a committed transition can no longer
// lose its audit event when the broker is down). Absent that capability (test
// doubles / un-migrated deployments), it falls back to the historical path:
// (optional) CreateStepExecution, UpdateWithLock, then a best-effort direct
// publishEvent — byte-for-byte the previous behaviour.
//
// The event is built with the SAME events.NewEvent(eventType, "workflow-engine",
// ...) shape publishEvent uses, so event names/shapes are unchanged and the
// audit-service consumer maps them exactly as before. There is NO double-emit: the
// atomic path stages the event and does NOT also direct-publish it.
//
// endStepExec is the OPTIONAL end-step audit row (only completeInstance passes it);
// nil for the other lifecycle transitions.
func (s *EngineService) commitInstanceLifecycle(ctx context.Context, inst *model.WorkflowInstance, endStepExec *model.StepExecution, eventType string, data map[string]interface{}) error {
	// Atomic path: stage the audit event in the same tx as the state commit. This
	// is INDEPENDENT of s.producer — staging is a local INSERT that the relay drains
	// later, so a committed transition durably records its audit event even if no
	// bus producer is configured (whereas the legacy publishEvent no-ops when the
	// producer is nil, which is exactly the loss this closes).
	if s.lifecycleTx != nil {
		evt, err := events.NewEvent(eventType, "workflow-engine", inst.TenantID, data)
		if err != nil {
			// A malformed event must not be silently dropped while state is committed
			// out of band. Fail the transition so nothing is persisted and the caller
			// surfaces the error (fail-closed: no committed state without its audit).
			return fmt.Errorf("building %s audit event: %w", eventType, err)
		}
		if err := s.lifecycleTx.CommitInstanceStateWithEvent(ctx, inst, endStepExec, events.Topics.WorkflowEvents, evt); err != nil {
			return err
		}
		return nil
	}

	// Legacy fallback: (optional end-step row) + state commit + best-effort publish.
	if endStepExec != nil {
		if err := s.instanceRepo.CreateStepExecution(ctx, endStepExec); err != nil {
			s.logger.Error().Err(err).
				Str("instance_id", inst.ID).
				Msg("failed to create lifecycle step execution")
		}
	}
	if err := s.instanceRepo.UpdateWithLock(ctx, inst); err != nil {
		return err
	}
	s.publishEvent(ctx, eventType, inst.TenantID, data)
	return nil
}

// publishEvent publishes a workflow event if a producer is configured.
func (s *EngineService) publishEvent(ctx context.Context, eventType, tenantID string, data interface{}) {
	if s.producer == nil {
		return
	}

	evt, err := events.NewEvent(eventType, "workflow-engine", tenantID, data)
	if err != nil {
		s.logger.Error().Err(err).
			Str("event_type", eventType).
			Str("tenant_id", tenantID).
			Msg("failed to create workflow event")
		return
	}

	if err := s.producer.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		s.logger.Error().Err(err).
			Str("event_type", eventType).
			Str("tenant_id", tenantID).
			Msg("failed to publish workflow event")
	}
}

// findStep looks up a step definition by ID within a slice.
func findStep(steps []model.StepDefinition, id string) *model.StepDefinition {
	for i := range steps {
		if steps[i].ID == id {
			return &steps[i]
		}
	}
	return nil
}

func approvalDecisionsFromTasks(cfg executor.ApprovalConfig, tasks []*model.HumanTask) []executor.ApproverDecision {
	byIndex := make(map[int]*model.HumanTask, len(tasks))
	for _, task := range tasks {
		idx, ok := approvalTaskIndex(task)
		if !ok || idx < 0 || idx >= len(cfg.Approvers) {
			continue
		}
		if existing, exists := byIndex[idx]; !exists || approvalTaskHasDecision(task) || !approvalTaskHasDecision(existing) {
			byIndex[idx] = task
		}
	}

	decisions := make([]executor.ApproverDecision, 0, len(cfg.Approvers))
	for i, approver := range cfg.Approvers {
		decision := executor.ApproverDecision{Approver: approver}
		if task := byIndex[i]; task != nil {
			decision.Decision = approvalTaskDecision(task)
			if task.ClaimedBy != nil {
				decision.DecidedBy = *task.ClaimedBy
			}
			if task.CompletedAt != nil {
				decision.DecidedAt = *task.CompletedAt
			}
		}
		decisions = append(decisions, decision)
	}
	return decisions
}

func approvalChainOutput(cfg executor.ApprovalConfig, decisions []executor.ApproverDecision, resolution executor.Resolution) map[string]interface{} {
	counts := executor.SummarizeDecisions(decisions)
	result := "pending"
	if resolution == executor.ResolutionAdvance {
		result = "approved"
	} else if resolution == executor.ResolutionReject {
		result = "rejected"
	}

	decisionRows := make([]map[string]interface{}, 0, len(decisions))
	for i, d := range decisions {
		row := map[string]interface{}{
			"approver_index": i,
			"approver_type":  d.Approver.Type,
			"approver_ref":   d.Approver.Ref,
			"decision":       d.Decision,
		}
		if d.DecidedBy != "" {
			row["decided_by"] = d.DecidedBy
		}
		if !d.DecidedAt.IsZero() {
			row["decided_at"] = d.DecidedAt.Format(time.RFC3339)
		}
		decisionRows = append(decisionRows, row)
	}

	out := map[string]interface{}{
		"approval_result":     result,
		"approval_resolution": string(resolution),
		"approval_mode":       cfg.Mode,
		"approval_quorum":     cfg.Quorum,
		"approver_count":      len(cfg.Approvers),
		"approvals":           counts[executor.DecisionApprove],
		"rejections":          counts[executor.DecisionReject],
		"pending":             counts[""],
		"decisions":           decisionRows,
	}
	if cfg.Quorum == executor.QuorumNofM {
		out["approval_quorum_n"] = cfg.QuorumN
	}
	return out
}

func approvalTaskExistsForIndex(tasks []*model.HumanTask, idx int) bool {
	for _, task := range tasks {
		taskIdx, ok := approvalTaskIndex(task)
		if ok && taskIdx == idx && task.Status != model.TaskStatusCancelled {
			return true
		}
	}
	return false
}

func approvalTaskIndex(task *model.HumanTask) (int, bool) {
	if task == nil || task.Metadata == nil {
		return 0, false
	}
	switch v := task.Metadata["approver_index"].(type) {
	case int:
		return v, true
	case int64:
		return int(v), true
	case float64:
		return int(v), true
	case json.Number:
		i, err := v.Int64()
		return int(i), err == nil
	default:
		return 0, false
	}
}

func approvalTaskHasDecision(task *model.HumanTask) bool {
	return approvalTaskDecision(task) != ""
}

func approvalTaskDecision(task *model.HumanTask) string {
	if task == nil {
		return ""
	}
	if task.Status == model.TaskStatusRejected {
		return executor.DecisionReject
	}
	if task.Status != model.TaskStatusCompleted {
		return ""
	}
	if task.FormData == nil {
		return ""
	}
	decision, _ := task.FormData["decision"].(string)
	decision = strings.ToLower(strings.TrimSpace(decision))
	switch decision {
	case executor.DecisionApprove, executor.DecisionReject:
		return decision
	default:
		return ""
	}
}

func approvalPriority(vars map[string]interface{}) int {
	if vars == nil {
		return 0
	}
	switch v := vars["priority"].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		i, _ := v.Int64()
		return int(i)
	default:
		return 0
	}
}
