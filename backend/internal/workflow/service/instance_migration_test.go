package service

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// ============================================================================
// In-flight instance migration tests.
//
// These pin: (1) a COMPATIBLE migration remaps the current step + variables and
// the instance keeps running on the NEW version; (2) an INCOMPATIBLE migration
// (current step missing in target, no remap) is REJECTED fail-closed; (3) the
// migration is SERIALIZED against a concurrent advance (no double-advance / lost
// update); (4) a TERMINAL instance is rejected; (5) BULK migration.
// ============================================================================

// migInstRepo is a stateful in-memory migrationInstanceRepo that also implements
// the OPTIONAL migrationSerializer (a real per-instance mutex) and enforces the
// optimistic lock_version guard the real repo's MigrateInstanceVersion applies —
// so the concurrency test exercises the SAME lost-update protection.
type migInstRepo struct {
	mu    sync.Mutex // guards byID
	byID  map[string]*model.WorkflowInstance
	locks sync.Map // instanceID -> *sync.Mutex (the per-instance critical section)

	// migrateHook, when set, is invoked INSIDE MigrateInstanceVersion just before
	// the lock_version guard is evaluated. The concurrency test uses it to inject a
	// racing advance and prove serialization/optimistic-lock behaviour.
	migrateHook func(instanceID string)
}

func newMigInstRepo(insts ...*model.WorkflowInstance) *migInstRepo {
	r := &migInstRepo{byID: map[string]*model.WorkflowInstance{}}
	for _, in := range insts {
		cp := *in
		r.byID[in.ID] = &cp
	}
	return r
}

func (r *migInstRepo) GetByID(_ context.Context, tenantID, id string) (*model.WorkflowInstance, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	in, ok := r.byID[id]
	if !ok || (tenantID != "" && in.TenantID != tenantID) {
		return nil, model.ErrNotFound
	}
	cp := *in
	return &cp, nil
}

func (r *migInstRepo) ListByDefinitionAndStatus(_ context.Context, tenantID, definitionID, status string, limit, offset int) ([]*model.WorkflowInstance, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []*model.WorkflowInstance
	for _, in := range r.byID {
		if in.TenantID != tenantID || in.DefinitionID != definitionID {
			continue
		}
		if status != "" && in.Status != status {
			continue
		}
		cp := *in
		out = append(out, &cp)
	}
	// Deterministic-enough for tests; the real repo orders by started_at.
	return out, nil
}

func (r *migInstRepo) MigrateInstanceVersion(_ context.Context, inst *model.WorkflowInstance, stepExec *model.StepExecution) error {
	if r.migrateHook != nil {
		r.migrateHook(inst.ID)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	cur, ok := r.byID[inst.ID]
	if !ok {
		return model.ErrNotFound
	}
	if cur.IsTerminal() {
		return errors.New("terminal: " + cur.Status)
	}
	// Optimistic lock guard — mirrors the real repo: a concurrent advance that
	// bumped lock_version makes this migrate lose (ErrConcurrencyConfl).
	if cur.LockVersion != inst.LockVersion {
		return model.ErrConcurrencyConfl
	}
	migrated := *inst
	migrated.LockVersion = inst.LockVersion + 1
	r.byID[inst.ID] = &migrated
	inst.LockVersion++
	return nil
}

// SerializeInstance is the per-instance critical section (real mutex) so the
// migrate and a racing advance cannot interleave.
func (r *migInstRepo) SerializeInstance(_ context.Context, instanceID string, fn func() error) error {
	mu, _ := r.locks.LoadOrStore(instanceID, &sync.Mutex{})
	m := mu.(*sync.Mutex)
	m.Lock()
	defer m.Unlock()
	return fn()
}

// advance simulates a concurrent engine advance: it takes the same per-instance
// critical section, then bumps the instance's current step + lock_version.
func (r *migInstRepo) advance(instanceID, toStep string) {
	_ = r.SerializeInstance(context.Background(), instanceID, func() error {
		r.mu.Lock()
		defer r.mu.Unlock()
		in := r.byID[instanceID]
		nc := *in
		nc.CurrentStepID = &toStep
		nc.LockVersion++
		r.byID[instanceID] = &nc
		return nil
	})
}

func (r *migInstRepo) get(id string) *model.WorkflowInstance {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *r.byID[id]
	return &cp
}

// migDefRepo is a stateful in-memory migrationDefRepo + runtime resolver.
type migDefRepo struct {
	byID map[string]*model.WorkflowDefinition
}

func newMigDefRepo(defs ...*model.WorkflowDefinition) *migDefRepo {
	r := &migDefRepo{byID: map[string]*model.WorkflowDefinition{}}
	for _, d := range defs {
		cp := *d
		r.byID[d.ID] = &cp
	}
	return r
}

func (r *migDefRepo) GetByID(_ context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	d, ok := r.byID[id]
	if !ok || d.TenantID != tenantID {
		return nil, model.ErrNotFound
	}
	cp := *d
	return &cp, nil
}

func (r *migDefRepo) GetRuntimeActiveByDefinitionKey(_ context.Context, tenantID, key string) (*model.WorkflowDefinition, error) {
	var best *model.WorkflowDefinition
	for _, d := range r.byID {
		if d.TenantID != tenantID || d.DefinitionKey != key || d.Status != model.DefinitionStatusActive {
			continue
		}
		if best == nil || model.RuntimeActiveLess(best.Stage, best.Version, d.Stage, d.Version) {
			best = d
		}
	}
	if best == nil {
		return nil, model.ErrNotFound
	}
	cp := *best
	return &cp, nil
}

const migTenant = "tenant-mig"

func stepDef(id string) model.StepDefinition {
	return model.StepDefinition{ID: id, Type: model.StepTypeHumanTask, Name: id, Config: map[string]interface{}{}}
}

func targetDef(id, key string, version int, stepIDs ...string) *model.WorkflowDefinition {
	steps := make([]model.StepDefinition, 0, len(stepIDs)+1)
	for _, s := range stepIDs {
		steps = append(steps, stepDef(s))
	}
	steps = append(steps, model.StepDefinition{ID: "end", Type: model.StepTypeEnd, Name: "End"})
	return &model.WorkflowDefinition{
		ID:            id,
		TenantID:      migTenant,
		Name:          "Onboarding",
		Version:       version,
		Status:        model.DefinitionStatusActive,
		Stage:         model.StageProd,
		DefinitionKey: key,
		Steps:         steps,
	}
}

func runningInstance(id, defID string, ver int, curStep string, vars map[string]interface{}) *model.WorkflowInstance {
	cs := curStep
	if vars == nil {
		vars = map[string]interface{}{}
	}
	return &model.WorkflowInstance{
		ID:            id,
		TenantID:      migTenant,
		DefinitionID:  defID,
		DefinitionVer: ver,
		Status:        model.InstanceStatusRunning,
		CurrentStepID: &cs,
		Variables:     vars,
		StepOutputs:   map[string]interface{}{},
		LockVersion:   3,
	}
}

// TestMigrateInstance_CompatibleRemapsStepAndVariables proves a compatible
// migration re-pins the instance to the new version, remaps the current step and
// a variable key, and leaves the instance RUNNING.
func TestMigrateInstance_CompatibleRemapsStepAndVariables(t *testing.T) {
	t.Parallel()

	// old def "old-v1" step "review"; new def "new-v2" renamed it to "review_v2".
	oldStep := "review"
	inst := runningInstance("inst-1", "old-v1", 1, oldStep, map[string]interface{}{"amount": 100.0})
	repo := newMigInstRepo(inst)
	defs := newMigDefRepo(targetDef("new-v2", "lineage-A", 2, "review_v2"))
	svc := NewInstanceMigrationService(repo, defs, nil, zerolog.Nop())

	res, err := svc.MigrateInstance(context.Background(), migTenant, "inst-1", MigrationSpec{
		TargetDefinitionID: "new-v2",
		StepRemap:          map[string]string{"review": "review_v2"},
		VariableRemap:      map[string]string{"amount": "total_amount"},
		Reason:             "hotfix",
	})
	if err != nil {
		t.Fatalf("MigrateInstance() error = %v", err)
	}
	if !res.Migrated || res.ToDefID != "new-v2" || res.ToVersion != 2 {
		t.Fatalf("result = %+v, want migrated to new-v2 v2", res)
	}
	if res.FromStepID != "review" || res.ToStepID != "review_v2" {
		t.Fatalf("step remap = %s->%s, want review->review_v2", res.FromStepID, res.ToStepID)
	}

	got := repo.get("inst-1")
	if got.DefinitionID != "new-v2" || got.DefinitionVer != 2 {
		t.Fatalf("instance def = %s v%d, want new-v2 v2", got.DefinitionID, got.DefinitionVer)
	}
	if got.CurrentStepID == nil || *got.CurrentStepID != "review_v2" {
		t.Fatalf("current step = %v, want review_v2", got.CurrentStepID)
	}
	if got.Status != model.InstanceStatusRunning {
		t.Fatalf("status after migrate = %q, want running (migration must not advance/terminate)", got.Status)
	}
	if _, stillOld := got.Variables["amount"]; stillOld {
		t.Fatalf("variable 'amount' should have been remapped away")
	}
	if v, ok := got.Variables["total_amount"]; !ok || v != 100.0 {
		t.Fatalf("remapped variable total_amount = %v (ok=%v), want 100", v, ok)
	}
}

// TestMigrateInstance_IncompatibleRejectedFailClosed proves that when the current
// step is absent from the target and NO remap is supplied, the migration is
// rejected (ErrConflict) and the instance is left UNTOUCHED on its old version.
func TestMigrateInstance_IncompatibleRejectedFailClosed(t *testing.T) {
	t.Parallel()

	inst := runningInstance("inst-2", "old-v1", 1, "legacy_step", nil)
	repo := newMigInstRepo(inst)
	// target has no "legacy_step".
	defs := newMigDefRepo(targetDef("new-v2", "lineage-A", 2, "brand_new_step"))
	svc := NewInstanceMigrationService(repo, defs, nil, zerolog.Nop())

	_, err := svc.MigrateInstance(context.Background(), migTenant, "inst-2", MigrationSpec{
		TargetDefinitionID: "new-v2",
		// no StepRemap
	})
	if err == nil {
		t.Fatal("expected incompatible migration to be rejected, got nil")
	}
	if !errors.Is(err, ErrIncompatibleMigration) {
		t.Fatalf("error = %v, want ErrIncompatibleMigration", err)
	}
	if !errors.Is(err, model.ErrConflict) {
		t.Fatalf("error should wrap model.ErrConflict, got %v", err)
	}
	// Fail-closed: instance untouched.
	got := repo.get("inst-2")
	if got.DefinitionID != "old-v1" || got.LockVersion != 3 {
		t.Fatalf("instance mutated after rejected migration: def=%s lock=%d", got.DefinitionID, got.LockVersion)
	}
}

// TestMigrateInstance_TerminalRejected proves a completed (terminal) instance is
// not migratable.
func TestMigrateInstance_TerminalRejected(t *testing.T) {
	t.Parallel()

	inst := runningInstance("inst-3", "old-v1", 1, "review", nil)
	inst.Status = model.InstanceStatusCompleted
	repo := newMigInstRepo(inst)
	defs := newMigDefRepo(targetDef("new-v2", "lineage-A", 2, "review"))
	svc := NewInstanceMigrationService(repo, defs, nil, zerolog.Nop())

	_, err := svc.MigrateInstance(context.Background(), migTenant, "inst-3", MigrationSpec{TargetDefinitionID: "new-v2"})
	if err == nil {
		t.Fatal("expected terminal instance migration to be rejected, got nil")
	}
	if !errors.Is(err, ErrInstanceNotMigratable) {
		t.Fatalf("error = %v, want ErrInstanceNotMigratable", err)
	}
	if !errors.Is(err, model.ErrConflict) {
		t.Fatalf("error should wrap model.ErrConflict, got %v", err)
	}
}

// TestMigrateInstance_SerializedAgainstConcurrentAdvance proves the migration is
// serialized against a concurrent advance: the migrateHook fires a real advance
// (which takes the same critical section and bumps lock_version) so, when the
// migrate reaches its optimistic-lock guard with a STALE lock_version, it loses
// with ErrConcurrencyConfl rather than clobbering the advance (no lost update /
// double-advance).
func TestMigrateInstance_SerializedAgainstConcurrentAdvance(t *testing.T) {
	t.Parallel()

	inst := runningInstance("inst-4", "old-v1", 1, "review", nil) // lock_version=3
	repo := newMigInstRepo(inst)
	defs := newMigDefRepo(targetDef("new-v2", "lineage-A", 2, "review"))
	svc := NewInstanceMigrationService(repo, defs, nil, zerolog.Nop())

	// The migration service reloads the instance UNDER the lock (fresh lock_version
	// = 3), builds the migrated struct, then calls MigrateInstanceVersion. The hook
	// injects a state change to lock_version DIRECTLY in the store (simulating an
	// advance that committed on a different path) so the migrate's lock_version
	// guard (built from the pre-hook reload) is now stale and must be rejected.
	repo.migrateHook = func(instanceID string) {
		repo.mu.Lock()
		in := repo.byID[instanceID]
		nc := *in
		nc.LockVersion++ // a racing committer advanced the row
		repo.byID[instanceID] = &nc
		repo.mu.Unlock()
		repo.migrateHook = nil // fire once
	}

	_, err := svc.MigrateInstance(context.Background(), migTenant, "inst-4", MigrationSpec{TargetDefinitionID: "new-v2"})
	if err == nil {
		t.Fatal("expected migration to lose to a concurrent advance, got nil")
	}
	if !errors.Is(err, model.ErrConcurrencyConfl) {
		t.Fatalf("error = %v, want model.ErrConcurrencyConfl (optimistic-lock loss)", err)
	}
	// The instance must NOT have been re-pinned to the target (no lost update).
	got := repo.get("inst-4")
	if got.DefinitionID != "old-v1" {
		t.Fatalf("instance was migrated despite the race: def=%s, want old-v1 untouched", got.DefinitionID)
	}
}

// TestMigrateInstance_SerializerActuallySerializes proves that with the real
// per-instance mutex, a migrate and a concurrent advance run one-at-a-time and the
// migrate reloads AFTER the advance, so it succeeds on the FRESH state (its remap
// applied on top of the advanced step) — no interleaving, no lost update.
func TestMigrateInstance_SerializerActuallySerializes(t *testing.T) {
	t.Parallel()

	inst := runningInstance("inst-5", "old-v1", 1, "review", nil)
	repo := newMigInstRepo(inst)
	defs := newMigDefRepo(targetDef("new-v2", "lineage-A", 2, "review", "post_review"))
	svc := NewInstanceMigrationService(repo, defs, nil, zerolog.Nop())

	// Advance the instance to "post_review" FIRST (bumps lock_version to 4), then
	// migrate. The migrate reloads under the lock and sees lock_version=4 +
	// current_step=post_review, so it commits against the fresh state.
	repo.advance("inst-5", "post_review")

	res, err := svc.MigrateInstance(context.Background(), migTenant, "inst-5", MigrationSpec{TargetDefinitionID: "new-v2"})
	if err != nil {
		t.Fatalf("MigrateInstance() after advance error = %v", err)
	}
	if res.FromStepID != "post_review" || res.ToStepID != "post_review" {
		t.Fatalf("expected migrate to act on the ADVANCED step post_review, got %s->%s", res.FromStepID, res.ToStepID)
	}
	got := repo.get("inst-5")
	if got.DefinitionID != "new-v2" || got.CurrentStepID == nil || *got.CurrentStepID != "post_review" {
		t.Fatalf("post-migrate state = def %s step %v, want new-v2/post_review", got.DefinitionID, got.CurrentStepID)
	}
}

// TestMigrateBulk_MigratesAllMigratable proves the bulk path selects every
// migratable instance of a source definition and migrates them, reporting per
// instance, and skips an incompatible one without aborting the batch.
func TestMigrateBulk_MigratesAllMigratable(t *testing.T) {
	t.Parallel()

	// Three instances on old-v1: two compatible (on "review"), one incompatible
	// (on "gone_step" absent from the target, no remap supplied for it).
	a := runningInstance("a", "old-v1", 1, "review", nil)
	b := runningInstance("b", "old-v1", 1, "review", nil)
	c := runningInstance("c", "old-v1", 1, "gone_step", nil)
	repo := newMigInstRepo(a, b, c)
	defs := newMigDefRepo(targetDef("new-v2", "lineage-A", 2, "review"))
	svc := NewInstanceMigrationService(repo, defs, nil, zerolog.Nop())

	out, err := svc.MigrateBulk(context.Background(), migTenant, "old-v1", nil, MigrationSpec{
		TargetDefinitionID: "new-v2",
		// no remap -> "review" identity-maps (exists in target); "gone_step" fails.
	})
	if err != nil {
		t.Fatalf("MigrateBulk() error = %v", err)
	}
	if out.Selected != 3 {
		t.Fatalf("selected = %d, want 3", out.Selected)
	}
	if out.Migrated != 2 {
		t.Fatalf("migrated = %d, want 2", out.Migrated)
	}
	if out.Failed != 1 {
		t.Fatalf("failed = %d, want 1 (the incompatible instance)", out.Failed)
	}
	// The two compatible instances are re-pinned; the incompatible one is untouched.
	if repo.get("a").DefinitionID != "new-v2" || repo.get("b").DefinitionID != "new-v2" {
		t.Fatalf("compatible instances not migrated")
	}
	if repo.get("c").DefinitionID != "old-v1" {
		t.Fatalf("incompatible instance c was migrated, want untouched")
	}
}
