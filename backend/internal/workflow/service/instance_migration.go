package service

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/model"
)

// ============================================================================
// IN-FLIGHT INSTANCE MIGRATION (versioning/lifecycle hardening).
//
// A running instance PINS its definition version (definition_id + definition_ver)
// and re-fetches that EXACT row every step, so a fix to a definition can never
// reach work already in flight — the Camunda/Flowable/Temporal "process instance
// migration" gap. This service migrates a running / suspended / incident instance
// from its pinned version to a TARGET version with:
//
//	(i)   COMPATIBILITY VALIDATION — the instance's current step id must exist in
//	      the target definition, OR an explicit step remapping supplies it; the
//	      remapped current step must exist in the target. Incompatible migrations
//	      are REJECTED fail-closed (no partial state change).
//	(ii)  an explicit step/state remap (old step id -> new step id) plus optional
//	      variable remap (old var name -> new var name).
//	(iii) ATOMICITY — the migration commits through the instance repository's
//	      single-transaction MigrateInstanceVersion, run UNDER the Wave-1
//	      per-instance serialization (SerializeInstance / the in-process keyed
//	      mutex), so it cannot race a concurrent advance (a racing committer loses
//	      on lock_version; a racing migrate finds the version bumped and no-ops).
//	(iv)  an AUDIT event (workflow.instance.migrated) recording from/to version +
//	      the applied step remap, via the engine's publishEvent path.
//
// Everything is ADDITIVE and OPTIONAL: the service is constructed separately from
// the engine and discovers its capabilities via type-assertion seams, so no
// existing engine caller/test changes and instances that are never migrated are
// byte-for-byte unchanged.
// ============================================================================

// migrationInstanceRepo is the persistence surface the migration service needs.
// The production *repository.InstanceRepository satisfies it; test doubles
// implement the same small set.
type migrationInstanceRepo interface {
	GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowInstance, error)
	ListByDefinitionAndStatus(ctx context.Context, tenantID, definitionID, status string, limit, offset int) ([]*model.WorkflowInstance, error)
	MigrateInstanceVersion(ctx context.Context, inst *model.WorkflowInstance, stepExec *model.StepExecution) error
}

// migrationDefRepo resolves target definitions for a migration. GetByID loads a
// specific target version; GetRuntimeActiveByDefinitionKey resolves the single
// runtime-selected (prod-promoted) active version of a lineage as the target.
type migrationDefRepo interface {
	GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowDefinition, error)
}

// migrationRuntimeResolver is the OPTIONAL capability (satisfied by
// *repository.DefinitionRepository) to resolve a lineage's runtime-active version
// as a migration target by definition_key. Discovered via type assertion; when
// absent the "migrate to the lineage's active version" convenience is unavailable
// and the caller must name an explicit target definition id.
type migrationRuntimeResolver interface {
	GetRuntimeActiveByDefinitionKey(ctx context.Context, tenantID, definitionKey string) (*model.WorkflowDefinition, error)
}

// migrationSerializer is the OPTIONAL per-instance cross-process serializer
// (satisfied by the instance repository's SerializeInstance). When present the
// migration runs inside it so it is serialized against a concurrent advance the
// same way a transition is. Absent it, the in-process keyed mutex still holds.
type migrationSerializer interface {
	SerializeInstance(ctx context.Context, instanceID string, fn func() error) error
}

// MigrationSpec is the per-instance remap the caller supplies.
type MigrationSpec struct {
	// TargetDefinitionID names an explicit target definition version to migrate to.
	// Exactly one of TargetDefinitionID / TargetDefinitionKey must be set.
	TargetDefinitionID string
	// TargetDefinitionKey resolves the target as the runtime-active (prod-promoted)
	// version of a lineage. Requires a wired runtime resolver.
	TargetDefinitionKey string
	// StepRemap maps OLD step id -> NEW step id. Applied to the instance's current
	// step. A step present in both definitions needs no entry (identity mapping);
	// a renamed/removed step MUST be remapped or the migration is rejected.
	StepRemap map[string]string
	// VariableRemap maps OLD variable name -> NEW variable name. Optional; renames
	// a variable's key while preserving its value. Unmapped variables are carried
	// over unchanged.
	VariableRemap map[string]string
	// Reason is free-text recorded on the audit event.
	Reason string
}

// MigrationResult is the outcome of one instance migration.
type MigrationResult struct {
	InstanceID   string `json:"instance_id"`
	FromDefID    string `json:"from_definition_id"`
	FromVersion  int    `json:"from_version"`
	ToDefID      string `json:"to_definition_id"`
	ToVersion    int    `json:"to_version"`
	FromStepID   string `json:"from_step_id"`
	ToStepID     string `json:"to_step_id"`
	Migrated     bool   `json:"migrated"`
	SkippedError string `json:"error,omitempty"`
}

// BulkMigrationResult aggregates a bulk migration.
type BulkMigrationResult struct {
	Selected int                `json:"selected"`
	Migrated int                `json:"migrated"`
	Failed   int                `json:"failed"`
	Results  []*MigrationResult `json:"results"`
}

// ErrIncompatibleMigration is returned, fail-closed, when the instance's current
// step has no counterpart in the target definition and no remap supplies one, or
// a supplied remap points at a step absent from the target. It wraps
// model.ErrConflict so callers map it to 409 and errors.Is checks compose.
var ErrIncompatibleMigration = fmt.Errorf("incompatible instance migration: %w", model.ErrConflict)

// ErrInstanceNotMigratable is returned when the instance is in a terminal state
// (completed/failed/cancelled) — only running/suspended/incident instances are
// migratable. Wraps model.ErrConflict.
var ErrInstanceNotMigratable = fmt.Errorf("instance is not in a migratable state (only running/suspended/incident): %w", model.ErrConflict)

// InstanceMigrationService migrates in-flight instances across definition
// versions. It owns validation + remap + atomic commit + audit; it does NOT
// re-enter the engine's transition path, so a migration never advances the
// instance — it only re-pins its version and step.
type InstanceMigrationService struct {
	instRepo   migrationInstanceRepo
	defRepo    migrationDefRepo
	producer   eventPublisher
	logger     zerolog.Logger
	serializer migrationSerializer
	runtime    migrationRuntimeResolver

	// maxBulk bounds a single bulk migration selection so an unbounded lineage
	// cannot be migrated in one unbatched sweep. Callers paginate past it.
	maxBulk int
}

// NewInstanceMigrationService constructs the migration service, discovering the
// OPTIONAL serializer + runtime-resolver capabilities on the passed repos via
// type assertion (nil when a test double does not implement them).
func NewInstanceMigrationService(instRepo migrationInstanceRepo, defRepo migrationDefRepo, producer eventPublisher, logger zerolog.Logger) *InstanceMigrationService {
	s := &InstanceMigrationService{
		instRepo: instRepo,
		defRepo:  defRepo,
		producer: producer,
		logger:   logger.With().Str("service", "workflow-instance-migration").Logger(),
		maxBulk:  500,
	}
	if ser, ok := instRepo.(migrationSerializer); ok {
		s.serializer = ser
	}
	if rr, ok := defRepo.(migrationRuntimeResolver); ok {
		s.runtime = rr
	}
	return s
}

// MigrateInstance migrates a single instance to the target named in spec. It is
// serialized against a concurrent advance and commits atomically, or rejects the
// whole migration fail-closed (no partial state change).
func (s *InstanceMigrationService) MigrateInstance(ctx context.Context, tenantID, instanceID string, spec MigrationSpec) (*MigrationResult, error) {
	// Early existence check so a bad instance id surfaces before target resolution.
	if _, err := s.instRepo.GetByID(ctx, tenantID, instanceID); err != nil {
		return nil, fmt.Errorf("loading instance for migration: %w", err)
	}

	target, err := s.resolveTarget(ctx, tenantID, spec)
	if err != nil {
		return nil, err
	}

	var result *MigrationResult
	migrate := func() error {
		res, mErr := s.migrateLocked(ctx, tenantID, instanceID, target, spec)
		result = res
		return mErr
	}

	// Run under the per-instance critical section so the migration is serialized
	// against a concurrent advance (no double-advance / lost update).
	if s.serializer != nil {
		err = s.serializer.SerializeInstance(ctx, instanceID, migrate)
	} else {
		err = migrate()
	}
	if err != nil {
		return nil, err
	}
	return result, nil
}

// migrateLocked performs the reload-under-lock, validation, remap, atomic commit,
// and audit. The caller holds the per-instance critical section.
func (s *InstanceMigrationService) migrateLocked(ctx context.Context, tenantID, instanceID string, target *model.WorkflowDefinition, spec MigrationSpec) (*MigrationResult, error) {
	// Re-load inside the critical section so we validate + commit against the
	// current state (a concurrent advance just before the lock is reflected here).
	inst, err := s.instRepo.GetByID(ctx, tenantID, instanceID)
	if err != nil {
		return nil, fmt.Errorf("reloading instance under lock: %w", err)
	}

	// Only running / suspended / incident instances are migratable. Terminal ones
	// are rejected fail-closed.
	if !isMigratableStatus(inst.Status) {
		return nil, fmt.Errorf("instance %s status %q: %w", instanceID, inst.Status, ErrInstanceNotMigratable)
	}

	// A no-op migration (already on the target version) is rejected as a conflict
	// so the caller does not silently churn lock versions.
	if inst.DefinitionID == target.ID {
		return nil, fmt.Errorf("instance %s is already on target definition %s: %w", instanceID, target.ID, model.ErrConflict)
	}

	fromDefID := inst.DefinitionID
	fromVer := inst.DefinitionVer
	fromStep := ""
	if inst.CurrentStepID != nil {
		fromStep = *inst.CurrentStepID
	}

	// COMPATIBILITY VALIDATION + step remap.
	toStep, err := remapCurrentStep(fromStep, spec.StepRemap, target)
	if err != nil {
		return nil, err
	}

	// Build the migrated instance state: re-pin the target version, set the
	// remapped current step, and apply the (optional) variable remap.
	migrated := *inst
	migrated.DefinitionID = target.ID
	migrated.DefinitionVer = target.Version
	migrated.CurrentStepID = &toStep
	migrated.Variables = remapVariables(inst.Variables, spec.VariableRemap)
	migrated.UpdatedAt = time.Now().UTC()

	now := time.Now().UTC()
	auditExec := &model.StepExecution{
		ID:          generateUUID(),
		InstanceID:  inst.ID,
		StepID:      toStep,
		StepType:    "migration",
		Status:      model.StepStatusCompleted,
		Attempt:     1,
		StartedAt:   &now,
		CompletedAt: &now,
		CreatedAt:   now,
	}

	if err := s.instRepo.MigrateInstanceVersion(ctx, &migrated, auditExec); err != nil {
		return nil, fmt.Errorf("committing instance migration: %w", err)
	}

	s.logger.Info().
		Str("instance_id", inst.ID).
		Str("tenant_id", tenantID).
		Str("from_definition_id", fromDefID).
		Int("from_version", fromVer).
		Str("to_definition_id", target.ID).
		Int("to_version", target.Version).
		Str("from_step_id", fromStep).
		Str("to_step_id", toStep).
		Msg("workflow instance migrated to new definition version")

	s.publishAudit(ctx, tenantID, map[string]interface{}{
		"instance_id":        inst.ID,
		"from_definition_id": fromDefID,
		"from_version":       fromVer,
		"to_definition_id":   target.ID,
		"to_version":         target.Version,
		"from_step_id":       fromStep,
		"to_step_id":         toStep,
		"step_remap":         spec.StepRemap,
		"variable_remap":     spec.VariableRemap,
		"reason":             spec.Reason,
	})

	return &MigrationResult{
		InstanceID:  inst.ID,
		FromDefID:   fromDefID,
		FromVersion: fromVer,
		ToDefID:     target.ID,
		ToVersion:   target.Version,
		FromStepID:  fromStep,
		ToStepID:    toStep,
		Migrated:    true,
	}, nil
}

// MigrateBulk migrates every instance currently pinned to fromDefinitionID and in
// one of the requested statuses to the target named in spec. It is a best-effort
// batch: each instance is migrated independently under its own critical section,
// and a per-instance failure (incompatible remap, concurrent advance, terminal
// flip) is recorded on that instance's result without aborting the batch. statuses
// empty means the default migratable set (running/suspended/incident).
func (s *InstanceMigrationService) MigrateBulk(ctx context.Context, tenantID, fromDefinitionID string, statuses []string, spec MigrationSpec) (*BulkMigrationResult, error) {
	if fromDefinitionID == "" {
		return nil, fmt.Errorf("from_definition_id is required for bulk migration")
	}
	if len(statuses) == 0 {
		statuses = migratableStatuses()
	}

	target, err := s.resolveTarget(ctx, tenantID, spec)
	if err != nil {
		return nil, err
	}
	// Guard: migrating a definition onto itself would select instances already on
	// the target (each rejected as a no-op). Reject up front.
	if target.ID == fromDefinitionID {
		return nil, fmt.Errorf("bulk migration target %s equals the source definition: %w", target.ID, model.ErrConflict)
	}

	out := &BulkMigrationResult{Results: []*MigrationResult{}}
	seen := make(map[string]bool)
	for _, st := range statuses {
		if !isMigratableStatus(st) {
			return nil, fmt.Errorf("status %q is not migratable (only running/suspended/incident): %w", st, model.ErrConflict)
		}
		insts, lerr := s.instRepo.ListByDefinitionAndStatus(ctx, tenantID, fromDefinitionID, st, s.maxBulk, 0)
		if lerr != nil {
			return nil, fmt.Errorf("listing instances for bulk migration: %w", lerr)
		}
		for _, inst := range insts {
			if seen[inst.ID] {
				continue
			}
			seen[inst.ID] = true
			out.Selected++
			res, mErr := s.migrateOneForBulk(ctx, tenantID, inst.ID, target, spec)
			if mErr != nil {
				out.Failed++
				out.Results = append(out.Results, &MigrationResult{
					InstanceID:   inst.ID,
					FromDefID:    fromDefinitionID,
					ToDefID:      target.ID,
					ToVersion:    target.Version,
					Migrated:     false,
					SkippedError: mErr.Error(),
				})
				continue
			}
			out.Migrated++
			out.Results = append(out.Results, res)
		}
	}
	s.logger.Info().
		Str("tenant_id", tenantID).
		Str("from_definition_id", fromDefinitionID).
		Str("to_definition_id", target.ID).
		Int("selected", out.Selected).
		Int("migrated", out.Migrated).
		Int("failed", out.Failed).
		Msg("bulk workflow instance migration completed")
	return out, nil
}

// migrateOneForBulk migrates a single instance under its critical section, used by
// the bulk path so a per-instance failure is caught by the caller.
func (s *InstanceMigrationService) migrateOneForBulk(ctx context.Context, tenantID, instanceID string, target *model.WorkflowDefinition, spec MigrationSpec) (*MigrationResult, error) {
	var result *MigrationResult
	migrate := func() error {
		res, err := s.migrateLocked(ctx, tenantID, instanceID, target, spec)
		result = res
		return err
	}
	if s.serializer != nil {
		if err := s.serializer.SerializeInstance(ctx, instanceID, migrate); err != nil {
			return nil, err
		}
		return result, nil
	}
	if err := migrate(); err != nil {
		return nil, err
	}
	return result, nil
}

// resolveTarget loads the migration target definition from the spec: an explicit
// TargetDefinitionID, or the runtime-active version of TargetDefinitionKey.
func (s *InstanceMigrationService) resolveTarget(ctx context.Context, tenantID string, spec MigrationSpec) (*model.WorkflowDefinition, error) {
	if spec.TargetDefinitionID != "" && spec.TargetDefinitionKey != "" {
		return nil, fmt.Errorf("specify exactly one of target_definition_id / target_definition_key")
	}
	if spec.TargetDefinitionID != "" {
		def, err := s.defRepo.GetByID(ctx, tenantID, spec.TargetDefinitionID)
		if err != nil {
			return nil, fmt.Errorf("loading target definition %s: %w", spec.TargetDefinitionID, err)
		}
		if def.Status != model.DefinitionStatusActive {
			return nil, fmt.Errorf("target definition %s is not active (status: %s): %w", def.ID, def.Status, model.ErrConflict)
		}
		return def, nil
	}
	if spec.TargetDefinitionKey != "" {
		if s.runtime == nil {
			return nil, fmt.Errorf("migrating by target_definition_key is unavailable (no runtime resolver wired)")
		}
		def, err := s.runtime.GetRuntimeActiveByDefinitionKey(ctx, tenantID, spec.TargetDefinitionKey)
		if err != nil {
			return nil, fmt.Errorf("resolving runtime-active target for lineage %s: %w", spec.TargetDefinitionKey, err)
		}
		return def, nil
	}
	return nil, fmt.Errorf("a migration target (target_definition_id or target_definition_key) is required")
}

// publishAudit emits the workflow.instance.migrated event when a producer is
// wired (best-effort; a publish failure is logged, never failing the migration —
// the state change already committed).
func (s *InstanceMigrationService) publishAudit(ctx context.Context, tenantID string, data map[string]interface{}) {
	if s.producer == nil {
		return
	}
	evt, err := events.NewEvent("workflow.instance.migrated", "workflow-engine", tenantID, data)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to build instance-migration audit event")
		return
	}
	if err := s.producer.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		s.logger.Error().Err(err).Msg("failed to publish instance-migration audit event")
	}
}

// ---------------------------------------------------------------------------
// Pure helpers (validation + remap)
// ---------------------------------------------------------------------------

// remapCurrentStep resolves the target step id for the instance's current step:
// an explicit remap wins; otherwise the same step id is used if it EXISTS in the
// target. The resolved step MUST exist in the target definition or the migration
// is rejected fail-closed (ErrIncompatibleMigration). An empty current step (an
// instance not yet on a step) maps to the target's first step when present.
func remapCurrentStep(fromStep string, remap map[string]string, target *model.WorkflowDefinition) (string, error) {
	// Empty current step: adopt the target's first step (a freshly-started
	// instance whose first-step execution has not been recorded yet).
	if fromStep == "" {
		if len(target.Steps) > 0 {
			return target.Steps[0].ID, nil
		}
		return "", fmt.Errorf("target definition %s has no steps: %w", target.ID, ErrIncompatibleMigration)
	}

	toStep := fromStep
	if remap != nil {
		if mapped, ok := remap[fromStep]; ok {
			if mapped == "" {
				return "", fmt.Errorf("step remap for %q maps to an empty target step: %w", fromStep, ErrIncompatibleMigration)
			}
			toStep = mapped
		}
	}

	if findMigrationStep(target.Steps, toStep) == nil {
		if toStep == fromStep {
			return "", fmt.Errorf("current step %q does not exist in target definition %s and no remap was supplied: %w",
				fromStep, target.ID, ErrIncompatibleMigration)
		}
		return "", fmt.Errorf("remapped step %q (from %q) does not exist in target definition %s: %w",
			toStep, fromStep, target.ID, ErrIncompatibleMigration)
	}
	return toStep, nil
}

// remapVariables applies an optional old-name -> new-name variable remap,
// preserving values. A copy is returned so the caller's map is not mutated. When
// remap is empty the original variables are copied through unchanged.
func remapVariables(vars map[string]interface{}, remap map[string]string) map[string]interface{} {
	out := make(map[string]interface{}, len(vars))
	for k, v := range vars {
		if remap != nil {
			if nk, ok := remap[k]; ok && nk != "" {
				out[nk] = v
				continue
			}
		}
		out[k] = v
	}
	return out
}

// findMigrationStep looks up a step by id in a definition's step slice.
func findMigrationStep(steps []model.StepDefinition, id string) *model.StepDefinition {
	for i := range steps {
		if steps[i].ID == id {
			return &steps[i]
		}
	}
	return nil
}

// isMigratableStatus reports whether an instance in the given status may be
// migrated. Only running / suspended / incident qualify; terminal states do not.
func isMigratableStatus(status string) bool {
	switch status {
	case model.InstanceStatusRunning, model.InstanceStatusSuspended, model.InstanceStatusIncident:
		return true
	default:
		return false
	}
}

// migratableStatuses is the default status set for a bulk migration.
func migratableStatuses() []string {
	return []string{model.InstanceStatusRunning, model.InstanceStatusSuspended, model.InstanceStatusIncident}
}
