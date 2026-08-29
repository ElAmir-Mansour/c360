package assurance

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"
)

// fakeDBTX satisfies repository.DBTX (=DBTX) for the service orchestration tests.
// Only Exec is exercised (by outbox.Write when the evaluation event is staged);
// the faked store ignores the handle, so Query/QueryRow are never reached.
type fakeDBTX struct {
	execCalls int
	execErr   error
}

func (f *fakeDBTX) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	f.execCalls++
	return pgconn.CommandTag{}, f.execErr
}
func (f *fakeDBTX) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("assurance test: Query not expected")
}
func (f *fakeDBTX) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("assurance test: QueryRow not expected")
}

// fakeRunner passes a shared *fakeDBTX into fn so the staged event's Exec is
// observable, and can force a transaction-level error.
type fakeRunner struct {
	db          *fakeDBTX
	writeErr    error
	readErr     error
	writeCalls  int
	readCalls   int
	writeTenant uuid.UUID
	readTenant  uuid.UUID
}

func (r *fakeRunner) RunWithTenant(_ context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	r.writeCalls++
	r.writeTenant = tenantID
	if r.writeErr != nil {
		return r.writeErr
	}
	return fn(r.db)
}

func (r *fakeRunner) RunReadWithTenant(_ context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	r.readCalls++
	r.readTenant = tenantID
	if r.readErr != nil {
		return r.readErr
	}
	return fn(r.db)
}

// fakeStore records what the service persists and serves back configured rows.
type fakeStore struct {
	groupName   string
	groupExists bool
	groupErr    error

	saveErr      error
	savedHdr     *StoredAssessment
	savedResults []StoredResult

	getHdr *StoredAssessment
	getErr error

	latestHdr *StoredAssessment
	latestErr error

	results    []StoredResult
	resultsErr error
}

func (s *fakeStore) GroupExists(context.Context, DBTX, uuid.UUID) (string, bool, error) {
	return s.groupName, s.groupExists, s.groupErr
}

func (s *fakeStore) SaveAssessment(_ context.Context, _ DBTX, hdr *StoredAssessment, results []StoredResult) error {
	if s.saveErr != nil {
		return s.saveErr
	}
	hdr.ID = uuid.New() // simulate the RETURNING id the real store fills
	hdr.CreatedAt = time.Now()
	s.savedHdr = hdr
	s.savedResults = results
	return nil
}

func (s *fakeStore) GetAssessment(context.Context, DBTX, uuid.UUID) (*StoredAssessment, error) {
	return s.getHdr, s.getErr
}

func (s *fakeStore) LatestForGroup(context.Context, DBTX, uuid.UUID) (*StoredAssessment, error) {
	return s.latestHdr, s.latestErr
}

func (s *fakeStore) ListResults(context.Context, DBTX, uuid.UUID) ([]StoredResult, error) {
	return s.results, s.resultsErr
}

type fakeCollector struct {
	ev     AssuranceEvidence
	err    error
	called bool
}

func (c *fakeCollector) Collect(context.Context, DBTX, uuid.UUID, uuid.UUID) (AssuranceEvidence, error) {
	c.called = true
	return c.ev, c.err
}

func newServiceFixture(store *fakeStore, collector *fakeCollector, runner *fakeRunner, now time.Time) *Service {
	return NewService(Config{
		Store:     store,
		Collector: collector,
		Runner:    runner,
		Clock:     func() time.Time { return now },
		Logger:    zerolog.Nop(),
	})
}

// healthyEvidence is a bundle that satisfies every control at `now`, so the
// service scores it 100 end to end (collect -> evaluate -> persist).
func healthyEvidence(now time.Time) AssuranceEvidence {
	return AssuranceEvidence{
		Drills: []DrillEvidence{{
			ID:            "drill-1",
			ExecutedAt:    now.AddDate(0, 0, -1),
			NonDisruptive: true,
			Passed:        true,
		}},
		Verifications: []VerificationEvidence{
			{ID: "app-1", Kind: VerificationApp, VerifiedAt: now.AddDate(0, 0, -1), Passed: true, ChecksPassed: 100, ChecksTotal: 100},
			{ID: "clean-1", Kind: VerificationCleanRoom, VerifiedAt: now.AddDate(0, 0, -1), Passed: true, ChecksPassed: 50, ChecksTotal: 50},
			{ID: "runbook-1", Kind: VerificationRunbookReview, VerifiedAt: now.AddDate(0, 0, -10), Passed: true},
			{ID: "boot-1", Kind: VerificationDependencyBootGraph, VerifiedAt: now.AddDate(0, 0, -10), Passed: true},
			{ID: "failback-1", Kind: VerificationFailback, VerifiedAt: now.AddDate(0, 0, -30), Passed: true},
		},
		Drift: []DriftEvidence{{
			ID:         "drift-1",
			ObservedAt: now.AddDate(0, 0, -1),
		}},
		RPO: []RPOEvidence{{
			ID:               "rpo-1",
			MeasuredAt:       now.Add(-time.Minute),
			ObjectiveSeconds: 300,
			ActualLagSeconds: 100,
		}},
	}
}

func TestEvaluate_HealthyEvidenceScoresAndPersists(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	store := &fakeStore{groupExists: true, groupName: "grp"}
	collector := &fakeCollector{ev: healthyEvidence(now)}
	runner := &fakeRunner{db: &fakeDBTX{}}
	svc := newServiceFixture(store, collector, runner, now)

	tenantID, groupID, actor := uuid.New(), uuid.New(), uuid.New()
	hdr, scored, err := svc.Evaluate(context.Background(), tenantID, groupID, actor)
	if err != nil {
		t.Fatalf("Evaluate: %v", err)
	}
	if !collector.called {
		t.Error("collector was not invoked")
	}
	if scored.Score != 100 {
		t.Errorf("score = %v, want 100 (findings=%+v)", scored.Score, scored.Findings)
	}
	if scored.Verdict != VerdictSatisfied {
		t.Errorf("verdict = %q, want satisfied", scored.Verdict)
	}
	if hdr.Score != 100 || hdr.Satisfied != hdr.TotalChecks || hdr.TenantID != tenantID || hdr.GroupID != groupID || hdr.CreatedBy != actor {
		t.Errorf("header = %+v, want fully-satisfied for tenant/group/actor", hdr)
	}
	if len(hdr.EvidenceSnapshot.Drills) != 1 || len(hdr.EvidenceSnapshot.RPO) != 1 {
		t.Errorf("evidence snapshot = %+v, want collected drill and rpo evidence", hdr.EvidenceSnapshot)
	}
	if len(store.savedResults) != hdr.TotalChecks {
		t.Errorf("persisted %d results, want %d (one per control)", len(store.savedResults), hdr.TotalChecks)
	}
	if runner.db.execCalls != 1 {
		t.Errorf("event Exec calls = %d, want exactly 1 (staged in tx)", runner.db.execCalls)
	}
	if runner.writeCalls != 1 || runner.readCalls != 0 || runner.writeTenant != tenantID {
		t.Errorf("runner write/read/tenant = %d/%d/%s, want 1/0/%s", runner.writeCalls, runner.readCalls, runner.writeTenant, tenantID)
	}
}

func TestEvaluate_EmptyEvidenceFailsButStillPersistsAndStages(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	store := &fakeStore{groupExists: true}
	collector := &fakeCollector{ev: AssuranceEvidence{}}
	runner := &fakeRunner{db: &fakeDBTX{}}
	svc := newServiceFixture(store, collector, runner, now)

	_, scored, err := svc.Evaluate(context.Background(), uuid.New(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Evaluate: %v", err)
	}
	if scored.Score != 0 || scored.Verdict != VerdictFailed {
		t.Errorf("score=%v verdict=%q, want 0/failed for empty evidence", scored.Score, scored.Verdict)
	}
	if len(scored.Findings) != scored.TotalChecks {
		t.Errorf("findings = %d, want one per control (%d)", len(scored.Findings), scored.TotalChecks)
	}
	if len(scored.Recommendations) == 0 {
		t.Error("expected machine-readable recommendations for the gaps")
	}
	if runner.db.execCalls != 1 {
		t.Errorf("event Exec calls = %d, want 1 even for a failing score", runner.db.execCalls)
	}
}

func TestEvaluate_GroupNotFound(t *testing.T) {
	t.Parallel()
	now := time.Now()
	store := &fakeStore{groupExists: false}
	collector := &fakeCollector{}
	runner := &fakeRunner{db: &fakeDBTX{}}
	svc := newServiceFixture(store, collector, runner, now)

	_, _, err := svc.Evaluate(context.Background(), uuid.New(), uuid.New(), uuid.New())
	if !errors.Is(err, ErrGroupNotFound) {
		t.Fatalf("err = %v, want ErrGroupNotFound", err)
	}
	if collector.called {
		t.Error("collector must not run for a missing group")
	}
	if runner.db.execCalls != 0 {
		t.Error("no event should be staged for a missing group")
	}
}

func TestEvaluate_MissingDependenciesReturnsUnavailable(t *testing.T) {
	t.Parallel()
	svc := NewService(Config{Logger: zerolog.Nop()})

	_, _, err := svc.Evaluate(context.Background(), uuid.New(), uuid.New(), uuid.New())
	if !errors.Is(err, ErrServiceUnavailable) {
		t.Fatalf("err = %v, want ErrServiceUnavailable", err)
	}
}

func TestEvaluate_CollectErrorAborts(t *testing.T) {
	t.Parallel()
	store := &fakeStore{groupExists: true}
	collector := &fakeCollector{err: errors.New("source boom")}
	runner := &fakeRunner{db: &fakeDBTX{}}
	svc := newServiceFixture(store, collector, runner, time.Now())

	_, _, err := svc.Evaluate(context.Background(), uuid.New(), uuid.New(), uuid.New())
	if err == nil {
		t.Fatal("expected collect error to abort the evaluation")
	}
	if store.savedHdr != nil || runner.db.execCalls != 0 {
		t.Error("nothing should be persisted/staged when collection fails")
	}
}

func TestGetReport_ReconstructsFindingsFromRows(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	store := &fakeStore{
		getHdr: &StoredAssessment{ID: id, Score: 70, Verdict: VerdictFailed},
		results: []StoredResult{
			{Code: "drill_cadence", Verdict: VerdictSatisfied},
			{Code: "rpo_breach_status", Verdict: VerdictFailed, Severity: SeverityCritical, Recommendation: RecommendationInvestigateRPO, Message: "breached"},
			{Code: "infra_drift", Verdict: VerdictPartial, Severity: SeverityWarning, Recommendation: RecommendationResolveDrift},
		},
	}
	runner := &fakeRunner{db: &fakeDBTX{}}
	svc := newServiceFixture(store, &fakeCollector{}, runner, time.Now())

	tenantID := uuid.New()
	report, err := svc.GetReport(context.Background(), tenantID, id)
	if err != nil {
		t.Fatalf("GetReport: %v", err)
	}
	if report.Assessment.ID != id {
		t.Errorf("report id = %s, want %s", report.Assessment.ID, id)
	}
	if len(report.Findings) != 2 {
		t.Errorf("findings = %d, want 2 (only the non-satisfied controls)", len(report.Findings))
	}
	if len(report.Recommendations) != 2 {
		t.Errorf("recommendations = %v, want 2 deduped in order", report.Recommendations)
	}
	if runner.readCalls != 1 || runner.writeCalls != 0 || runner.readTenant != tenantID {
		t.Errorf("runner read/write/tenant = %d/%d/%s, want 1/0/%s", runner.readCalls, runner.writeCalls, runner.readTenant, tenantID)
	}
}

func TestGetReport_NotFound(t *testing.T) {
	t.Parallel()
	store := &fakeStore{getErr: ErrAssessmentNotFound}
	svc := newServiceFixture(store, &fakeCollector{}, &fakeRunner{db: &fakeDBTX{}}, time.Now())

	_, err := svc.GetReport(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, ErrAssessmentNotFound) {
		t.Fatalf("err = %v, want ErrAssessmentNotFound", err)
	}
}

func TestGetLatest_ReconstructsReport(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	store := &fakeStore{
		latestHdr: &StoredAssessment{ID: id, Score: 90, Verdict: VerdictPartial},
		results:   []StoredResult{{Code: "drill_cadence", Verdict: VerdictSatisfied}},
	}
	runner := &fakeRunner{db: &fakeDBTX{}}
	svc := newServiceFixture(store, &fakeCollector{}, runner, time.Now())

	tenantID := uuid.New()
	report, err := svc.GetLatest(context.Background(), tenantID, uuid.New())
	if err != nil {
		t.Fatalf("GetLatest: %v", err)
	}
	if report.Assessment.ID != id || len(report.Findings) != 0 {
		t.Errorf("report = %+v, want id %s with no findings", report, id)
	}
	if runner.readCalls != 1 || runner.writeCalls != 0 || runner.readTenant != tenantID {
		t.Errorf("runner read/write/tenant = %d/%d/%s, want 1/0/%s", runner.readCalls, runner.writeCalls, runner.readTenant, tenantID)
	}
}
