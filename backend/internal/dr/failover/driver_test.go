package failover

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

func TestDriverAdvance_HappyPathNonSkippableGates(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	repo := newFakeRepo(model.StatusInitiated)
	sink := &fakeSink{}
	run := &model.FailoverRun{
		ID:                  "run-1",
		TenantID:            "tenant-1",
		GroupID:             "group-1",
		Mode:                model.ModeDrill,
		Status:              model.StatusInitiated,
		RTOObjectiveSeconds: 900,
		InitiatedBy:         "user-1",
		InitiatedAt:         now.Add(-2 * time.Minute),
	}
	drv := newTestDriver(t, repo, sink, now)

	if err := drv.Advance(context.Background(), nil, run); err != nil {
		t.Fatalf("advance quiesce/final-sync: %v", err)
	}
	if run.Status != model.StatusQuiescing {
		t.Fatalf("after quiesce status = %s", run.Status)
	}
	if repo.pinnedRecoveryPoint != "" {
		t.Fatalf("pinned recovery point before gate1: %s", repo.pinnedRecoveryPoint)
	}

	if err := drv.Advance(context.Background(), nil, run); err != nil {
		t.Fatalf("advance gate1: %v", err)
	}
	if run.Status != model.StatusSyncConfirmed {
		t.Fatalf("after gate1 status = %s", run.Status)
	}
	if repo.pinnedRecoveryPoint != "rp-1" {
		t.Fatalf("pinned recovery point = %q", repo.pinnedRecoveryPoint)
	}

	if err := drv.Advance(context.Background(), nil, run); err != nil {
		t.Fatalf("advance approval wait: %v", err)
	}
	if run.Status != model.StatusAwaitingApproval {
		t.Fatalf("after approval wait status = %s", run.Status)
	}

	approver := "approver-1"
	run.Status = model.StatusApproved
	run.ApprovedBy = &approver
	repo.current = model.StatusApproved

	for _, label := range []string{"approved", "execute", "health", "attest"} {
		if err := drv.Advance(context.Background(), nil, run); err != nil {
			t.Fatalf("advance %s: %v", label, err)
		}
	}
	if run.Status != model.StatusCompleted {
		t.Fatalf("final status = %s, want %s", run.Status, model.StatusCompleted)
	}
	if repo.attestation == nil {
		t.Fatalf("attestation was not created")
	}

	wantTransitions := []string{
		model.StatusInitiated + "->" + model.StatusQuiescing,
		model.StatusQuiescing + "->" + model.StatusSyncConfirmed,
		model.StatusSyncConfirmed + "->" + model.StatusAwaitingApproval,
		model.StatusApproved + "->" + model.StatusExecuting,
		model.StatusExecuting + "->" + model.StatusValidating,
		model.StatusValidating + "->" + model.StatusAttested,
	}
	if !reflect.DeepEqual(repo.transitions, wantTransitions) {
		t.Fatalf("transitions = %#v, want %#v", repo.transitions, wantTransitions)
	}

	wantEvents := []string{
		"datastream.dr.failover.quiescing",
		"datastream.dr.failover.quiesced",
		"datastream.dr.failover.gate1.passed",
		"datastream.dr.failover.approval.required",
		"datastream.dr.failover.gate2.approved",
		"datastream.dr.failover.gate3.executed",
		"datastream.dr.failover.recovery.validated",
		"datastream.dr.attestation.issued",
	}
	if !reflect.DeepEqual(sink.types, wantEvents) {
		t.Fatalf("events = %#v, want %#v", sink.types, wantEvents)
	}
}

func TestDriverAdvance_QuiesceFinalSyncPinsFreshCandidate(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	repo := newFakeRepo(model.StatusInitiated)
	sink := &fakeSink{}
	run := &model.FailoverRun{
		ID:       "run-1",
		TenantID: "tenant-1",
		GroupID:  "group-1",
		Mode:     model.ModeReal,
		Status:   model.StatusInitiated,
	}
	drv := newTestDriver(t, repo, sink, now)
	drv.final = fakeFinalSyncer{result: FinalSyncResult{
		RecoveryPointID: "rp-final",
		RPOSeconds:      4,
		ValidationRatio: 1.0,
		Details:         map[string]any{"source": "fresh-final-sync"},
	}}
	drv.validate = fakeValidator{decision: RecoveryPointDecision{
		RecoveryPointID: "rp-final",
		RPOSeconds:      4,
		ValidationRatio: 1.0,
	}}

	if err := drv.Advance(context.Background(), nil, run); err != nil {
		t.Fatalf("advance begin quiescing: %v", err)
	}
	if run.Status != model.StatusQuiescing {
		t.Fatalf("status = %s, want %s", run.Status, model.StatusQuiescing)
	}
	if repo.pinnedRecoveryPoint != "" {
		t.Fatalf("pinned recovery point before final sync = %q, want none", repo.pinnedRecoveryPoint)
	}

	if err := drv.Advance(context.Background(), nil, run); err != nil {
		t.Fatalf("advance quiesce/final-sync: %v", err)
	}
	if run.Status != model.StatusSyncConfirmed {
		t.Fatalf("status = %s, want %s", run.Status, model.StatusSyncConfirmed)
	}
	if repo.pinnedRecoveryPoint != "rp-final" {
		t.Fatalf("pinned recovery point = %q, want rp-final", repo.pinnedRecoveryPoint)
	}
	if run.RecoveryPointID == nil || *run.RecoveryPointID != "rp-final" {
		t.Fatalf("run recovery point = %v, want rp-final", run.RecoveryPointID)
	}
	if len(repo.steps) < 1 {
		t.Fatalf("steps = %d, want quiesce step", len(repo.steps))
	}
	detail := repo.steps[0].Detail
	if detail["recovery_point_id"] != "rp-final" || detail["source"] != "fresh-final-sync" {
		t.Fatalf("quiesce detail = %#v", detail)
	}
}

func TestDriverAdvance_QuiescingRestartReusesPassedFinalSyncStep(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	repo := newFakeRepo(model.StatusQuiescing)
	repo.steps = []model.FailoverStep{{
		RunID:  "run-1",
		Step:   stepQuiesceFinalSync,
		Status: model.StepStatusPassed,
		Detail: map[string]any{
			"recovery_point_id": "rp-final",
			"rpo_seconds":       float64(4),
			"validation_ratio":  float64(1),
		},
	}}
	sink := &fakeSink{}
	run := &model.FailoverRun{
		ID:       "run-1",
		TenantID: "tenant-1",
		GroupID:  "group-1",
		Mode:     model.ModeReal,
		Status:   model.StatusQuiescing,
	}
	drv := newTestDriver(t, repo, sink, now)
	drv.final = fakeFinalSyncer{err: errors.New("final sync should not run for a passed quiesce step")}
	drv.validate = fakeValidator{decision: RecoveryPointDecision{
		RecoveryPointID: "rp-final",
		RPOSeconds:      4,
		ValidationRatio: 1.0,
	}}

	if err := drv.Advance(context.Background(), nil, run); err != nil {
		t.Fatalf("advance restart from quiescing: %v", err)
	}
	if run.Status != model.StatusSyncConfirmed {
		t.Fatalf("status = %s, want %s", run.Status, model.StatusSyncConfirmed)
	}
	if repo.pinnedRecoveryPoint != "rp-final" {
		t.Fatalf("pinned recovery point = %q, want rp-final", repo.pinnedRecoveryPoint)
	}
	if !reflect.DeepEqual(sink.types, []string{"datastream.dr.failover.gate1.passed"}) {
		t.Fatalf("events = %#v", sink.types)
	}
}

func TestDriverAdvance_QuiesceFinalSyncFailureIsDurableRunFailure(t *testing.T) {
	repo := newFakeRepo(model.StatusQuiescing)
	sink := &fakeSink{}
	run := &model.FailoverRun{
		ID:       "run-1",
		TenantID: "tenant-1",
		GroupID:  "group-1",
		Mode:     model.ModeReal,
		Status:   model.StatusQuiescing,
	}
	drv := newTestDriver(t, repo, sink, time.Now())
	drv.final = fakeFinalSyncer{err: errors.New("seal failed")}

	err := drv.Advance(context.Background(), nil, run)
	if err == nil {
		t.Fatal("expected final-sync failure")
	}
	if !IsRecordedFailure(err) {
		t.Fatalf("final-sync failure was not durably recorded: %T %v", err, err)
	}
	if run.Status != model.StatusFailed {
		t.Fatalf("status = %s, want %s", run.Status, model.StatusFailed)
	}
	if repo.pinnedRecoveryPoint != "" {
		t.Fatalf("pinned recovery point = %q, want none", repo.pinnedRecoveryPoint)
	}
}

func TestDriverAdvance_Gate1FailureStopsBeforeApproval(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	repo := newFakeRepo(model.StatusQuiescing)
	sink := &fakeSink{}
	run := &model.FailoverRun{
		ID:       "run-1",
		TenantID: "tenant-1",
		GroupID:  "group-1",
		Mode:     model.ModeReal,
		Status:   model.StatusQuiescing,
	}
	drv := newTestDriver(t, repo, sink, now)
	drv.final = fakeFinalSyncer{result: FinalSyncResult{
		RecoveryPointID: "rp-bad",
		RPOSeconds:      12,
		ValidationRatio: 0.990,
	}}
	drv.validate = fakeValidator{decision: RecoveryPointDecision{
		RecoveryPointID: "rp-bad",
		ValidationRatio: 0.990,
	}}

	err := drv.Advance(context.Background(), nil, run)
	if err == nil {
		t.Fatalf("expected gate1 failure")
	}
	if !IsRecordedFailure(err) {
		t.Fatalf("gate1 failure was not marked as durably recorded: %T %v", err, err)
	}
	if run.Status != model.StatusFailed {
		t.Fatalf("status = %s, want %s", run.Status, model.StatusFailed)
	}
	if repo.pinnedRecoveryPoint != "" {
		t.Fatalf("pinned recovery point on failed validation: %s", repo.pinnedRecoveryPoint)
	}
	if repo.completed != model.StatusFailed {
		t.Fatalf("completed status = %s, want %s", repo.completed, model.StatusFailed)
	}
	if !reflect.DeepEqual(sink.types, []string{
		"datastream.dr.failover.quiesced",
		"datastream.dr.failover.failed",
	}) {
		t.Fatalf("events = %#v", sink.types)
	}
}

func TestDriverAdvance_AwaitingApprovalDoesNothing(t *testing.T) {
	repo := newFakeRepo(model.StatusAwaitingApproval)
	exec := &fakeExecutor{}
	drv := mustDriver(t, Config{
		Repository: repo,
		Validator:  fakeValidator{},
		Executor:   exec,
		Health:     fakeHealth{},
		Attester:   fakeAttester{},
		Events:     &fakeSink{},
	})
	run := &model.FailoverRun{
		ID:       "run-1",
		TenantID: "tenant-1",
		GroupID:  "group-1",
		Mode:     model.ModeReal,
		Status:   model.StatusAwaitingApproval,
	}
	if err := drv.Advance(context.Background(), nil, run); err != nil {
		t.Fatalf("advance awaiting approval: %v", err)
	}
	if exec.called {
		t.Fatalf("executor ran before approval")
	}
	if len(repo.transitions) != 0 {
		t.Fatalf("transitions = %#v, want none", repo.transitions)
	}
}

func TestDriverAdvance_ExecutingFailureRollsBack(t *testing.T) {
	repo := newFakeRepo(model.StatusExecuting)
	sink := &fakeSink{}
	drv := mustDriver(t, Config{
		Repository: repo,
		Validator:  fakeValidator{},
		Executor:   &fakeExecutor{err: errors.New("boot failed")},
		Health:     fakeHealth{},
		Attester:   fakeAttester{},
		Events:     sink,
	})
	run := &model.FailoverRun{
		ID:       "run-1",
		TenantID: "tenant-1",
		GroupID:  "group-1",
		Mode:     model.ModeReal,
		Status:   model.StatusExecuting,
	}

	err := drv.Advance(context.Background(), nil, run)
	if err == nil {
		t.Fatalf("expected executing failure")
	}
	if !IsRecordedFailure(err) {
		t.Fatalf("executing failure was not marked as durably recorded: %T %v", err, err)
	}
	if run.Status != model.StatusRolledBack {
		t.Fatalf("status = %s, want %s", run.Status, model.StatusRolledBack)
	}
	if got := repo.transitions; !reflect.DeepEqual(got, []string{model.StatusExecuting + "->" + model.StatusRolledBack}) {
		t.Fatalf("transitions = %#v", got)
	}
	if repo.completed != model.StatusRolledBack {
		t.Fatalf("completed status = %s, want %s", repo.completed, model.StatusRolledBack)
	}
}

func TestDriverAdvance_FailureRecordingErrorIsNotRecordedFailure(t *testing.T) {
	repo := newFakeRepo(model.StatusExecuting)
	sink := &fakeSink{err: errors.New("outbox down")}
	drv := mustDriver(t, Config{
		Repository: repo,
		Validator:  fakeValidator{},
		Executor:   &fakeExecutor{err: errors.New("boot failed")},
		Health:     fakeHealth{},
		Attester:   fakeAttester{},
		Events:     sink,
	})
	run := &model.FailoverRun{
		ID:       "run-1",
		TenantID: "tenant-1",
		GroupID:  "group-1",
		Mode:     model.ModeReal,
		Status:   model.StatusExecuting,
	}

	err := drv.Advance(context.Background(), nil, run)
	if err == nil {
		t.Fatal("expected persistence error while recording failure")
	}
	if IsRecordedFailure(err) {
		t.Fatalf("persistence failure must not be marked recorded: %T %v", err, err)
	}
	if !strings.Contains(err.Error(), "failure event write") || !strings.Contains(err.Error(), "original cause: boot failed") {
		t.Fatalf("error = %q, want failure recording context and original cause", err.Error())
	}
}

func TestDriverAdvance_TerminalFailureWriteErrorRollsBackAtCaller(t *testing.T) {
	repo := newFakeRepo(model.StatusExecuting)
	repo.completeFromStatusErr = errors.New("db write failed")
	drv := mustDriver(t, Config{
		Repository: repo,
		Validator:  fakeValidator{},
		Executor:   &fakeExecutor{err: errors.New("boot failed")},
		Health:     fakeHealth{},
		Attester:   fakeAttester{},
		Events:     &fakeSink{},
	})
	run := &model.FailoverRun{
		ID:       "run-1",
		TenantID: "tenant-1",
		GroupID:  "group-1",
		Mode:     model.ModeReal,
		Status:   model.StatusExecuting,
	}

	err := drv.Advance(context.Background(), nil, run)
	if err == nil {
		t.Fatal("expected terminal status persistence error")
	}
	if IsRecordedFailure(err) {
		t.Fatalf("terminal write failure must not be marked recorded: %T %v", err, err)
	}
	if !strings.Contains(err.Error(), "terminal status write") {
		t.Fatalf("error = %q, want terminal status write context", err.Error())
	}
}

func newTestDriver(t *testing.T, repo *fakeRepo, sink *fakeSink, now time.Time) *Driver {
	t.Helper()
	return mustDriver(t, Config{
		Repository: repo,
		FinalSyncer: fakeFinalSyncer{result: FinalSyncResult{
			RecoveryPointID: "rp-1",
			RPOSeconds:      12,
			ValidationRatio: 1.0,
		}},
		Validator: fakeValidator{decision: RecoveryPointDecision{
			RecoveryPointID: "rp-1",
			RPOSeconds:      12,
			ValidationRatio: 1.0,
		}},
		Executor: &fakeExecutor{},
		Health:   fakeHealth{detail: map[string]any{"healthy": true}},
		Attester: fakeAttester{attestation: &model.Attestation{
			ID:                  "att-1",
			RTOObjectiveSeconds: 900,
			RTOActualSeconds:    120,
			RPOSeconds:          12,
			ValidationRatio:     1.0,
			ReportObjectKey:     "worm/att-1.json",
			ContentHash:         "sha256:abc",
		}},
		Events: sink,
		Now:    func() time.Time { return now },
	})
}

func mustDriver(t *testing.T, cfg Config) *Driver {
	t.Helper()
	if cfg.FinalSyncer == nil {
		cfg.FinalSyncer = fakeFinalSyncer{result: FinalSyncResult{
			RecoveryPointID: "rp-1",
			RPOSeconds:      12,
			ValidationRatio: 1.0,
		}}
	}
	drv, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return drv
}

type fakeRepo struct {
	current               string
	transitions           []string
	pinnedRecoveryPoint   string
	steps                 []model.FailoverStep
	completed             string
	attestation           *model.Attestation
	stepErr               error
	completeFromStatusErr error
}

func newFakeRepo(status string) *fakeRepo {
	return &fakeRepo{current: status}
}

func (r *fakeRepo) UpdateFailoverRunStatus(_ context.Context, _ repository.DBTX, _, _, newStatus, expectedStatus string, _ *string) error {
	if r.current != expectedStatus {
		return model.ErrInvalidState
	}
	r.transitions = append(r.transitions, expectedStatus+"->"+newStatus)
	r.current = newStatus
	return nil
}

func (r *fakeRepo) PinRecoveryPoint(_ context.Context, _ repository.DBTX, _, _, recoveryPointID string) error {
	r.pinnedRecoveryPoint = recoveryPointID
	return nil
}

func (r *fakeRepo) UpsertFailoverStep(_ context.Context, _ repository.DBTX, step *model.FailoverStep) error {
	if r.stepErr != nil {
		return r.stepErr
	}
	cp := *step
	for i := range r.steps {
		if r.steps[i].RunID == cp.RunID && r.steps[i].Step == cp.Step {
			r.steps[i] = cp
			return nil
		}
	}
	r.steps = append(r.steps, cp)
	return nil
}

func (r *fakeRepo) ListFailoverSteps(_ context.Context, _ repository.DBTX, _ string) ([]*model.FailoverStep, error) {
	out := make([]*model.FailoverStep, 0, len(r.steps))
	for i := range r.steps {
		cp := r.steps[i]
		out = append(out, &cp)
	}
	return out, nil
}

func (r *fakeRepo) CompleteFailoverRun(_ context.Context, _ repository.DBTX, _, _, finalStatus string) error {
	if r.current != model.StatusAttested {
		return model.ErrInvalidState
	}
	r.completed = finalStatus
	r.current = finalStatus
	return nil
}

func (r *fakeRepo) CompleteFailoverRunFromStatus(_ context.Context, _ repository.DBTX, _, _, finalStatus, expectedStatus string, _ *string) error {
	if r.completeFromStatusErr != nil {
		return r.completeFromStatusErr
	}
	if r.current != expectedStatus {
		return model.ErrInvalidState
	}
	r.transitions = append(r.transitions, expectedStatus+"->"+finalStatus)
	r.completed = finalStatus
	r.current = finalStatus
	return nil
}

func (r *fakeRepo) CreateAttestation(_ context.Context, _ repository.DBTX, a *model.Attestation) error {
	cp := *a
	r.attestation = &cp
	return nil
}

type fakeValidator struct {
	decision RecoveryPointDecision
	err      error
}

func (v fakeValidator) ValidateRecoveryPoint(context.Context, *model.FailoverRun) (RecoveryPointDecision, error) {
	if v.err != nil {
		return RecoveryPointDecision{}, v.err
	}
	return v.decision, nil
}

type fakeFinalSyncer struct {
	result FinalSyncResult
	err    error
}

func (f fakeFinalSyncer) QuiesceAndSync(context.Context, *model.FailoverRun) (FinalSyncResult, error) {
	if f.err != nil {
		return FinalSyncResult{}, f.err
	}
	return f.result, nil
}

type fakeExecutor struct {
	called bool
	err    error
}

func (e *fakeExecutor) Execute(context.Context, *model.FailoverRun) error {
	e.called = true
	if e.err != nil {
		return e.err
	}
	return nil
}

type fakeHealth struct {
	detail map[string]any
	err    error
}

func (h fakeHealth) ValidateRecoveredWorkloads(context.Context, *model.FailoverRun) (map[string]any, error) {
	if h.err != nil {
		return nil, h.err
	}
	return h.detail, nil
}

type fakeAttester struct {
	attestation *model.Attestation
	err         error
}

func (a fakeAttester) BuildAttestation(context.Context, *model.FailoverRun) (*model.Attestation, error) {
	if a.err != nil {
		return nil, a.err
	}
	if a.attestation == nil {
		return nil, errors.New("missing attestation")
	}
	cp := *a.attestation
	return &cp, nil
}

type fakeSink struct {
	types []string
	err   error
}

func (s *fakeSink) Emit(_ context.Context, _ repository.DBTX, _ string, eventType string, _ any) error {
	if s.err != nil {
		return s.err
	}
	s.types = append(s.types, eventType)
	return nil
}
