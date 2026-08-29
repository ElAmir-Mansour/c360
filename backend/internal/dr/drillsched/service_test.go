package drillsched

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// memStore is an in-memory storeAPI for service tests. It exercises the service's
// validation, cron-first-fire computation, ingest+diff orchestration and error
// mapping without a database.
type memStore struct {
	groups    map[string]string // groupID -> name
	schedules map[string]*Schedule
	results   []*DrillResult
	seq       int
}

func newMemStore() *memStore {
	return &memStore{groups: map[string]string{}, schedules: map[string]*Schedule{}}
}

func (m *memStore) GroupExists(_ context.Context, _ DBTX, groupID string) (string, bool, error) {
	name, ok := m.groups[groupID]
	return name, ok, nil
}

func (m *memStore) CreateSchedule(_ context.Context, _ DBTX, sc *Schedule) error {
	for _, existing := range m.schedules {
		if existing.TenantID == sc.TenantID && existing.Name == sc.Name {
			return ErrAlreadyExists
		}
	}
	m.seq++
	sc.ID = uuid.New().String()
	now := time.Now().UTC()
	sc.CreatedAt, sc.UpdatedAt = now, now
	cp := *sc
	m.schedules[sc.ID] = &cp
	return nil
}

func (m *memStore) GetSchedule(_ context.Context, _ DBTX, tenantID, id string) (*Schedule, error) {
	sc, ok := m.schedules[id]
	if !ok || sc.TenantID != tenantID {
		return nil, ErrNotFound
	}
	cp := *sc
	return &cp, nil
}

func (m *memStore) ListSchedules(_ context.Context, _ DBTX, tenantID string) ([]*Schedule, error) {
	var out []*Schedule
	for _, sc := range m.schedules {
		if sc.TenantID == tenantID {
			cp := *sc
			out = append(out, &cp)
		}
	}
	return out, nil
}

func (m *memStore) DeleteSchedule(_ context.Context, _ DBTX, tenantID, id string) error {
	sc, ok := m.schedules[id]
	if !ok || sc.TenantID != tenantID {
		return ErrNotFound
	}
	delete(m.schedules, id)
	return nil
}

func (m *memStore) CreateResult(_ context.Context, _ DBTX, res *DrillResult) error {
	for _, r := range m.results {
		if r.RunID == res.RunID {
			return ErrAlreadyExists
		}
	}
	m.seq++
	res.ID = uuid.New().String()
	res.CreatedAt = time.Now().UTC()
	cp := *res
	m.results = append(m.results, &cp)
	return nil
}

func (m *memStore) GetResult(_ context.Context, _ DBTX, tenantID, id string) (*DrillResult, error) {
	for _, r := range m.results {
		if r.ID == id && r.TenantID == tenantID {
			cp := *r
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (m *memStore) ListResultsByGroup(_ context.Context, _ DBTX, tenantID, groupID string) ([]*DrillResult, error) {
	var out []*DrillResult
	for i := len(m.results) - 1; i >= 0; i-- {
		r := m.results[i]
		if r.TenantID == tenantID && r.GroupID == groupID {
			cp := *r
			out = append(out, &cp)
		}
	}
	return out, nil
}

func (m *memStore) PreviousResult(_ context.Context, _ DBTX, tenantID string, ref *DrillResult) (*DrillResult, error) {
	var best *DrillResult
	for _, r := range m.results {
		if r.TenantID != tenantID || r.ID == ref.ID {
			continue
		}
		// same scope: schedule when set, else group ad-hoc.
		if ref.ScheduleID != nil {
			if r.ScheduleID == nil || *r.ScheduleID != *ref.ScheduleID {
				continue
			}
		} else {
			if r.GroupID != ref.GroupID || r.ScheduleID != nil {
				continue
			}
		}
		if r.ObservedAt.After(ref.ObservedAt) || r.ObservedAt.Equal(ref.ObservedAt) {
			continue
		}
		if best == nil || r.ObservedAt.After(best.ObservedAt) {
			best = r
		}
	}
	if best == nil {
		return nil, ErrNoPrevious
	}
	cp := *best
	return &cp, nil
}

// memRunner runs fn with a nil DBTX (the memStore ignores it).
type memRunner struct{}

func (memRunner) RunWithTenant(ctx context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}
func (memRunner) RunReadWithTenant(ctx context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}

func newTestService(t *testing.T, store storeAPI, now time.Time) *Service {
	t.Helper()
	svc, err := NewService(Config{
		Store:  store,
		Runner: memRunner{},
		Now:    func() time.Time { return now },
		Logger: zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

func TestService_CreateSchedule_ComputesFirstNextRun(t *testing.T) {
	now := mustTime(t, "2026-06-13T10:07:00Z")
	store := newMemStore()
	groupID := uuid.New()
	store.groups[groupID.String()] = "prod-group"
	svc := newTestService(t, store, now)

	sc, err := svc.CreateSchedule(context.Background(), uuid.New(), CreateScheduleInput{
		GroupID: groupID, Name: "nightly", CronExpr: "*/15 * * * *",
	})
	if err != nil {
		t.Fatalf("CreateSchedule: %v", err)
	}
	if sc.Profile != ProfileIsolated {
		t.Fatalf("profile = %q, want isolated default", sc.Profile)
	}
	if sc.RTOObjectiveSeconds != 900 {
		t.Fatalf("rto = %d, want 900 default", sc.RTOObjectiveSeconds)
	}
	if !sc.Enabled {
		t.Fatal("schedule should be enabled by default")
	}
	if !sc.NextRun.Equal(mustTime(t, "2026-06-13T10:15:00Z")) {
		t.Fatalf("next_run = %s, want 10:15", sc.NextRun.Format(time.RFC3339))
	}
}

func TestService_CreateSchedule_Validation(t *testing.T) {
	now := mustTime(t, "2026-06-13T10:00:00Z")
	store := newMemStore()
	groupID := uuid.New()
	store.groups[groupID.String()] = "g"
	svc := newTestService(t, store, now)
	tenant := uuid.New()

	tests := []struct {
		name string
		in   CreateScheduleInput
	}{
		{"missing group", CreateScheduleInput{Name: "n", CronExpr: "* * * * *"}},
		{"missing name", CreateScheduleInput{GroupID: groupID, CronExpr: "* * * * *"}},
		{"bad cron", CreateScheduleInput{GroupID: groupID, Name: "n", CronExpr: "99 * * * *"}},
		{"bad profile", CreateScheduleInput{GroupID: groupID, Name: "n", CronExpr: "* * * * *", Profile: "wormhole"}},
		{"negative rto", CreateScheduleInput{GroupID: groupID, Name: "n", CronExpr: "* * * * *", RTOObjectiveSeconds: -1}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := svc.CreateSchedule(context.Background(), tenant, tc.in); !errors.Is(err, ErrValidation) {
				t.Fatalf("err = %v, want ErrValidation", err)
			}
		})
	}
}

func TestService_CreateSchedule_MissingGroup(t *testing.T) {
	now := mustTime(t, "2026-06-13T10:00:00Z")
	svc := newTestService(t, newMemStore(), now)
	_, err := svc.CreateSchedule(context.Background(), uuid.New(), CreateScheduleInput{
		GroupID: uuid.New(), Name: "n", CronExpr: "* * * * *",
	})
	if !errors.Is(err, ErrGroupNotFound) {
		t.Fatalf("err = %v, want ErrGroupNotFound", err)
	}
}

func TestService_NextRuns(t *testing.T) {
	now := mustTime(t, "2026-06-13T10:07:00Z")
	store := newMemStore()
	groupID := uuid.New()
	store.groups[groupID.String()] = "g"
	tenant := uuid.New()
	svc := newTestService(t, store, now)

	sc, err := svc.CreateSchedule(context.Background(), tenant, CreateScheduleInput{
		GroupID: groupID, Name: "n", CronExpr: "*/15 * * * *",
	})
	if err != nil {
		t.Fatalf("CreateSchedule: %v", err)
	}

	// Drive the real NextRuns endpoint path: load by id, re-parse, evaluate.
	runs, err := svc.NextRuns(context.Background(), tenant, uuid.MustParse(sc.ID), 3)
	if err != nil {
		t.Fatalf("NextRuns: %v", err)
	}
	want := []string{"2026-06-13T10:15:00Z", "2026-06-13T10:30:00Z", "2026-06-13T10:45:00Z"}
	if len(runs) != len(want) {
		t.Fatalf("got %d runs, want %d", len(runs), len(want))
	}
	for i, w := range want {
		if !runs[i].Equal(mustTime(t, w)) {
			t.Fatalf("next run %d = %s, want %s", i, runs[i].Format(time.RFC3339), w)
		}
	}

	// An unknown schedule is ErrNotFound.
	if _, err := svc.NextRuns(context.Background(), tenant, uuid.New(), 3); !errors.Is(err, ErrNotFound) {
		t.Fatalf("NextRuns unknown id err = %v, want ErrNotFound", err)
	}
}

func TestService_IngestResult_DiffsAgainstPrevious(t *testing.T) {
	now := mustTime(t, "2026-06-13T10:00:00Z")
	store := newMemStore()
	groupID := uuid.New()
	store.groups[groupID.String()] = "g"
	tenant := uuid.New()
	svc := newTestService(t, store, now)

	// First (passing) result.
	first, diff1, err := svc.IngestResult(context.Background(), tenant, IngestResultInput{
		GroupID: groupID, RunID: "run-1", Passed: true,
		RTOAchievedSeconds: 600, RPOAchievedSeconds: 120,
		Steps:      []DrillStep{{Key: "gate1.validate", Status: StepStatusPassed, DurationMS: 1000}},
		ObservedAt: now,
	})
	if err != nil {
		t.Fatalf("first ingest: %v", err)
	}
	if diff1.PreviousResultID != "" {
		t.Fatalf("first diff has a previous id %q, want empty", diff1.PreviousResultID)
	}
	if diff1.HasDrift() {
		t.Fatalf("first passing drill diff has drift: %+v", diff1)
	}

	// Second (regressed + step failing) result, later.
	_, diff2, err := svc.IngestResult(context.Background(), tenant, IngestResultInput{
		GroupID: groupID, RunID: "run-2", Passed: false,
		RTOAchievedSeconds: 800, RPOAchievedSeconds: 120,
		Steps:      []DrillStep{{Key: "gate1.validate", Status: StepStatusFailed, DurationMS: 1000}},
		ObservedAt: now.Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("second ingest: %v", err)
	}
	if diff2.PreviousResultID != first.ID {
		t.Fatalf("second diff previous = %q, want %q", diff2.PreviousResultID, first.ID)
	}
	if !diff2.RTORegressed || diff2.RTODeltaSeconds != 200 {
		t.Fatalf("RTO regressed=%v delta=%d, want true/200", diff2.RTORegressed, diff2.RTODeltaSeconds)
	}
	if !diff2.NewlyRegressed {
		t.Fatal("expected NewlyRegressed for pass->fail")
	}
	if len(diff2.NewlyFailedSteps) != 1 || diff2.NewlyFailedSteps[0] != "gate1.validate" {
		t.Fatalf("newly failed = %v, want [gate1.validate]", diff2.NewlyFailedSteps)
	}
}

func TestService_IngestResult_DuplicateRunIsConflict(t *testing.T) {
	now := mustTime(t, "2026-06-13T10:00:00Z")
	store := newMemStore()
	groupID := uuid.New()
	store.groups[groupID.String()] = "g"
	tenant := uuid.New()
	svc := newTestService(t, store, now)

	in := IngestResultInput{GroupID: groupID, RunID: "run-x", Passed: true, ObservedAt: now}
	if _, _, err := svc.IngestResult(context.Background(), tenant, in); err != nil {
		t.Fatalf("first ingest: %v", err)
	}
	if _, _, err := svc.IngestResult(context.Background(), tenant, in); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("duplicate ingest err = %v, want ErrAlreadyExists", err)
	}
}

func TestService_DiffResult_NoPrevious(t *testing.T) {
	now := mustTime(t, "2026-06-13T10:00:00Z")
	store := newMemStore()
	groupID := uuid.New()
	store.groups[groupID.String()] = "g"
	tenant := uuid.New()
	svc := newTestService(t, store, now)

	res, _, err := svc.IngestResult(context.Background(), tenant, IngestResultInput{
		GroupID: groupID, RunID: "run-1", Passed: true, ObservedAt: now,
	})
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	// DiffResult on a first result returns ErrNoPrevious.
	if _, err := svc.DiffResult(context.Background(), tenant, uuid.MustParse(res.ID)); !errors.Is(err, ErrNoPrevious) {
		t.Fatalf("DiffResult on a first result err = %v, want ErrNoPrevious", err)
	}

	// A second result diffs against the first.
	res2, _, err := svc.IngestResult(context.Background(), tenant, IngestResultInput{
		GroupID: groupID, RunID: "run-2", Passed: true,
		RTOAchievedSeconds: 10, ObservedAt: now.Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("second ingest: %v", err)
	}
	diff, err := svc.DiffResult(context.Background(), tenant, uuid.MustParse(res2.ID))
	if err != nil {
		t.Fatalf("DiffResult: %v", err)
	}
	if diff.PreviousResultID != res.ID {
		t.Fatalf("diff previous = %q, want %q", diff.PreviousResultID, res.ID)
	}
}
