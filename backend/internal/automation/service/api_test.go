package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/repository"
)

// =============================================================================
// fakeServiceStore extensions for the WP-13 request-path ServiceRepository
// surface (CRUD + run history + execution log). These complete the in-memory
// fake so the AutomationService's api.go methods are exercised with no database.
// =============================================================================

func (f *fakeServiceStore) CreateAutomation(_ context.Context, _ repository.DBTX, a *model.Automation) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, existing := range f.automations {
		if existing.TenantID == a.TenantID && existing.Name == a.Name {
			return model.ErrAlreadyExists
		}
	}
	if a.ID == "" {
		a.ID = "auto-" + a.Name
	}
	now := time.Now().UTC()
	a.CreatedAt = now
	a.UpdatedAt = now
	cp := *a
	cp.Rules = append([]model.Rule(nil), a.Rules...)
	f.automations[a.ID] = &cp
	f.rules[a.ID] = append([]model.Rule(nil), a.Rules...)
	if a.Trigger.Type == model.TriggerTypeWebhook && a.Trigger.WebhookToken != "" {
		f.webhooks[a.Trigger.WebhookToken] = a.ID
	}
	return nil
}

func (f *fakeServiceStore) ListAutomations(_ context.Context, _ repository.DBTX, tenantID string) ([]*model.Automation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*model.Automation
	for _, a := range f.automations {
		if a.TenantID == tenantID {
			cp := *a
			out = append(out, &cp)
		}
	}
	return out, nil
}

func (f *fakeServiceStore) UpdateAutomation(_ context.Context, _ repository.DBTX, a *model.Automation) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	existing, ok := f.automations[a.ID]
	if !ok || existing.TenantID != a.TenantID {
		return model.ErrNotFound
	}
	a.CreatedAt = existing.CreatedAt
	a.UpdatedAt = time.Now().UTC()
	cp := *a
	cp.Rules = append([]model.Rule(nil), a.Rules...)
	f.automations[a.ID] = &cp
	f.rules[a.ID] = append([]model.Rule(nil), a.Rules...)
	return nil
}

func (f *fakeServiceStore) DeleteAutomation(_ context.Context, _ repository.DBTX, tenantID, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	a, ok := f.automations[id]
	if !ok || a.TenantID != tenantID {
		return model.ErrNotFound
	}
	delete(f.automations, id)
	delete(f.rules, id)
	return nil
}

func (f *fakeServiceStore) CreateRunbook(_ context.Context, _ repository.DBTX, rb *model.Runbook) error {
	if rb.ID == "" {
		rb.ID = "rb-" + rb.Name
	}
	now := time.Now().UTC()
	rb.CreatedAt = now
	rb.UpdatedAt = now
	for i := range rb.Steps {
		rb.Steps[i].RunbookID = rb.ID
		rb.Steps[i].Index = i
	}
	f.memStore.putRunbook(&model.Runbook{
		ID: rb.ID, TenantID: rb.TenantID, Name: rb.Name,
		Steps: append([]model.RunbookStep(nil), rb.Steps...),
	})
	return nil
}

func (f *fakeServiceStore) ListRuns(_ context.Context, _ repository.DBTX, tenantID string, limit, offset int) ([]*model.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var all []*model.Run
	for _, r := range f.createdRuns {
		if r.TenantID == tenantID {
			cp := *r
			all = append(all, &cp)
		}
	}
	if offset >= len(all) {
		return nil, nil
	}
	end := offset + limit
	if limit <= 0 || end > len(all) {
		end = len(all)
	}
	return all[offset:end], nil
}

func (f *fakeServiceStore) ListRunSteps(_ context.Context, _ repository.DBTX, runID string) ([]*model.RunStep, error) {
	f.memStore.mu.Lock()
	defer f.memStore.mu.Unlock()
	var out []*model.RunStep
	for _, s := range f.memStore.steps {
		if s.RunID == runID {
			cp := *s
			out = append(out, &cp)
		}
	}
	return out, nil
}

// putRunStepDirect seeds a run-step log row directly (bypassing the orchestrator)
// so a replay/gap test can construct an arbitrary append-only log.
func (f *fakeServiceStore) putRunStepDirect(s *model.RunStep) {
	f.memStore.mu.Lock()
	defer f.memStore.mu.Unlock()
	cp := *s
	f.memStore.steps[key(s.RunID, s.Index)] = &cp
}

// putRunDirect seeds a run row directly (in both createdRuns and the memStore) so
// run-history and replay tests can stage a terminal run.
func (f *fakeServiceStore) putRunDirect(r *model.Run) {
	f.mu.Lock()
	cp := *r
	f.createdRuns = append(f.createdRuns, &cp)
	f.mu.Unlock()
	f.memStore.putRun(&cp)
}

// =============================================================================
// Tests
// =============================================================================

func TestCreateAutomation_ValidatesAndPersists(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	ctx := context.Background()

	// Seed a runbook the automation can bind to.
	if _, err := svc.CreateRunbook(ctx, tnt, &model.Runbook{
		Name:  "rb1",
		Steps: []model.RunbookStep{{Type: model.StepTypeAction, Action: model.ActionRef{Kind: model.ActionNotification}}},
	}); err != nil {
		t.Fatalf("CreateRunbook: %v", err)
	}

	a, err := svc.CreateAutomation(ctx, tnt, &model.Automation{
		Name:      "watch-critical",
		Enabled:   true,
		RunbookID: "rb-rb1",
		Trigger:   model.TriggerConfig{Type: model.TriggerTypeEvent, Topic: "platform.cyber.events"},
		Rules:     []model.Rule{{Priority: 1, ActionRef: model.ActionRef{Kind: model.ActionNotification}}},
	})
	if err != nil {
		t.Fatalf("CreateAutomation: %v", err)
	}
	if a.ID == "" {
		t.Fatal("expected a generated automation id")
	}

	got, err := svc.GetAutomationByID(ctx, tnt, a.ID)
	if err != nil {
		t.Fatalf("GetAutomationByID: %v", err)
	}
	if got.Name != "watch-critical" || got.Trigger.Topic != "platform.cyber.events" {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
}

func TestCreateAutomation_RejectsBadTriggerAndCron(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	ctx := context.Background()

	cases := []struct {
		name string
		a    *model.Automation
	}{
		{"missing runbook", &model.Automation{Name: "x", Trigger: model.TriggerConfig{Type: model.TriggerTypeManual}}},
		{"missing name", &model.Automation{RunbookID: "rb", Trigger: model.TriggerConfig{Type: model.TriggerTypeManual}}},
		{"event without topic", &model.Automation{Name: "x", RunbookID: "rb", Trigger: model.TriggerConfig{Type: model.TriggerTypeEvent}}},
		{"bad cron", &model.Automation{Name: "x", RunbookID: "rb", Trigger: model.TriggerConfig{Type: model.TriggerTypeSchedule, Cron: "not a cron"}}},
		{"unknown trigger", &model.Automation{Name: "x", RunbookID: "rb", Trigger: model.TriggerConfig{Type: "telepathy"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := svc.CreateAutomation(ctx, tnt, tc.a); !errors.Is(err, model.ErrInvalidConfig) {
				t.Fatalf("expected ErrInvalidConfig, got %v", err)
			}
		})
	}
}

func TestCreateRunbook_ValidatesSteps(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	ctx := context.Background()

	if _, err := svc.CreateRunbook(ctx, tnt, &model.Runbook{Name: "empty"}); !errors.Is(err, model.ErrInvalidConfig) {
		t.Fatalf("expected ErrInvalidConfig for empty runbook, got %v", err)
	}
	if _, err := svc.CreateRunbook(ctx, tnt, &model.Runbook{
		Name:  "bad-action",
		Steps: []model.RunbookStep{{Type: model.StepTypeAction, Action: model.ActionRef{Kind: "teleport"}}},
	}); !errors.Is(err, model.ErrInvalidConfig) {
		t.Fatalf("expected ErrInvalidConfig for bad action kind, got %v", err)
	}
	rb, err := svc.CreateRunbook(ctx, tnt, &model.Runbook{
		Name: "good",
		Steps: []model.RunbookStep{
			{Type: model.StepTypeAction, Action: model.ActionRef{Kind: model.ActionStartWorkflow}},
			{Type: model.StepTypeApprovalGate, ApproverRoles: []string{"lead"}, TimeoutAction: model.TimeoutActionEscalate},
		},
	})
	if err != nil {
		t.Fatalf("CreateRunbook good: %v", err)
	}
	if len(rb.Steps) != 2 || rb.Steps[1].Index != 1 {
		t.Fatalf("expected 2 indexed steps, got %+v", rb.Steps)
	}
}

func TestGetRunWithLog_ReportsReplayable(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	ctx := context.Background()

	now := time.Now().UTC()
	store.putRunDirect(&model.Run{
		ID: "run-1", TenantID: tnt, AutomationID: "a1", RunbookID: "rb1",
		Status: model.RunStatusCompleted, CurrentStep: 2, CompletedAt: &now,
	})
	store.putRunStepDirect(&model.RunStep{RunID: "run-1", Index: 0, Status: model.StepStatusOK})
	store.putRunStepDirect(&model.RunStep{RunID: "run-1", Index: 1, Status: model.StepStatusOK})

	got, err := svc.GetRunWithLog(ctx, tnt, "run-1")
	if err != nil {
		t.Fatalf("GetRunWithLog: %v", err)
	}
	if !got.Replayable || got.GapAt != -1 {
		t.Fatalf("expected replayable with no gap, got replayable=%v gap=%d", got.Replayable, got.GapAt)
	}
	if len(got.Steps) != 2 {
		t.Fatalf("expected 2 log steps, got %d", len(got.Steps))
	}
}

func TestGetRunWithLog_GapMarksNonReplayable(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	ctx := context.Background()

	// Run advanced through 3 steps but the log is missing index 1 (a gap).
	store.putRunDirect(&model.Run{
		ID: "run-gap", TenantID: tnt, RunbookID: "rb1",
		Status: model.RunStatusCompleted, CurrentStep: 3,
	})
	store.putRunStepDirect(&model.RunStep{RunID: "run-gap", Index: 0, Status: model.StepStatusOK})
	store.putRunStepDirect(&model.RunStep{RunID: "run-gap", Index: 2, Status: model.StepStatusOK})

	got, err := svc.GetRunWithLog(ctx, tnt, "run-gap")
	if err != nil {
		t.Fatalf("GetRunWithLog: %v", err)
	}
	if got.Replayable {
		t.Fatal("expected non-replayable due to log gap")
	}
	if got.GapAt != 1 {
		t.Fatalf("expected gap at index 1, got %d", got.GapAt)
	}
}

func TestReplay_CreatesNewRunFromRecordedInputs(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	ctx := context.Background()

	recordedTrigger := map[string]any{
		"trigger": map[string]any{"type": "event", "data": map[string]any{"severity": "critical"}},
	}
	now := time.Now().UTC()
	store.putRunDirect(&model.Run{
		ID: "run-done", TenantID: tnt, AutomationID: "a1", RunbookID: "rb1",
		Status: model.RunStatusCompleted, CurrentStep: 2, CompletedAt: &now,
		SourceEventID: "evt-orig", Trigger: recordedTrigger,
	})
	store.putRunStepDirect(&model.RunStep{RunID: "run-done", Index: 0, Status: model.StepStatusOK})
	store.putRunStepDirect(&model.RunStep{RunID: "run-done", Index: 1, Status: model.StepStatusOK})

	before := store.runCount()
	newRun, err := svc.Replay(ctx, tnt, "run-done")
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if store.runCount() != before+1 {
		t.Fatalf("expected one new run created, count %d -> %d", before, store.runCount())
	}
	if newRun.ReplayOf == nil || *newRun.ReplayOf != "run-done" {
		t.Fatalf("expected replay_of=run-done, got %v", newRun.ReplayOf)
	}
	if newRun.Status != model.RunStatusPending {
		t.Fatalf("expected new run PENDING (driver re-executes it), got %s", newRun.Status)
	}
	if newRun.RunbookID != "rb1" || newRun.AutomationID != "a1" {
		t.Fatalf("expected lineage preserved, got %+v", newRun)
	}
	// The recorded trigger is carried verbatim as the replay input (§4.7).
	tw, _ := newRun.Trigger["trigger"].(map[string]any)
	data, _ := tw["data"].(map[string]any)
	if data["severity"] != "critical" {
		t.Fatalf("expected recorded trigger replayed, got %+v", newRun.Trigger)
	}
	// A fresh source_event_id keeps the (tenant, source_event_id) backstop happy
	// and lets the same run be replayed again.
	if newRun.SourceEventID == "evt-orig" || newRun.SourceEventID == "" {
		t.Fatalf("expected a fresh replay source_event_id, got %q", newRun.SourceEventID)
	}
}

func TestReplay_RejectsNonTerminalRun(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	ctx := context.Background()

	store.putRunDirect(&model.Run{ID: "run-live", TenantID: tnt, RunbookID: "rb1", Status: model.RunStatusRunning, CurrentStep: 1})
	if _, err := svc.Replay(ctx, tnt, "run-live"); !errors.Is(err, ErrNonReplayable) {
		t.Fatalf("expected ErrNonReplayable for a running run, got %v", err)
	}
}

func TestReplay_RejectsRunWithLogGap(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	ctx := context.Background()

	store.putRunDirect(&model.Run{ID: "run-gappy", TenantID: tnt, RunbookID: "rb1", Status: model.RunStatusCompleted, CurrentStep: 2})
	store.putRunStepDirect(&model.RunStep{RunID: "run-gappy", Index: 0, Status: model.StepStatusOK})
	// Index 1 missing -> gap.

	_, err := svc.Replay(ctx, tnt, "run-gappy")
	if !errors.Is(err, ErrNonReplayable) {
		t.Fatalf("expected ErrNonReplayable for a log gap, got %v", err)
	}
}

func TestReplay_NotFound(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	if _, err := svc.Replay(context.Background(), tnt, "ghost"); !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestApproveRun_RequiresAwaitingApproval(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	ctx := context.Background()

	store.putRunDirect(&model.Run{ID: "run-running", TenantID: tnt, RunbookID: "rb1", Status: model.RunStatusRunning, CurrentStep: 0})
	if _, err := svc.ApproveRun(ctx, tnt, "run-running", "user-1", "ok"); !errors.Is(err, model.ErrConflict) {
		t.Fatalf("expected ErrConflict approving a non-parked run, got %v", err)
	}
}

func TestApproveRun_MeetsQuorumAndReArms(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	ctx := context.Background()

	// Park a run on an open gate at step index 1 (quorum 1).
	store.putRunDirect(&model.Run{ID: "run-parked", TenantID: tnt, RunbookID: "rb1", Status: model.RunStatusAwaitingApproval, CurrentStep: 1})
	if err := store.memStore.UpsertApprovalGate(ctx, nil, &model.ApprovalGate{
		RunID: "run-parked", TenantID: tnt, StepIndex: 1, Status: model.GateStatusOpen, Quorum: 1,
	}); err != nil {
		t.Fatalf("seed gate: %v", err)
	}

	gate, err := svc.ApproveRun(ctx, tnt, "run-parked", "approver-1", "lgtm")
	if err != nil {
		t.Fatalf("ApproveRun: %v", err)
	}
	if gate.Status != model.GateStatusApproved {
		t.Fatalf("expected gate APPROVED, got %s", gate.Status)
	}
	// The run is re-armed RUNNING for the driver (resolveApproved does not advance).
	if got := store.memStore.run("run-parked"); got.Status != model.RunStatusRunning {
		t.Fatalf("expected run re-armed RUNNING, got %s", got.Status)
	}
}

func TestRejectRun_FailsTheRun(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	ctx := context.Background()

	store.putRunDirect(&model.Run{ID: "run-reject", TenantID: tnt, RunbookID: "rb1", Status: model.RunStatusAwaitingApproval, CurrentStep: 0})
	if err := store.memStore.UpsertApprovalGate(ctx, nil, &model.ApprovalGate{
		RunID: "run-reject", TenantID: tnt, StepIndex: 0, Status: model.GateStatusOpen, Quorum: 1,
	}); err != nil {
		t.Fatalf("seed gate: %v", err)
	}

	gate, err := svc.RejectRun(ctx, tnt, "run-reject", "approver-1", "nope")
	if err != nil {
		t.Fatalf("RejectRun: %v", err)
	}
	if gate.Status != model.GateStatusRejected {
		t.Fatalf("expected gate REJECTED, got %s", gate.Status)
	}
	if got := store.memStore.run("run-reject"); got.Status != model.RunStatusFailed {
		t.Fatalf("expected run FAILED after rejection, got %s", got.Status)
	}
}

// Compile-time proof the assembled service satisfies the handler's narrow
// expectations (kept here so a service-method signature change is caught in the
// package that owns the methods).
var _ interface {
	CreateAutomation(ctx context.Context, tenantID string, a *model.Automation) (*model.Automation, error)
	Replay(ctx context.Context, tenantID, originalID string) (*model.Run, error)
	GetRunWithLog(ctx context.Context, tenantID, runID string) (*RunWithLog, error)
} = (*AutomationService)(nil)
