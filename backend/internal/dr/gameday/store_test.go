package gameday

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
)

const (
	tenantA = "aaaaaaaa-0000-0000-0000-000000000001"
	groupA  = "11111111-0000-0000-0000-000000000001"
)

func newMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	m, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(m.Close)
	return m
}

func TestStore_CreateScenario_SerialisesSteps(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	now := time.Now()

	steps := []Step{{
		Action: ActionPauseStream, Target: "stream-1",
		Expect: Expectation{Signal: "lag_alert", DetectWithin: Duration(30 * time.Second)},
	}}
	wantJSON, _ := json.Marshal(steps)

	mock.ExpectQuery(`INSERT INTO dr_gameday_scenario`).
		WithArgs(tenantA, groupA, "pause-lag", "rehearse a pause", ScopeDrill, wantJSON).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
			AddRow("sc-1", now, now))

	sc := &Scenario{
		TenantID: tenantA, GroupID: groupA, Name: "pause-lag",
		Description: "rehearse a pause", Scope: ScopeDrill, Steps: steps,
	}
	if err := store.CreateScenario(context.Background(), mock, sc); err != nil {
		t.Fatalf("CreateScenario: %v", err)
	}
	if sc.ID != "sc-1" {
		t.Fatalf("ID = %q, want sc-1", sc.ID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_CreateScenario_DuplicateMapsToExists(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	steps := []Step{{Action: ActionPauseStream}}
	stepsJSON, _ := json.Marshal(steps)
	mock.ExpectQuery(`INSERT INTO dr_gameday_scenario`).
		WithArgs(tenantA, groupA, "dup", "", ScopeDrill, stepsJSON).
		WillReturnError(&pgconn.PgError{Code: "23505"})

	err := store.CreateScenario(context.Background(), mock, &Scenario{
		TenantID: tenantA, GroupID: groupA, Name: "dup", Scope: ScopeDrill,
		Steps: steps,
	})
	if !errors.Is(err, ErrScenarioExists) {
		t.Fatalf("err = %v, want ErrScenarioExists", err)
	}
}

func TestStore_GetScenario_TenantScopedAndDecodesSteps(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	now := time.Now()

	steps := []Step{{Action: ActionInduceLag, Target: "s1",
		Expect: Expectation{Signal: "predicted_breach", DetectWithin: Duration(time.Minute)}}}
	stepsJSON, _ := json.Marshal(steps)

	// The query MUST carry the tenant id first — request-path isolation (§7).
	mock.ExpectQuery(`SELECT .* FROM dr_gameday_scenario WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantA, "sc-1").
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "name", "description", "scope", "steps", "created_at", "updated_at",
		}).AddRow("sc-1", tenantA, groupA, "n", "d", ScopeNonProd, stepsJSON, now, now))

	sc, err := store.GetScenario(context.Background(), mock, tenantA, "sc-1")
	if err != nil {
		t.Fatalf("GetScenario: %v", err)
	}
	if len(sc.Steps) != 1 || sc.Steps[0].Action != ActionInduceLag {
		t.Fatalf("steps not decoded: %+v", sc.Steps)
	}
	if sc.Steps[0].Expect.DetectWithin.Std() != time.Minute {
		t.Fatalf("detect_within = %v, want 1m", sc.Steps[0].Expect.DetectWithin.Std())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_GetScenario_NotFound(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	mock.ExpectQuery(`SELECT .* FROM dr_gameday_scenario`).
		WithArgs(tenantA, "missing").
		WillReturnError(errNoRows())

	_, err := store.GetScenario(context.Background(), mock, tenantA, "missing")
	if !errors.Is(err, ErrScenarioNotFound) {
		t.Fatalf("err = %v, want ErrScenarioNotFound", err)
	}
}

func TestStore_SystemClaimRun_ReturnsNilWhenEmpty(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	mock.ExpectQuery(`UPDATE dr_gameday_run`).
		WithArgs(RunStatusPending, RunStatusRunning).
		WillReturnError(errNoRows())

	run, err := store.SystemClaimRun(context.Background(), mock)
	if err != nil {
		t.Fatalf("SystemClaimRun: %v", err)
	}
	if run != nil {
		t.Fatalf("run = %+v, want nil (nothing to claim)", run)
	}
}

func TestStore_SystemClaimRun_ClaimsRunningRow(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	now := time.Now()
	mock.ExpectQuery(`UPDATE dr_gameday_run r[\s\S]*RETURNING r\.id, r\.tenant_id`).
		WithArgs(RunStatusPending, RunStatusRunning).
		WillReturnRows(runRow(now))

	run, err := store.SystemClaimRun(context.Background(), mock)
	if err != nil {
		t.Fatalf("SystemClaimRun: %v", err)
	}
	if run == nil || run.Status != RunStatusRunning {
		t.Fatalf("claimed run = %+v, want status running", run)
	}
}

func TestStore_SystemCompleteRun_ComputesScore(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	// 3 of 4 steps passed -> score 0.75.
	mock.ExpectExec(`UPDATE dr_gameday_run`).
		WithArgs("run-1", RunStatusFailed, 4, 3, 0.75, true, nil).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := store.SystemCompleteRun(context.Background(), mock, "run-1", RunStatusFailed, 4, 3, true, ""); err != nil {
		t.Fatalf("SystemCompleteRun: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_SystemRejectRunForProduction(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	mock.ExpectExec(`UPDATE dr_gameday_run`).
		WithArgs("run-1", RunStatusAborted, SafetyRejectedProduction, "prod").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := store.SystemRejectRunForProduction(context.Background(), mock, "run-1", "prod"); err != nil {
		t.Fatalf("SystemRejectRunForProduction: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_UpsertStepResult_RoundTrip(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	now := time.Now()
	detLat := int64(5000)
	r := &StepResult{
		TenantID: tenantA, RunID: "run-1", StepIndex: 0, Action: ActionPauseStream,
		Target: "s1", Observability: ObservabilitySystemObservable,
		ExpectedSignal: "lag_alert", DetectWithinMS: 30000,
		SignalObserved: true, ObservedSignal: "lag_alert", DetectionLatencyMS: &detLat,
		FaultReverted: true, Passed: true, Detail: "ok", FinishedAt: &now,
	}
	mock.ExpectQuery(`INSERT INTO dr_gameday_step_result`).
		WithArgs(tenantA, "run-1", 0, ActionPauseStream, "s1", ObservabilitySystemObservable, "lag_alert", int64(30000), int64(0),
			true, "lag_alert", &detLat, (*int64)(nil), true, true, "ok", &now).
		WillReturnRows(pgxmock.NewRows([]string{"id", "started_at"}).AddRow("step-1", now))

	if err := store.UpsertStepResult(context.Background(), mock, r); err != nil {
		t.Fatalf("UpsertStepResult: %v", err)
	}
	if r.ID != "step-1" {
		t.Fatalf("ID = %q, want step-1", r.ID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_GroupExists(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(groupA).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(true))

	ok, err := store.GroupExists(context.Background(), mock, groupA)
	if err != nil {
		t.Fatalf("GroupExists: %v", err)
	}
	if !ok {
		t.Fatal("GroupExists = false, want true")
	}
}

// --- helpers ---------------------------------------------------------------

// errNoRows returns the sentinel pgx no-rows error the store maps to NotFound.
func errNoRows() error { return pgx.ErrNoRows }

func runRow(now time.Time) *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "tenant_id", "scenario_id", "group_id", "scope", "status", "steps_total",
		"steps_passed", "score", "all_faults_reverted", "safety_verdict", "last_error",
		"initiated_by", "initiated_at", "started_at", "completed_at", "claimed_at", "updated_at",
	}).AddRow(
		"run-1", tenantA, "sc-1", groupA, ScopeDrill, RunStatusRunning, 1,
		0, nil, false, SafetyAllowed, nil,
		nil, now, &now, nil, &now, now,
	)
}
