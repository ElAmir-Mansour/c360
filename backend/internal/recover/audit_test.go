package recover

import (
	"context"
	"errors"
	"os"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// --- fakes (mocks live only in test files; never a source of truth) ----------

// fakeAuditStore is an in-memory AppendOnly AuditStore. It records every appended
// record so a test can prove the log only ever grows. It deliberately exposes NO
// update/delete operation — mirroring the production store and interface.
type fakeAuditStore struct {
	mu        sync.Mutex
	rows      []AuditEvent
	appendErr error
	listErr   error
}

func (f *fakeAuditStore) Append(_ context.Context, _ repository.DBTX, tenantID uuid.UUID, rec AuditRecord, now time.Time) (AuditEvent, error) {
	if f.appendErr != nil {
		return AuditEvent{}, f.appendErr
	}
	occurred := rec.OccurredAt
	if occurred.IsZero() {
		occurred = now
	}
	ev := AuditEvent{
		ID:            uuid.New(),
		EventID:       rec.EventID,
		SubSolution:   rec.SubSolution,
		Action:        rec.Action,
		ActorID:       rec.Actor.ID,
		ActorEmail:    rec.Actor.Email,
		ApplicationID: rec.ApplicationID,
		RunbookID:     rec.RunbookID,
		Summary:       rec.Summary,
		Detail:        rec.Detail,
		OccurredAt:    occurred,
		RecordedAt:    now,
	}
	f.mu.Lock()
	f.rows = append(f.rows, ev)
	f.mu.Unlock()
	return ev, nil
}

func (f *fakeAuditStore) ListForEvent(_ context.Context, _ repository.DBTX, _, eventID uuid.UUID) ([]AuditEvent, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []AuditEvent{}
	for _, r := range f.rows {
		if r.EventID == eventID {
			out = append(out, r)
		}
	}
	return out, nil
}

func (f *fakeAuditStore) ListRecentEvents(_ context.Context, _ repository.DBTX, _ uuid.UUID, limit int) ([]AuditEventSummary, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	byEvent := map[uuid.UUID]*AuditEventSummary{}
	order := []uuid.UUID{}
	for _, r := range f.rows {
		s := byEvent[r.EventID]
		if s == nil {
			s = &AuditEventSummary{EventID: r.EventID, SubSolution: r.SubSolution, FirstAt: r.OccurredAt, LastAt: r.OccurredAt}
			byEvent[r.EventID] = s
			order = append(order, r.EventID)
		}
		s.ActionCount++
		if !r.OccurredAt.Before(s.LastAt) {
			s.LastAt = r.OccurredAt
			s.LatestAction = r.Action
			s.LatestActor = r.ActorEmail
		}
	}
	out := []AuditEventSummary{}
	for _, id := range order {
		out = append(out, *byEvent[id])
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (f *fakeAuditStore) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.rows)
}

func newAuditService(t *testing.T, store AuditStore, now time.Time) *AuditService {
	t.Helper()
	svc, err := NewAuditService(AuditConfig{
		Runner: &fakeRunner{},
		Store:  store,
		Logger: zerolog.Nop(),
		Now:    func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewAuditService: %v", err)
	}
	return svc
}

// --- append-only IMMUTABILITY (the core Prompt 10 guarantee) -----------------

// TestAudit_AppendOnly_NoUpdateOrDeletePath is the structural proof that the
// audit log is append-only: neither the AuditStore interface nor its production
// implementation exposes any update/delete/mutate method, and the AuditService
// exposes only record + read. A mutation path simply does not exist to call.
func TestAudit_AppendOnly_NoUpdateOrDeletePath(t *testing.T) {
	forbidden := regexp.MustCompile(`(?i)^(update|delete|remove|mutate|edit|patch|set|overwrite|purge|truncate)`)

	assertNoMutators := func(name string, typ reflect.Type) {
		for i := 0; i < typ.NumMethod(); i++ {
			m := typ.Method(i).Name
			if forbidden.MatchString(m) {
				t.Errorf("%s exposes a mutation method %q — the audit log must be append-only", name, m)
			}
		}
	}

	// The interface contract.
	assertNoMutators("AuditStore", reflect.TypeOf((*AuditStore)(nil)).Elem())
	// The production SQL implementation (pointer receiver methods).
	assertNoMutators("*SQLAuditStore", reflect.TypeOf(&SQLAuditStore{}))
	// The service surface.
	assertNoMutators("*AuditService", reflect.TypeOf(&AuditService{}))

	// The interface must expose exactly the append + read trio.
	st := reflect.TypeOf((*AuditStore)(nil)).Elem()
	for _, want := range []string{"Append", "ListForEvent", "ListRecentEvents"} {
		if _, ok := st.MethodByName(want); !ok {
			t.Errorf("AuditStore is missing expected method %q", want)
		}
	}
	if st.NumMethod() != 3 {
		t.Errorf("AuditStore exposes %d methods, want exactly 3 (Append + 2 reads)", st.NumMethod())
	}
}

// TestAudit_Store_HasNoUpdateOrDeleteSQL proves the SQL store file contains no
// UPDATE/DELETE statement against the audit table — the database-layer half of
// the append-only guarantee is the migration's INSERT-only RLS policy, and the
// store-layer half is the absence of any mutating SQL here.
func TestAudit_Store_HasNoUpdateOrDeleteSQL(t *testing.T) {
	src, err := os.ReadFile("audit_store.go")
	if err != nil {
		t.Fatalf("read audit_store.go: %v", err)
	}
	body := strings.ToUpper(string(src))
	for _, banned := range []string{"UPDATE RECOVER_AUDIT_EVENT", "DELETE FROM RECOVER_AUDIT_EVENT", "TRUNCATE"} {
		if strings.Contains(body, banned) {
			t.Errorf("audit_store.go contains a mutating statement %q — the log must be append-only", banned)
		}
	}
}

// TestAudit_Record_AppendsImmutably proves recording many actions only ever grows
// the log and that each recorded row preserves who/what/when/which verbatim.
func TestAudit_Record_AppendsImmutably(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	store := &fakeAuditStore{}
	svc := newAuditService(t, store, now)
	tenant := uuid.New()
	event := uuid.New()
	actor := uuid.New()
	app := uuid.New()
	rb := uuid.New()

	rec := AuditRecord{
		EventID:       event,
		SubSolution:   AuditSubSolutionITDR,
		Action:        ActionRunbookRunCompleted,
		Actor:         AuditActor{ID: &actor, Email: "op@bank.test"},
		ApplicationID: &app,
		RunbookID:     &rb,
		Summary:       "runbook completed",
		Detail:        map[string]any{"rta": 900},
	}
	ev, err := svc.Record(context.Background(), tenant, rec)
	if err != nil {
		t.Fatalf("Record: %v", err)
	}
	if ev.EventID != event || ev.Action != ActionRunbookRunCompleted || ev.ActorEmail != "op@bank.test" {
		t.Fatalf("recorded who/what/which not preserved: %+v", ev)
	}
	if ev.ApplicationID == nil || *ev.ApplicationID != app || ev.RunbookID == nil || *ev.RunbookID != rb {
		t.Fatalf("recorded which-application/runbook not preserved: %+v", ev)
	}
	if ev.OccurredAt != now {
		t.Errorf("OccurredAt defaulted to %v, want %v", ev.OccurredAt, now)
	}

	// A second action against the same event only grows the log.
	if _, err := svc.Record(context.Background(), tenant, AuditRecord{
		EventID:     event,
		SubSolution: AuditSubSolutionITDR,
		Action:      ActionRunbookEditedLive,
		Actor:       AuditActor{Email: "op@bank.test"},
		Summary:     "edited live",
	}); err != nil {
		t.Fatalf("second Record: %v", err)
	}
	if store.count() != 2 {
		t.Fatalf("append-only log has %d rows, want 2", store.count())
	}

	timeline, err := svc.Timeline(context.Background(), tenant, event)
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if len(timeline) != 2 {
		t.Fatalf("timeline has %d entries, want 2", len(timeline))
	}
}

// --- validation (failure path) -----------------------------------------------

func TestAudit_Record_ValidationRejected(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	svc := newAuditService(t, &fakeAuditStore{}, now)
	tenant := uuid.New()

	cases := map[string]AuditRecord{
		"missing event":       {SubSolution: AuditSubSolutionITDR, Action: "x", Actor: AuditActor{Email: "a@b"}},
		"unknown subsolution": {EventID: uuid.New(), SubSolution: "nope", Action: "x", Actor: AuditActor{Email: "a@b"}},
		"missing action":      {EventID: uuid.New(), SubSolution: AuditSubSolutionITDR, Actor: AuditActor{Email: "a@b"}},
		"missing actor email": {EventID: uuid.New(), SubSolution: AuditSubSolutionITDR, Action: "x"},
	}
	for name, rec := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := svc.Record(context.Background(), tenant, rec)
			if !errors.Is(err, ErrInvalidAuditRecord) {
				t.Fatalf("err = %v, want ErrInvalidAuditRecord", err)
			}
		})
	}

	// A nil tenant is rejected before any store call.
	if _, err := svc.Record(context.Background(), uuid.Nil, AuditRecord{
		EventID: uuid.New(), SubSolution: AuditSubSolutionITDR, Action: "x", Actor: AuditActor{Email: "a@b"},
	}); !errors.Is(err, ErrInvalidAuditRecord) {
		t.Fatalf("nil tenant err = %v, want ErrInvalidAuditRecord", err)
	}
}

// --- concurrency (many operators record at once) -----------------------------

func TestAudit_Record_Concurrent(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	store := &fakeAuditStore{}
	svc, err := NewAuditService(AuditConfig{
		Runner: concurrentRunner{},
		Store:  store,
		Logger: zerolog.Nop(),
		Now:    func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewAuditService: %v", err)
	}

	const n = 64
	tenant := uuid.New()
	event := uuid.New()
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			_, _ = svc.Record(context.Background(), tenant, AuditRecord{
				EventID:     event,
				SubSolution: AuditSubSolutionCyberRecovery,
				Action:      ActionIntegrityEvaluated,
				Actor:       AuditActor{Email: "scanner@recover"},
				Summary:     "gate evaluated",
			})
		}()
	}
	wg.Wait()

	if store.count() != n {
		t.Fatalf("append-only log has %d rows after %d concurrent records, want %d", store.count(), n, n)
	}
}
