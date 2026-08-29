package service

import (
	"context"
	"crypto/rand"
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

// definitionRepo defines the persistence operations for workflow definitions.
type definitionRepo interface {
	Create(ctx context.Context, def *model.WorkflowDefinition) error
	GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowDefinition, error)
	GetActiveByID(ctx context.Context, tenantID, id string) (*model.WorkflowDefinition, error)
	List(ctx context.Context, tenantID, status, nameFilter, category, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowDefinition, int, error)
	ListVersions(ctx context.Context, tenantID, id string) ([]*model.WorkflowDefinition, error)
	Update(ctx context.Context, def *model.WorkflowDefinition) error
	SoftDelete(ctx context.Context, tenantID, id string) error
	GetMaxVersion(ctx context.Context, tenantID, name string) (int, error)
	GetActiveByTriggerTopic(ctx context.Context, topic string) ([]*model.WorkflowDefinition, error)
}

// immutabilityGuard reports whether a definition version is immutable (promoted
// to staging or prod) and may not be mutated. It returns ErrConflict (→409) when
// the version is locked. *PromotionService satisfies this contract; it is
// installed via SetImmutableGuard so NewDefinitionService keeps its signature.
type immutabilityGuard interface {
	ImmutableGuard(ctx context.Context, tenantID, defID string) error
}

// DefinitionService manages the lifecycle of workflow definitions including
// creation, versioning, activation, validation, and soft-deletion.
type DefinitionService struct {
	repo           definitionRepo
	immutableGuard immutabilityGuard
	logger         zerolog.Logger

	// auditPublisher is the OPTIONAL emitter for definition-lifecycle audit events
	// (create/update/activate/archive). GAP B: these transitions previously only
	// LOGGED. When wired, each emits an event to platform.workflow.events, where the
	// platform hash-chain audit subsystem records it as a tamper-evident entry. nil
	// == unchanged legacy behaviour, so existing callers/tests are unaffected.
	auditPublisher eventPublisher
}

// NewDefinitionService creates a new DefinitionService.
func NewDefinitionService(repo definitionRepo, logger zerolog.Logger) *DefinitionService {
	return &DefinitionService{
		repo:   repo,
		logger: logger.With().Str("service", "workflow-definition").Logger(),
	}
}

// WithAuditPublisher wires the OPTIONAL definition-lifecycle audit emitter (GAP B)
// and returns the receiver for chaining. A nil publisher is a no-op.
func (s *DefinitionService) WithAuditPublisher(p eventPublisher) *DefinitionService {
	s.auditPublisher = p
	return s
}

// emitAudit publishes a definition-lifecycle audit event when a publisher is
// wired. Best-effort: an emit failure is logged, never failing the operation.
func (s *DefinitionService) emitAudit(ctx context.Context, eventType, tenantID string, data map[string]interface{}) {
	if s.auditPublisher == nil {
		return
	}
	evt, err := events.NewEvent(eventType, "workflow-engine", tenantID, data)
	if err != nil {
		s.logger.Error().Err(err).Str("event_type", eventType).Msg("failed to build definition audit event")
		return
	}
	if err := s.auditPublisher.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		s.logger.Error().Err(err).Str("event_type", eventType).Msg("failed to publish definition audit event")
	}
}

// SetImmutableGuard installs the optional promotion immutability guard (WP-4).
// When set, Update and Archive reject a mutation of a promoted (immutable)
// version with ErrConflict before any change is made. When unset, the lifecycle
// behaves exactly as before.
func (s *DefinitionService) SetImmutableGuard(g immutabilityGuard) {
	s.immutableGuard = g
}

// guardImmutable runs the installed immutability guard, if any. A nil guard (or
// the guard's own "not found" surfaces via the normal repo path) is a no-op so
// the lifecycle is unchanged when promotion is not wired.
func (s *DefinitionService) guardImmutable(ctx context.Context, tenantID, id string) error {
	if s.immutableGuard == nil {
		return nil
	}
	return s.immutableGuard.ImmutableGuard(ctx, tenantID, id)
}

// Create creates a new workflow definition in draft status with version 1.
func (s *DefinitionService) Create(ctx context.Context, tenantID, userID string, req dto.CreateDefinitionRequest) (*model.WorkflowDefinition, error) {
	// Validate name constraints.
	if req.Name == "" {
		return nil, fmt.Errorf("workflow definition name is required")
	}
	if len(req.Name) > 200 {
		return nil, fmt.Errorf("workflow definition name must not exceed 200 characters")
	}

	now := time.Now().UTC()
	def := &model.WorkflowDefinition{
		ID:            generateUUID(),
		TenantID:      tenantID,
		Name:          req.Name,
		Description:   req.Description,
		Category:      req.Category,
		Version:       1,
		Status:        model.DefinitionStatusDraft,
		DefinitionKey: generateUUID(),
		TriggerConfig: req.TriggerConfig,
		Variables:     req.Variables,
		Steps:         req.Steps,
		CreatedBy:     userID,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if def.Variables == nil {
		def.Variables = make(map[string]model.VariableDef)
	}
	if def.Steps == nil {
		def.Steps = []model.StepDefinition{}
	}

	if err := s.repo.Create(ctx, def); err != nil {
		s.logger.Error().Err(err).
			Str("tenant_id", tenantID).
			Str("name", req.Name).
			Msg("failed to create workflow definition")
		return nil, fmt.Errorf("creating workflow definition: %w", err)
	}

	s.logger.Info().
		Str("id", def.ID).
		Str("tenant_id", tenantID).
		Str("name", def.Name).
		Int("version", def.Version).
		Msg("workflow definition created")

	s.emitAudit(ctx, "workflow.definition.created", tenantID, map[string]interface{}{
		"definition_id":  def.ID,
		"definition_key": def.DefinitionKey,
		"name":           def.Name,
		"version":        def.Version,
		"created_by":     userID,
	})

	return def, nil
}

// GetByID retrieves a workflow definition by tenant and definition ID.
func (s *DefinitionService) GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	def, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return nil, fmt.Errorf("getting workflow definition: %w", err)
	}
	return def, nil
}

// List returns a paginated list of workflow definitions for a tenant,
// optionally filtered by status (comma-separated for multiple), category,
// and name substring. Supports sortBy column and sortOrder (asc/desc).
func (s *DefinitionService) List(ctx context.Context, tenantID, status, nameFilter, category, sortBy, sortOrder string, page, pageSize int) ([]*model.WorkflowDefinition, int, error) {
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

	defs, total, err := s.repo.List(ctx, tenantID, status, nameFilter, category, sortBy, sortOrder, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("listing workflow definitions: %w", err)
	}
	return defs, total, nil
}

// Update creates a NEW version of an existing workflow definition.
// The old version is deprecated and a new record is created with version+1.
func (s *DefinitionService) Update(ctx context.Context, tenantID, id, userID string, req dto.UpdateDefinitionRequest) (*model.WorkflowDefinition, error) {
	// WP-4: reject editing a promoted (immutable) version before any work.
	if err := s.guardImmutable(ctx, tenantID, id); err != nil {
		return nil, err
	}

	// Fetch the current definition.
	current, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return nil, fmt.Errorf("getting current definition for update: %w", err)
	}

	// Validate name if provided.
	if req.Name != nil {
		if *req.Name == "" {
			return nil, fmt.Errorf("workflow definition name cannot be empty")
		}
		if len(*req.Name) > 200 {
			return nil, fmt.Errorf("workflow definition name must not exceed 200 characters")
		}
	}

	// Get the max version for this definition lineage to ensure monotonic
	// versioning even if the display name changes between versions.
	maxVersion, err := s.repo.GetMaxVersion(ctx, tenantID, current.DefinitionKey)
	if err != nil {
		return nil, fmt.Errorf("getting max version: %w", err)
	}

	// Build the new version by cloning the current and applying updates.
	now := time.Now().UTC()
	newDef := &model.WorkflowDefinition{
		ID:            generateUUID(),
		TenantID:      tenantID,
		Name:          current.Name,
		Description:   current.Description,
		Category:      current.Category,
		Version:       maxVersion + 1,
		Status:        model.DefinitionStatusDraft,
		DefinitionKey: current.DefinitionKey,
		TriggerConfig: current.TriggerConfig,
		Variables:     current.Variables,
		Steps:         current.Steps,
		CreatedBy:     current.CreatedBy,
		UpdatedBy:     userID,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	// Apply provided updates.
	if req.Name != nil {
		newDef.Name = *req.Name
	}
	if req.Description != nil {
		newDef.Description = *req.Description
	}
	if req.Category != nil {
		newDef.Category = *req.Category
	}
	if req.TriggerConfig != nil {
		newDef.TriggerConfig = *req.TriggerConfig
	}
	if req.Variables != nil {
		newDef.Variables = req.Variables
	}
	if req.Steps != nil {
		newDef.Steps = req.Steps
	}

	// Create the new version.
	if err := s.repo.Create(ctx, newDef); err != nil {
		return nil, fmt.Errorf("creating new definition version: %w", err)
	}

	// Deprecate the old version.
	current.Status = model.DefinitionStatusDeprecated
	current.UpdatedAt = now
	current.UpdatedBy = userID
	if err := s.repo.Update(ctx, current); err != nil {
		s.logger.Error().Err(err).
			Str("old_id", current.ID).
			Msg("failed to deprecate old definition version")
		// The new version was already created; log but do not fail.
	}

	s.logger.Info().
		Str("id", newDef.ID).
		Str("old_id", current.ID).
		Str("tenant_id", tenantID).
		Int("version", newDef.Version).
		Msg("workflow definition updated (new version created)")

	s.emitAudit(ctx, "workflow.definition.updated", tenantID, map[string]interface{}{
		"definition_id":    newDef.ID,
		"previous_id":      current.ID,
		"definition_key":   newDef.DefinitionKey,
		"name":             newDef.Name,
		"version":          newDef.Version,
		"previous_version": current.Version,
		"updated_by":       userID,
	})

	return newDef, nil
}

// Activate validates a definition and sets its status to active.
// Only draft definitions can be activated.
func (s *DefinitionService) Activate(ctx context.Context, tenantID, id string) error {
	def, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return fmt.Errorf("getting definition for activation: %w", err)
	}

	if def.Status != model.DefinitionStatusDraft {
		return fmt.Errorf("only draft definitions can be activated, current status: %s: %w", def.Status, model.ErrConflict)
	}

	// Run full validation. On failure, return a structured error that carries the
	// full list of validation problems so the handler can surface them in the 400
	// response body (the UI renders them inline, not just as a toast).
	validationErrors := s.ValidateDefinition(def)
	if len(validationErrors) > 0 {
		return &ValidationFailedError{Errors: validationErrors}
	}

	now := time.Now().UTC()
	def.Status = model.DefinitionStatusActive
	def.UpdatedAt = now
	def.PublishedAt = &now

	if err := s.repo.Update(ctx, def); err != nil {
		return fmt.Errorf("activating definition: %w", err)
	}

	s.logger.Info().
		Str("id", def.ID).
		Str("tenant_id", tenantID).
		Str("name", def.Name).
		Msg("workflow definition activated")

	s.emitAudit(ctx, "workflow.definition.activated", tenantID, map[string]interface{}{
		"definition_id":  def.ID,
		"definition_key": def.DefinitionKey,
		"name":           def.Name,
		"version":        def.Version,
	})

	return nil
}

// Archive validates that the definition is active and sets its status to archived.
func (s *DefinitionService) Archive(ctx context.Context, tenantID, id string) error {
	// WP-4: reject archiving a promoted (immutable) version before any work.
	if err := s.guardImmutable(ctx, tenantID, id); err != nil {
		return err
	}

	def, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return fmt.Errorf("getting definition for archiving: %w", err)
	}

	if def.Status != model.DefinitionStatusActive {
		return fmt.Errorf("only active definitions can be archived, current status: %s: %w", def.Status, model.ErrConflict)
	}

	def.Status = model.DefinitionStatusArchived
	def.UpdatedAt = time.Now().UTC()

	if err := s.repo.Update(ctx, def); err != nil {
		return fmt.Errorf("archiving definition: %w", err)
	}

	s.logger.Info().
		Str("id", def.ID).
		Str("tenant_id", tenantID).
		Str("name", def.Name).
		Msg("workflow definition archived")

	s.emitAudit(ctx, "workflow.definition.archived", tenantID, map[string]interface{}{
		"definition_id":  def.ID,
		"definition_key": def.DefinitionKey,
		"name":           def.Name,
		"version":        def.Version,
	})

	return nil
}

// Clone creates a copy of an existing workflow definition in draft status with version 1.
func (s *DefinitionService) Clone(ctx context.Context, tenantID, id, userID string) (*model.WorkflowDefinition, error) {
	src, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return nil, fmt.Errorf("getting definition for cloning: %w", err)
	}

	now := time.Now().UTC()
	clone := &model.WorkflowDefinition{
		ID:            generateUUID(),
		TenantID:      tenantID,
		Name:          src.Name + " (Copy)",
		Description:   src.Description,
		Category:      src.Category,
		Version:       1,
		Status:        model.DefinitionStatusDraft,
		DefinitionKey: generateUUID(),
		TriggerConfig: src.TriggerConfig,
		Variables:     src.Variables,
		Steps:         src.Steps,
		CreatedBy:     userID,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if clone.Variables == nil {
		clone.Variables = make(map[string]model.VariableDef)
	}
	if clone.Steps == nil {
		clone.Steps = []model.StepDefinition{}
	}

	if err := s.repo.Create(ctx, clone); err != nil {
		return nil, fmt.Errorf("creating cloned definition: %w", err)
	}

	s.logger.Info().
		Str("id", clone.ID).
		Str("source_id", src.ID).
		Str("tenant_id", tenantID).
		Msg("workflow definition cloned")

	return clone, nil
}

// Delete performs a soft-delete on a workflow definition.
func (s *DefinitionService) Delete(ctx context.Context, tenantID, id string) error {
	if err := s.repo.SoftDelete(ctx, tenantID, id); err != nil {
		return fmt.Errorf("deleting workflow definition: %w", err)
	}

	s.logger.Info().
		Str("id", id).
		Str("tenant_id", tenantID).
		Msg("workflow definition soft-deleted")

	return nil
}

// ListVersions returns all versions of a workflow definition.
func (s *DefinitionService) ListVersions(ctx context.Context, tenantID, id string) ([]*model.WorkflowDefinition, error) {
	versions, err := s.repo.ListVersions(ctx, tenantID, id)
	if err != nil {
		return nil, fmt.Errorf("listing definition versions: %w", err)
	}
	return versions, nil
}

// ValidateDefinition performs comprehensive validation of a workflow definition.
// Returns a slice of validation errors; an empty slice means the definition is valid.
func (s *DefinitionService) ValidateDefinition(def *model.WorkflowDefinition) []dto.ValidationError {
	var errs []dto.ValidationError

	// 1. Name: non-empty, max 200 chars.
	if def.Name == "" {
		errs = append(errs, dto.ValidationError{
			Field:   "name",
			Message: "name is required",
		})
	} else if len(def.Name) > 200 {
		errs = append(errs, dto.ValidationError{
			Field:   "name",
			Message: "name must not exceed 200 characters",
		})
	}

	// 2. At least 2 steps.
	if len(def.Steps) < 2 {
		errs = append(errs, dto.ValidationError{
			Field:   "steps",
			Message: "workflow must contain at least 2 steps",
		})
	}

	// Build a map of step IDs for reference checking.
	stepIDs := make(map[string]bool, len(def.Steps))
	stepMap := make(map[string]*model.StepDefinition, len(def.Steps))
	endStepCount := 0

	for i := range def.Steps {
		step := &def.Steps[i]

		// 4. All step IDs must be unique.
		if step.ID == "" {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.id",
				StepID:  step.ID,
				Message: "step id is required",
			})
			continue
		}
		if stepIDs[step.ID] {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.id",
				StepID:  step.ID,
				Message: fmt.Sprintf("duplicate step id: %s", step.ID),
			})
		}
		stepIDs[step.ID] = true
		stepMap[step.ID] = step

		if step.Type == model.StepTypeEnd {
			endStepCount++
		}

		// Validate step type.
		if !model.ValidStepTypes[step.Type] {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.type",
				StepID:  step.ID,
				Message: fmt.Sprintf("invalid step type: %s", step.Type),
			})
		}
	}

	// 3. Exactly one "end" step.
	if endStepCount == 0 {
		errs = append(errs, dto.ValidationError{
			Field:   "steps",
			Message: "workflow must contain exactly one end step",
		})
	} else if endStepCount > 1 {
		errs = append(errs, dto.ValidationError{
			Field:   "steps",
			Message: fmt.Sprintf("workflow must contain exactly one end step, found %d", endStepCount),
		})
	}

	// 5. All transition targets reference existing step IDs.
	reachable := make(map[string]bool)
	for _, step := range def.Steps {
		for _, t := range step.Transitions {
			if t.Target != "" && !stepIDs[t.Target] {
				errs = append(errs, dto.ValidationError{
					Field:   "steps.transitions.target",
					StepID:  step.ID,
					Message: fmt.Sprintf("transition target '%s' does not reference a valid step", t.Target),
				})
			}
			if t.Target != "" {
				reachable[t.Target] = true
			}
		}

		// 5b. Interrupting boundary events: each must have a valid type and a
		// handler_step_id that references an existing step (which is thereby
		// reachable). Boundary handlers are legitimate flow entry points, so
		// counting them as reachable keeps a handler-only step from being flagged an
		// orphan. Additive: a step with no boundary_events adds nothing here.
		// An event-based gateway carries its OWN wait arms (in config); attaching
		// interrupting boundary events to it is ambiguous (which pending wait does the
		// boundary interrupt?) and would let an unmarked/marked registration leak on
		// interruption. Reject it fail-closed. Error boundaries are equally ambiguous
		// here, so reject ALL boundary_events on a gateway. Additive: no existing
		// definition attaches boundary_events to a gateway.
		if step.Type == model.StepTypeEventGateway && len(step.BoundaryEvents) > 0 {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.boundary_events",
				StepID:  step.ID,
				Message: "boundary_events are not allowed on an event_based_gateway (use the gateway's own event arms instead)",
			})
		}
		for _, b := range step.BoundaryEvents {
			if !model.ValidBoundaryEventTypes[b.Type] {
				errs = append(errs, dto.ValidationError{
					Field:   "steps.boundary_events.type",
					StepID:  step.ID,
					Message: fmt.Sprintf("invalid boundary event type: %s (expected timer, error or message)", b.Type),
				})
			}
			if b.HandlerStepID == "" || !stepIDs[b.HandlerStepID] {
				errs = append(errs, dto.ValidationError{
					Field:   "steps.boundary_events.handler_step_id",
					StepID:  step.ID,
					Message: fmt.Sprintf("boundary event handler_step_id '%s' does not reference a valid step", b.HandlerStepID),
				})
			} else {
				reachable[b.HandlerStepID] = true
			}
		}

		// 5c. Event-based gateway arm targets reference existing steps (and are
		// thereby reachable). The arm shapes themselves are validated in
		// validateStepConfig via the executor parser.
		if step.Type == model.StepTypeEventGateway {
			if arms, perr := executor.ParseEventGatewayArms(step.Config); perr == nil {
				for _, arm := range arms {
					if arm.Target != "" && !stepIDs[arm.Target] {
						errs = append(errs, dto.ValidationError{
							Field:   "steps.config.events.target",
							StepID:  step.ID,
							Message: fmt.Sprintf("event_based_gateway arm target '%s' does not reference a valid step", arm.Target),
						})
					}
					if arm.Target != "" {
						reachable[arm.Target] = true
					}
				}
			}
		}
	}

	// 6. No orphan steps: every non-first step must be reachable via transitions.
	if len(def.Steps) > 1 {
		for i, step := range def.Steps {
			if i == 0 {
				continue // First step is the entry point, always reachable.
			}
			if !reachable[step.ID] {
				errs = append(errs, dto.ValidationError{
					Field:   "steps",
					StepID:  step.ID,
					Message: fmt.Sprintf("step '%s' is not reachable from any transition (orphan step)", step.ID),
				})
			}
		}
	}

	// 7. Step-specific validation.
	for _, step := range def.Steps {
		errs = append(errs, s.validateStepConfig(step, def.DefinitionKey)...)
	}

	// 8. Trigger validation.
	errs = append(errs, s.validateTrigger(def.TriggerConfig)...)

	// 9. Variable validation.
	errs = append(errs, s.validateVariables(def.Variables)...)

	return errs
}

// validateStepConfig validates the configuration of individual step types.
// enclosingDefinitionKey is the definition_key of the definition being
// validated; it lets the call_activity case reject a STATIC self-reference (a
// definition calling itself by its own key), which would recurse unboundedly at
// runtime.
func (s *DefinitionService) validateStepConfig(step model.StepDefinition, enclosingDefinitionKey string) []dto.ValidationError {
	var errs []dto.ValidationError

	switch step.Type {
	case model.StepTypeHumanTask:
		// human_task: needs form_fields, assignee_role or assignee.
		if _, ok := step.Config["form_fields"]; !ok {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.form_fields",
				StepID:  step.ID,
				Message: "human_task step requires form_fields configuration",
			})
		}
		hasAssigneeRole := configStringNotEmpty(step.Config, "assignee_role")
		hasAssignee := configStringNotEmpty(step.Config, "assignee")
		if !hasAssigneeRole && !hasAssignee {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config",
				StepID:  step.ID,
				Message: "human_task step requires either assignee_role or assignee",
			})
		}

	case model.StepTypeServiceTask:
		// service_task: needs service, method, url.
		if !configStringNotEmpty(step.Config, "service") {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.service",
				StepID:  step.ID,
				Message: "service_task step requires service configuration",
			})
		}
		if !configStringNotEmpty(step.Config, "method") {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.method",
				StepID:  step.ID,
				Message: "service_task step requires method configuration",
			})
		}
		if !configStringNotEmpty(step.Config, "url") {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.url",
				StepID:  step.ID,
				Message: "service_task step requires url configuration",
			})
		}

	case model.StepTypeEventTask:
		// event_task: needs topic; if mode=wait, needs correlation_field.
		if !configStringNotEmpty(step.Config, "topic") {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.topic",
				StepID:  step.ID,
				Message: "event_task step requires topic configuration",
			})
		}
		mode, _ := step.Config["mode"].(string)
		if mode == "wait" {
			if !configStringNotEmpty(step.Config, "correlation_field") {
				errs = append(errs, dto.ValidationError{
					Field:   "steps.config.correlation_field",
					StepID:  step.ID,
					Message: "event_task step with mode=wait requires correlation_field configuration",
				})
			}
		}

	case model.StepTypeCondition:
		// condition: needs expression.
		if !configStringNotEmpty(step.Config, "expression") {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.expression",
				StepID:  step.ID,
				Message: "condition step requires expression configuration",
			})
		}

	case model.StepTypeParallelGateway:
		// parallel_gateway: needs branches.
		if _, ok := step.Config["branches"]; !ok {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.branches",
				StepID:  step.ID,
				Message: "parallel_gateway step requires branches configuration",
			})
		}

	case model.StepTypeTimer:
		// timer: needs duration or fire_at.
		hasDuration := configStringNotEmpty(step.Config, "duration")
		hasFireAt := configStringNotEmpty(step.Config, "fire_at")
		if !hasDuration && !hasFireAt {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config",
				StepID:  step.ID,
				Message: "timer step requires either duration or fire_at configuration",
			})
		}

	case model.StepTypeDecisionTask:
		// decision_task: needs a well-formed decision table with a valid hit
		// policy. We reuse the executor's authoritative parser so publish-time
		// validation and runtime execution agree exactly on what is well-formed
		// (a malformed table is rejected here, fail-closed, rather than blowing
		// up only when the step first runs).
		if _, err := executor.ParseDecisionTable(step.Config); err != nil {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.decision_table",
				StepID:  step.ID,
				Message: fmt.Sprintf("decision_task step has an invalid decision table: %v", err),
			})
			break
		}
		// Referenced input variables/paths must be resolvable expressions. The
		// parser already guarantees each input has a non-empty expression; we
		// additionally reject a syntactically invalid input/cell/output
		// expression so a typo is caught at publish, not at runtime.
		if errList := validateDecisionExpressions(step); len(errList) > 0 {
			errs = append(errs, errList...)
		}

	case model.StepTypeCallActivity:
		// call_activity: requires a child definition_key. Wave-4a shipped the
		// executor but not the publish gate; close it here.
		childKey := configTrimmedString(step.Config, "definition_key")
		if childKey == "" {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.definition_key",
				StepID:  step.ID,
				Message: "call_activity step requires a child definition_key",
			})
		} else if enclosingDefinitionKey != "" && childKey == enclosingDefinitionKey {
			// A STATIC self-reference (calling this very definition by its own
			// key) would recurse without bound; reject it fail-closed. (The
			// runtime also enforces a maxCallDepth bound, but this catches the
			// obvious mistake at publish time.)
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.definition_key",
				StepID:  step.ID,
				Message: fmt.Sprintf("call_activity step cannot statically reference its own enclosing definition_key %q (unbounded recursion)", childKey),
			})
		}
		// input_mapping, when present, must be an object.
		if raw, ok := step.Config["input_mapping"]; ok && raw != nil {
			if _, ok := raw.(map[string]interface{}); !ok {
				errs = append(errs, dto.ValidationError{
					Field:   "steps.config.input_mapping",
					StepID:  step.ID,
					Message: "call_activity input_mapping must be an object",
				})
			}
		}

	case model.StepTypeMultiInstance:
		// multi_instance: requires a collection AND a fan-out target (either a
		// child_definition_key for async child fan-out OR an inner_step for the
		// sync path) AND a valid completion policy.
		if _, ok := step.Config["collection"]; !ok {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.collection",
				StepID:  step.ID,
				Message: "multi_instance step requires a collection",
			})
		}
		childKey := configTrimmedString(step.Config, "child_definition_key")
		innerStep := configTrimmedString(step.Config, "inner_step")
		if childKey == "" && innerStep == "" {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config",
				StepID:  step.ID,
				Message: "multi_instance step requires a fan-out target: either child_definition_key (async) or inner_step (sync)",
			})
		}
		if childKey != "" && enclosingDefinitionKey != "" && childKey == enclosingDefinitionKey {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.child_definition_key",
				StepID:  step.ID,
				Message: fmt.Sprintf("multi_instance step cannot statically reference its own enclosing definition_key %q (unbounded recursion)", childKey),
			})
		}
		// completion_policy, when present, must be "all", "any" or a positive
		// integer (n_of_m). Absent => defaults to "all" (valid).
		if !validMICompletionPolicy(step.Config) {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.completion_policy",
				StepID:  step.ID,
				Message: "multi_instance completion_policy must be 'all', 'any' or a positive integer",
			})
		}

	case model.StepTypeConnectorTask:
		// connector_task: requires connector_kind. connector_id is optional (pins a
		// specific configured instance). input_mapping / output_mapping, when
		// present, must be objects. The connector must exist in the integration
		// framework at runtime; that is a runtime resolution concern (the dispatcher
		// fails the step with a clear error), not a publish-time gate, because the
		// definition service does not import the tenant-scoped connector registry.
		if !configStringNotEmpty(step.Config, "connector_kind") {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.connector_kind",
				StepID:  step.ID,
				Message: "connector_task step requires connector_kind configuration",
			})
		}
		if raw, ok := step.Config["input_mapping"]; ok && raw != nil {
			if _, ok := raw.(map[string]interface{}); !ok {
				errs = append(errs, dto.ValidationError{
					Field:   "steps.config.input_mapping",
					StepID:  step.ID,
					Message: "connector_task input_mapping must be an object",
				})
			}
		}
		if raw, ok := step.Config["output_mapping"]; ok && raw != nil {
			if _, ok := raw.(map[string]interface{}); !ok {
				errs = append(errs, dto.ValidationError{
					Field:   "steps.config.output_mapping",
					StepID:  step.ID,
					Message: "connector_task output_mapping must be an object",
				})
			}
		}

	case model.StepTypeEventGateway:
		// event_based_gateway: requires a well-formed "events" array (each arm a
		// timer or message with a target). Reuse the executor's authoritative parser
		// so publish-time validation and runtime execution agree exactly.
		if _, err := executor.ParseEventGatewayArms(step.Config); err != nil {
			errs = append(errs, dto.ValidationError{
				Field:   "steps.config.events",
				StepID:  step.ID,
				Message: fmt.Sprintf("event_based_gateway step has invalid events: %v", err),
			})
		}

	case model.StepTypeEnd:
		// End steps do not need additional config validation.
	}

	return errs
}

// validateDecisionExpressions parses every input expression, output cell, and
// input cell of a decision_task through the FEEL-subset evaluator's parser so a
// syntactically invalid expression is rejected at publish time. It re-parses the
// table (cheap; the parse already succeeded in the caller) to walk the cells.
func validateDecisionExpressions(step model.StepDefinition) []dto.ValidationError {
	var errs []dto.ValidationError
	table, err := executor.ParseDecisionTable(step.Config)
	if err != nil {
		return errs // structural error already reported by caller.
	}
	eval := expression.NewEvaluator()
	empty := map[string]interface{}{}
	check := func(field, expr string) {
		if strings.TrimSpace(expr) == "" {
			return
		}
		// A path-not-found / missing-var error is EXPECTED at validation time
		// (there is no instance data), so we only fail on tokenize/parse errors,
		// which surface with the "tokenize error"/"parse error" prefixes.
		_, e := eval.EvaluateValue(expr, empty)
		if e != nil && (strings.Contains(e.Error(), "tokenize error") || strings.Contains(e.Error(), "parse error")) {
			errs = append(errs, dto.ValidationError{
				Field:   field,
				StepID:  step.ID,
				Message: fmt.Sprintf("invalid expression %q: %v", expr, e),
			})
		}
	}
	for _, in := range table.Inputs {
		check("steps.config.decision_table.inputs", in.Expression)
	}
	for ri, rule := range table.Rules {
		for ci, cell := range rule.When {
			c := strings.TrimSpace(cell)
			if c == "" || c == "-" || c == "*" {
				continue
			}
			check(fmt.Sprintf("steps.config.decision_table.rules[%d].when[%d]", ri, ci), executorBuildCellExpression(c))
		}
	}
	return errs
}

// executorBuildCellExpression mirrors the executor's cell-to-expression form so
// the validator checks the SAME expression the executor will run. It is a thin
// wrapper over the exported helper to keep the two in sync.
func executorBuildCellExpression(cell string) string {
	return executor.BuildCellExpression(cell)
}

// validMICompletionPolicy reports whether a multi_instance completion_policy
// config value (absent, "all", "any", or a positive integer) is acceptable.
func validMICompletionPolicy(config map[string]interface{}) bool {
	raw, ok := config["completion_policy"]
	if !ok || raw == nil {
		return true // defaults to "all"
	}
	switch v := raw.(type) {
	case string:
		lv := strings.ToLower(strings.TrimSpace(v))
		if lv == "" || lv == "all" || lv == "any" {
			return true
		}
		// numeric string?
		var n int
		if _, err := fmt.Sscanf(lv, "%d", &n); err == nil && n > 0 {
			return true
		}
		return false
	case float64:
		return v >= 1
	case int:
		return v >= 1
	case int64:
		return v >= 1
	default:
		return false
	}
}

// configTrimmedString returns the trimmed string value at key, or "".
func configTrimmedString(cfg map[string]interface{}, key string) string {
	if cfg == nil {
		return ""
	}
	s, _ := cfg[key].(string)
	return strings.TrimSpace(s)
}

// validateTrigger validates the trigger configuration.
func (s *DefinitionService) validateTrigger(tc model.TriggerConfig) []dto.ValidationError {
	var errs []dto.ValidationError

	if !model.ValidTriggerTypes[tc.Type] {
		errs = append(errs, dto.ValidationError{
			Field:   "trigger_config.type",
			Message: fmt.Sprintf("invalid trigger type: %s; must be one of: manual, event, schedule", tc.Type),
		})
		return errs
	}

	switch tc.Type {
	case model.TriggerTypeEvent:
		if tc.Topic == "" {
			errs = append(errs, dto.ValidationError{
				Field:   "trigger_config.topic",
				Message: "topic is required for event triggers",
			})
		}
	case model.TriggerTypeSchedule:
		if tc.Cron == "" {
			errs = append(errs, dto.ValidationError{
				Field:   "trigger_config.cron",
				Message: "cron expression is required for schedule triggers",
			})
		}
	}

	return errs
}

// validateVariables validates the variable definitions.
func (s *DefinitionService) validateVariables(vars map[string]model.VariableDef) []dto.ValidationError {
	var errs []dto.ValidationError

	for name, v := range vars {
		if name == "" {
			errs = append(errs, dto.ValidationError{
				Field:   "variables",
				Message: "variable name cannot be empty",
			})
			continue
		}
		if !model.ValidVariableTypes[v.Type] {
			errs = append(errs, dto.ValidationError{
				Field:   fmt.Sprintf("variables.%s.type", name),
				Message: fmt.Sprintf("invalid variable type '%s'", v.Type),
			})
		}
	}

	return errs
}

// configStringNotEmpty checks whether a config map contains a non-empty string for the given key.
func configStringNotEmpty(cfg map[string]interface{}, key string) bool {
	if cfg == nil {
		return false
	}
	v, ok := cfg[key]
	if !ok {
		return false
	}
	s, ok := v.(string)
	if !ok {
		return false
	}
	return s != ""
}

// ValidationFailedError is returned when a definition fails activation
// validation. It carries the structured list of problems so the HTTP layer can
// emit them in the 400 response body (the designer/detail UI renders the list
// inline rather than only flashing a toast).
type ValidationFailedError struct {
	Errors []dto.ValidationError
}

// Error implements the error interface with a human-readable summary. The
// message contains the word "validation" so existing heuristic error mapping
// continues to classify it as a 400 even on paths that do not type-assert.
func (e *ValidationFailedError) Error() string {
	return fmt.Sprintf("definition validation failed with %d error(s): %s",
		len(e.Errors), formatValidationErrors(e.Errors))
}

// ValidationErrors returns the structured validation problems.
func (e *ValidationFailedError) ValidationErrors() []dto.ValidationError {
	return e.Errors
}

// formatValidationErrors produces a human-readable summary of validation errors.
func formatValidationErrors(errs []dto.ValidationError) string {
	if len(errs) == 0 {
		return ""
	}
	msgs := make([]string, 0, len(errs))
	for _, e := range errs {
		msg := e.Field + ": " + e.Message
		if e.StepID != "" {
			msg = "[step:" + e.StepID + "] " + msg
		}
		msgs = append(msgs, msg)
	}
	result := msgs[0]
	for i := 1; i < len(msgs); i++ {
		result += "; " + msgs[i]
	}
	return result
}

// generateUUID returns a UUID v4 string using crypto/rand.
func generateUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40 // Version 4
	b[8] = (b[8] & 0x3f) | 0x80 // Variant 10
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
