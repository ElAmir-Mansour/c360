package repository

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/automation/model"
)

const (
	testTenant = "aaaaaaaa-0000-0000-0000-000000000001"
	testRunbk  = "11111111-0000-0000-0000-000000000001"
	testAuto   = "22222222-0000-0000-0000-000000000002"
	testRun    = "33333333-0000-0000-0000-000000000003"
)

func newMockPool(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool() error = %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func assertMet(t *testing.T, mock pgxmock.PgxPoolIface) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// uniqueViolation returns a pgconn error with the 23505 unique-violation code so
// tests can drive the isUniqueViolation branch deterministically.
func uniqueViolation() error {
	return &pgconn.PgError{Code: "23505", Message: "duplicate key value violates unique constraint"}
}

// errNoRows is the sentinel pgx returns from QueryRow().Scan when there is no
// row; the repository maps it to model.ErrNotFound.
func errNoRows() error { return pgx.ErrNoRows }

// --- Runbooks -------------------------------------------------------------

func TestCreateRunbook_InsertsHeaderAndSteps(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	now := time.Now()

	mock.ExpectQuery(regexp.QuoteMeta(insertRunbookSQL)).
		WithArgs(testTenant, "incident-response").
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).AddRow(testRunbk, now, now))

	// One action step then one approval gate; the repo stamps index 0,1.
	mock.ExpectQuery(regexp.QuoteMeta(insertRunbookStepSQL)).
		WithArgs(testTenant, testRunbk, 0, model.StepTypeAction, pgxmock.AnyArg(), []string{}, 1, 0, model.TimeoutActionEscalate).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow("step-0"))
	mock.ExpectQuery(regexp.QuoteMeta(insertRunbookStepSQL)).
		WithArgs(testTenant, testRunbk, 1, model.StepTypeApprovalGate, pgxmock.AnyArg(), []string{"incident-manager"}, 2, 3600, model.TimeoutActionAbort).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow("step-1"))

	rb := &model.Runbook{
		TenantID: testTenant,
		Name:     "incident-response",
		Steps: []model.RunbookStep{
			{Type: model.StepTypeAction, Action: model.ActionRef{Kind: model.ActionNotification, Config: map[string]any{"channel": "ops"}}},
			{Type: model.StepTypeApprovalGate, ApproverRoles: []string{"incident-manager"}, Quorum: 2, TimeoutSeconds: 3600, TimeoutAction: model.TimeoutActionAbort},
		},
	}
	if err := repo.CreateRunbook(context.Background(), mock, rb); err != nil {
		t.Fatalf("CreateRunbook() error = %v", err)
	}
	if rb.ID != testRunbk {
		t.Fatalf("runbook ID = %q, want %q", rb.ID, testRunbk)
	}
	if rb.Steps[1].Index != 1 {
		t.Fatalf("second step index = %d, want 1", rb.Steps[1].Index)
	}
	assertMet(t, mock)
}

func TestCreateRunbook_DuplicateName(t *testing.T) {
	mock := newMockPool(t)
	repo := New()

	mock.ExpectQuery(regexp.QuoteMeta(insertRunbookSQL)).
		WithArgs(testTenant, "dup").
		WillReturnError(uniqueViolation())

	err := repo.CreateRunbook(context.Background(), mock, &model.Runbook{TenantID: testTenant, Name: "dup"})
	if !errors.Is(err, model.ErrAlreadyExists) {
		t.Fatalf("error = %v, want ErrAlreadyExists", err)
	}
	assertMet(t, mock)
}

func TestGetRunbook_LoadsSteps(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	now := time.Now()

	mock.ExpectQuery(regexp.QuoteMeta(selectRunbookSQL)).
		WithArgs(testTenant, testRunbk).
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "name", "created_at", "updated_at"}).
			AddRow(testRunbk, testTenant, "rb", now, now))
	mock.ExpectQuery(regexp.QuoteMeta(listRunbookStepsSQL)).
		WithArgs(testTenant, testRunbk).
		WillReturnRows(pgxmock.NewRows([]string{"id", "runbook_id", "step_index", "step_type", "action", "approver_roles", "quorum", "timeout_seconds", "timeout_action"}).
			AddRow("s0", testRunbk, 0, model.StepTypeAction, []byte(`{"kind":"http_call","config":{"url":"x"}}`), []string{}, 1, 0, model.TimeoutActionEscalate))

	rb, err := repo.GetRunbook(context.Background(), mock, testTenant, testRunbk)
	if err != nil {
		t.Fatalf("GetRunbook() error = %v", err)
	}
	if len(rb.Steps) != 1 || rb.Steps[0].Action.Kind != model.ActionHTTPCall {
		t.Fatalf("unexpected steps: %+v", rb.Steps)
	}
	assertMet(t, mock)
}

func TestGetRunbook_NotFound(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	mock.ExpectQuery(regexp.QuoteMeta(selectRunbookSQL)).
		WithArgs(testTenant, testRunbk).
		WillReturnError(errNoRows())
	if _, err := repo.GetRunbook(context.Background(), mock, testTenant, testRunbk); !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
	assertMet(t, mock)
}

// --- Automations ----------------------------------------------------------

func TestCreateAutomation_InsertsAndSetsRules(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	now := time.Now()

	mock.ExpectQuery(regexp.QuoteMeta(insertAutomationSQL)).
		WithArgs(testTenant, "auto", true, pgxmock.AnyArg(), testRunbk, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).AddRow(testAuto, now, now))
	// SetAutomationRules clears then inserts each rule.
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM automation_rules WHERE tenant_id = $1 AND automation_id = $2`)).
		WithArgs(testTenant, testAuto).
		WillReturnResult(pgxmock.NewResult("DELETE", 0))
	mock.ExpectQuery(regexp.QuoteMeta(insertRuleSQL)).
		WithArgs(testTenant, testAuto, 10, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).AddRow("rule-0", now))

	a := &model.Automation{
		TenantID:  testTenant,
		Name:      "auto",
		Enabled:   true,
		Trigger:   model.TriggerConfig{Type: model.TriggerTypeEvent, Topic: "platform.iam.events"},
		RunbookID: testRunbk,
		CreatedBy: "user-1",
		Rules: []model.Rule{
			{Priority: 10, When: []model.Condition{{Expr: `trigger.data.kind == "user.created"`}}, ActionRef: model.ActionRef{Kind: model.ActionNotification}},
		},
	}
	if err := repo.CreateAutomation(context.Background(), mock, a); err != nil {
		t.Fatalf("CreateAutomation() error = %v", err)
	}
	if a.ID != testAuto {
		t.Fatalf("automation ID = %q", a.ID)
	}
	assertMet(t, mock)
}

func TestGetAutomation_RoundTripsTriggerAndRules(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	now := time.Now()

	mock.ExpectQuery(regexp.QuoteMeta(selectAutomationSQL)).
		WithArgs(testTenant, testAuto).
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "name", "enabled", "trigger", "runbook_id", "created_by", "created_at", "updated_at"}).
			AddRow(testAuto, testTenant, "auto", true,
				[]byte(`{"type":"threshold","topic":"cyber.alert.events","threshold_field":"data.score","threshold_op":"gte","threshold_value":8}`),
				testRunbk, "user-1", now, now))
	mock.ExpectQuery(regexp.QuoteMeta(listRulesSQL)).
		WithArgs(testTenant, testAuto).
		WillReturnRows(pgxmock.NewRows([]string{"id", "priority", "when_conditions", "action"}).
			AddRow("rule-0", 5, []byte(`[{"expr":"trigger.data.score > 9"}]`), []byte(`{"kind":"dr_runbook","config":{}}`)))

	a, err := repo.GetAutomation(context.Background(), mock, testTenant, testAuto)
	if err != nil {
		t.Fatalf("GetAutomation() error = %v", err)
	}
	if a.Trigger.Type != model.TriggerTypeThreshold || a.Trigger.ThresholdOp != model.ThresholdOpGTE {
		t.Fatalf("trigger not round-tripped: %+v", a.Trigger)
	}
	if len(a.Rules) != 1 || a.Rules[0].ActionRef.Kind != model.ActionDRRunbook {
		t.Fatalf("rules not round-tripped: %+v", a.Rules)
	}
	assertMet(t, mock)
}

func TestSetEnabled_NotFound(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE automations SET enabled = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`)).
		WithArgs(testTenant, testAuto, false).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	if err := repo.SetEnabled(context.Background(), mock, testTenant, testAuto, false); !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
	assertMet(t, mock)
}

// --- Runs -----------------------------------------------------------------

func TestCreateRun_DedupOnSourceEventID(t *testing.T) {
	mock := newMockPool(t)
	repo := New()

	// First insert succeeds.
	mock.ExpectQuery(regexp.QuoteMeta(insertRunSQL)).
		WithArgs(testTenant, testAuto, testRunbk, model.RunStatusPending, "evt-1", pgxmock.AnyArg(), 0, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "started_at", "updated_at"}).AddRow(testRun, time.Now(), time.Now()))
	run := &model.Run{TenantID: testTenant, AutomationID: testAuto, RunbookID: testRunbk, SourceEventID: "evt-1"}
	if err := repo.CreateRun(context.Background(), mock, run); err != nil {
		t.Fatalf("CreateRun() error = %v", err)
	}

	// Second insert with the SAME source_event_id violates the unique backstop →
	// ErrAlreadyExists (exactly-once, §4.3).
	mock.ExpectQuery(regexp.QuoteMeta(insertRunSQL)).
		WithArgs(testTenant, testAuto, testRunbk, model.RunStatusPending, "evt-1", pgxmock.AnyArg(), 0, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(uniqueViolation())
	dup := &model.Run{TenantID: testTenant, AutomationID: testAuto, RunbookID: testRunbk, SourceEventID: "evt-1"}
	err := repo.CreateRun(context.Background(), mock, dup)
	if !errors.Is(err, model.ErrAlreadyExists) {
		t.Fatalf("duplicate source_event_id error = %v, want ErrAlreadyExists", err)
	}
	if !strings.Contains(err.Error(), "evt-1") {
		t.Fatalf("error should name the source event id: %v", err)
	}
	assertMet(t, mock)
}

func TestSystemClaimRunnableRuns_ExcludesAwaitingApproval(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	now := time.Now()

	// The query text itself must restrict to PENDING|RUNNING and use SKIP LOCKED.
	if !strings.Contains(systemClaimRunnableRunsSQL, "status IN ('PENDING','RUNNING')") {
		t.Fatal("claim SQL must restrict to PENDING|RUNNING (gate never auto-advances, §6)")
	}
	if strings.Contains(systemClaimRunnableRunsSQL, "AWAITING_APPROVAL") {
		t.Fatal("claim SQL must NOT reference AWAITING_APPROVAL — it would let the driver advance a parked gate")
	}
	if !strings.Contains(systemClaimRunnableRunsSQL, "FOR UPDATE SKIP LOCKED") {
		t.Fatal("claim SQL must use FOR UPDATE SKIP LOCKED")
	}

	cols := []string{
		"id", "tenant_id", "automation_id", "runbook_id", "status", "source_event_id",
		"replay_of", "current_step", "trigger", "variables", "last_error",
		"claimed_at", "started_at", "completed_at", "updated_at",
	}
	mock.ExpectQuery(regexp.QuoteMeta(systemClaimRunnableRunsSQL)).
		WithArgs(5).
		WillReturnRows(pgxmock.NewRows(cols).
			AddRow(testRun, testTenant, testAuto, testRunbk, model.RunStatusRunning, "evt-1",
				nil, 1, []byte(`{}`), []byte(`{}`), "",
				&now, now, nil, now).
			AddRow("run-2", testTenant, testAuto, testRunbk, model.RunStatusPending, "evt-2",
				nil, 0, []byte(`{}`), []byte(`{}`), "",
				&now, now, nil, now))

	runs, err := repo.SystemClaimRunnableRuns(context.Background(), mock, 5)
	if err != nil {
		t.Fatalf("SystemClaimRunnableRuns() error = %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("claimed %d runs, want 2", len(runs))
	}
	for _, r := range runs {
		if !r.IsRunnable() {
			t.Fatalf("claimed a non-runnable run in status %s", r.Status)
		}
	}
	assertMet(t, mock)
}

func TestSystemClaimRunnableRuns_EmptyWhenNothingClaimable(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	cols := []string{
		"id", "tenant_id", "automation_id", "runbook_id", "status", "source_event_id",
		"replay_of", "current_step", "trigger", "variables", "last_error",
		"claimed_at", "started_at", "completed_at", "updated_at",
	}
	mock.ExpectQuery(regexp.QuoteMeta(systemClaimRunnableRunsSQL)).
		WithArgs(1).
		WillReturnRows(pgxmock.NewRows(cols))
	runs, err := repo.SystemClaimRunnableRuns(context.Background(), mock, 0) // 0 → clamped to 1
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(runs) != 0 {
		t.Fatalf("expected no runs, got %d", len(runs))
	}
	assertMet(t, mock)
}

func TestCancelRun_AlreadyTerminalConflicts(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	mock.ExpectExec(regexp.QuoteMeta(cancelRunSQL)).
		WithArgs(testTenant, testRun).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0)) // 0 rows: already terminal/missing
	if err := repo.CancelRun(context.Background(), mock, testTenant, testRun); !errors.Is(err, model.ErrConflict) {
		t.Fatalf("error = %v, want ErrConflict", err)
	}
	assertMet(t, mock)
}

func TestUpdateRunState_NotFound(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	mock.ExpectExec(regexp.QuoteMeta(updateRunStateSQL)).
		WithArgs(testTenant, testRun, model.RunStatusCompleted, 3, pgxmock.AnyArg(), "", pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	run := &model.Run{TenantID: testTenant, ID: testRun, Status: model.RunStatusCompleted, CurrentStep: 3}
	if err := repo.UpdateRunState(context.Background(), mock, run); !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
	assertMet(t, mock)
}

// --- Run steps (idempotent append-only log) -------------------------------

func TestEnsureRunStep_UpsertsIdempotently(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	now := time.Now()

	mock.ExpectQuery(regexp.QuoteMeta(ensureRunStepSQL)).
		WithArgs(testTenant, testRun, 0, pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), model.StepStatusOK, 1, "", pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "started_at"}).AddRow("rs-0", now))

	s := &model.RunStep{
		RunID:      testRun,
		Index:      0,
		Action:     model.ActionRef{Kind: model.ActionStartWorkflow, Config: map[string]any{"definition_id": "wf-1"}},
		Status:     model.StepStatusOK,
		OutputJSON: map[string]any{"instance_id": "inst-1"},
	}
	if err := repo.EnsureRunStep(context.Background(), mock, testTenant, s); err != nil {
		t.Fatalf("EnsureRunStep() error = %v", err)
	}
	if s.ID != "rs-0" {
		t.Fatalf("step ID = %q", s.ID)
	}
	// The upsert SQL must target the idempotency key.
	if !strings.Contains(ensureRunStepSQL, "ON CONFLICT (run_id, step_index)") {
		t.Fatal("EnsureRunStep SQL must upsert on (run_id, step_index) for crash-restart idempotency")
	}
	assertMet(t, mock)
}

func TestListRunSteps_ReturnsLogInOrder(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	now := time.Now()
	cols := []string{"id", "run_id", "step_index", "action", "input", "output", "status", "attempt", "error", "started_at", "finished_at"}
	mock.ExpectQuery(regexp.QuoteMeta(listRunStepsSQL)).
		WithArgs(testRun).
		WillReturnRows(pgxmock.NewRows(cols).
			AddRow("rs-0", testRun, 0, []byte(`{"kind":"notification"}`), []byte(`{}`), []byte(`{"sent":true}`), model.StepStatusOK, 1, "", now, &now).
			AddRow("rs-1", testRun, 1, []byte(`{"kind":"http_call"}`), []byte(`{}`), []byte(`{}`), model.StepStatusRunning, 2, "", now, nil))
	steps, err := repo.ListRunSteps(context.Background(), mock, testRun)
	if err != nil {
		t.Fatalf("ListRunSteps() error = %v", err)
	}
	if len(steps) != 2 || steps[0].Index != 0 || steps[1].Index != 1 {
		t.Fatalf("unexpected log: %+v", steps)
	}
	if steps[0].OutputJSON["sent"] != true {
		t.Fatalf("output not round-tripped: %+v", steps[0].OutputJSON)
	}
	assertMet(t, mock)
}

func TestGetRunStep_NotFound(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	mock.ExpectQuery(regexp.QuoteMeta(getRunStepSQL)).
		WithArgs(testRun, 7).
		WillReturnError(errNoRows())
	if _, err := repo.GetRunStep(context.Background(), mock, testRun, 7); !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
	assertMet(t, mock)
}

// --- Approval gates -------------------------------------------------------

func TestUpsertApprovalGate_DefaultsAndRoundTrip(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	now := time.Now()
	deadline := now.Add(time.Hour)

	mock.ExpectQuery(regexp.QuoteMeta(upsertGateSQL)).
		WithArgs(testTenant, testRun, 2, model.GateStatusOpen, 2, pgxmock.AnyArg(), &deadline, (*time.Time)(nil)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "opened_at"}).AddRow("gate-0", now))

	g := &model.ApprovalGate{
		TenantID:   testTenant,
		RunID:      testRun,
		StepIndex:  2,
		Quorum:     2,
		DeadlineAt: &deadline,
		Decisions: []model.Decision{
			{UserID: "u1", Approved: true, DecidedAt: now},
		},
	}
	if err := repo.UpsertApprovalGate(context.Background(), mock, g); err != nil {
		t.Fatalf("UpsertApprovalGate() error = %v", err)
	}
	if g.Status != model.GateStatusOpen {
		t.Fatalf("status should default to OPEN, got %q", g.Status)
	}
	assertMet(t, mock)
}

func TestSystemListExpiredGates(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	now := time.Now()
	past := now.Add(-time.Minute)
	cols := []string{"id", "tenant_id", "run_id", "step_index", "status", "quorum", "decisions", "opened_at", "deadline_at", "resolved_at"}
	mock.ExpectQuery(regexp.QuoteMeta(systemListExpiredGatesSQL)).
		WithArgs(50).
		WillReturnRows(pgxmock.NewRows(cols).
			AddRow("gate-0", testTenant, testRun, 2, model.GateStatusOpen, 1, []byte(`[]`), now, &past, nil))
	gates, err := repo.SystemListExpiredGates(context.Background(), mock, 0) // 0 → clamped to 50
	if err != nil {
		t.Fatalf("SystemListExpiredGates() error = %v", err)
	}
	if len(gates) != 1 {
		t.Fatalf("expected 1 expired gate, got %d", len(gates))
	}
	// The query must only sweep OPEN, past-deadline gates.
	if !strings.Contains(systemListExpiredGatesSQL, "status = 'OPEN'") || !strings.Contains(systemListExpiredGatesSQL, "deadline_at <= now()") {
		t.Fatal("sweep SQL must restrict to OPEN gates past deadline")
	}
	assertMet(t, mock)
}

func TestSetAutomationRules_WrapsInsertError(t *testing.T) {
	mock := newMockPool(t)
	repo := New()
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM automation_rules WHERE tenant_id = $1 AND automation_id = $2`)).
		WithArgs(testTenant, testAuto).
		WillReturnResult(pgxmock.NewResult("DELETE", 0))
	mock.ExpectQuery(regexp.QuoteMeta(insertRuleSQL)).
		WithArgs(testTenant, testAuto, 1, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errors.New("db down"))
	err := repo.SetAutomationRules(context.Background(), mock, testTenant, testAuto,
		[]model.Rule{{Priority: 1, ActionRef: model.ActionRef{Kind: model.ActionNotification}}})
	if err == nil {
		t.Fatal("expected error from failing rule insert")
	}
	assertMet(t, mock)
}
