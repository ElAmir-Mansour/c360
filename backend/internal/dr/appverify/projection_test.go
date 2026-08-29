package appverify

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// fakeResultStore records the rows Save was asked to persist.
type fakeResultStore struct {
	saved   []StoredResult
	saveErr error
}

func (f *fakeResultStore) Save(_ context.Context, _ DBTX, rec *StoredResult) error {
	if f.saveErr != nil {
		return f.saveErr
	}
	rec.ID = uuid.New()
	f.saved = append(f.saved, *rec)
	return nil
}

// directRunner runs fn with a nil DBTX (the fake store ignores it).
type directRunner struct{ writeErr error }

func (r directRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	if r.writeErr != nil {
		return r.writeErr
	}
	return fn(nil)
}
func (r directRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}

// validatedEventData builds a recovery.validated payload like the failover gate
// emits: run/group context plus the app_verification detail with one row per
// recovered member.
func validatedEventData(t *testing.T, groupID uuid.UUID) []byte {
	t.Helper()
	finished := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	payload := map[string]any{
		"run_id":   "run-123",
		"group_id": groupID.String(),
		"mode":     "real",
		"status":   "ATTESTED",
		"app_verification": map[string]any{
			"enabled":    true,
			"all_passed": false,
			"results": []map[string]any{
				{
					"site_id": "site-a",
					"planned": true,
					"passed":  true,
					"result": Result{
						WorkloadID: "wl-a", ProfileKind: WorkloadPostgres, Passed: true,
						ChecksTotal: 3, ChecksPassed: 3, RequiredTotal: 2, RequiredPassed: 2,
						DurationMS: 120, FinishedAt: finished,
					},
				},
				{
					"site_id": "site-b",
					"planned": true,
					"passed":  false,
					"result": Result{
						WorkloadID: "wl-b", ProfileKind: WorkloadKafka, Passed: false,
						ChecksTotal: 2, ChecksPassed: 1, RequiredTotal: 2, RequiredPassed: 1,
						FailedChecks: []string{"kafka_topic_describe"}, DurationMS: 80, FinishedAt: finished,
					},
				},
				// Health-only member: planned an app verification of none — skipped.
				{"site_id": "site-c", "planned": false, "passed": true},
			},
		},
	}
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return data
}

func TestParseValidatedResults_ExtractsPlannedRows(t *testing.T) {
	t.Parallel()
	groupID := uuid.New()
	tenantID := uuid.New()
	results, err := parseValidatedResults(tenantID, validatedEventData(t, groupID))
	if err != nil {
		t.Fatalf("parseValidatedResults: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("results = %d, want 2 (the unplanned member is skipped)", len(results))
	}
	a := results[0]
	if a.TenantID != tenantID || a.GroupID != groupID || a.RunID != "run-123" || a.SiteID != "site-a" {
		t.Errorf("row a scope = %+v, want tenant/group/run-123/site-a", a)
	}
	if a.WorkloadKind != "postgres" || !a.Passed || a.ChecksPassed != 3 {
		t.Errorf("row a = %+v, want postgres passed 3/3", a)
	}
	b := results[1]
	if b.WorkloadKind != "kafka" || b.Passed || len(b.FailedChecks) != 1 || b.FailedChecks[0] != "kafka_topic_describe" {
		t.Errorf("row b = %+v, want kafka failed with one failed check", b)
	}
}

func TestParseValidatedResults_NoAppVerification(t *testing.T) {
	t.Parallel()
	data, _ := json.Marshal(map[string]any{"run_id": "r", "group_id": uuid.New().String()})
	results, err := parseValidatedResults(uuid.New(), data)
	if err != nil {
		t.Fatalf("parseValidatedResults: %v", err)
	}
	if results != nil {
		t.Errorf("results = %+v, want nil when no app_verification detail present", results)
	}
}

func TestParseValidatedResults_BadGroupID(t *testing.T) {
	t.Parallel()
	data, _ := json.Marshal(map[string]any{
		"run_id":           "r",
		"group_id":         "not-a-uuid",
		"app_verification": map[string]any{"results": []map[string]any{{"site_id": "s", "planned": true, "result": Result{}}}},
	})
	if _, err := parseValidatedResults(uuid.New(), data); err == nil {
		t.Fatal("expected an error for an invalid group_id")
	}
}

func TestResultProjector_Handle_ProjectsEachWorkload(t *testing.T) {
	t.Parallel()
	store := &fakeResultStore{}
	projector := NewResultProjector(store, directRunner{}, "datastream.dr.events", zerolog.Nop())

	groupID, tenantID := uuid.New(), uuid.New()
	event := &events.Event{
		Type:     EventRecoveryValidated,
		TenantID: tenantID.String(),
		Data:     validatedEventData(t, groupID),
	}
	if err := projector.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(store.saved) != 2 {
		t.Fatalf("persisted %d rows, want 2", len(store.saved))
	}
	if store.saved[0].TenantID != tenantID || store.saved[0].GroupID != groupID {
		t.Errorf("saved row scope = %+v, want tenant/group from the event", store.saved[0])
	}
}

func TestResultProjector_Handle_DropsBadTenant(t *testing.T) {
	t.Parallel()
	store := &fakeResultStore{}
	projector := NewResultProjector(store, directRunner{}, "", zerolog.Nop())
	event := &events.Event{Type: EventRecoveryValidated, TenantID: "not-a-uuid", Data: validatedEventData(t, uuid.New())}
	if err := projector.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle should drop (not error) a bad-tenant event: %v", err)
	}
	if len(store.saved) != 0 {
		t.Error("nothing should be persisted for a malformed tenant")
	}
}

func TestResultProjector_Handle_DropsUndecodable(t *testing.T) {
	t.Parallel()
	store := &fakeResultStore{}
	projector := NewResultProjector(store, directRunner{}, "", zerolog.Nop())
	event := &events.Event{Type: EventRecoveryValidated, TenantID: uuid.New().String(), Data: []byte("{not json")}
	if err := projector.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle should drop (not error) an undecodable event: %v", err)
	}
	if len(store.saved) != 0 {
		t.Error("nothing should be persisted for an undecodable payload")
	}
}

func TestResultProjector_Handle_StoreErrorRetries(t *testing.T) {
	t.Parallel()
	store := &fakeResultStore{saveErr: errors.New("db down")}
	projector := NewResultProjector(store, directRunner{}, "", zerolog.Nop())
	event := &events.Event{Type: EventRecoveryValidated, TenantID: uuid.New().String(), Data: validatedEventData(t, uuid.New())}
	if err := projector.Handle(context.Background(), event); err == nil {
		t.Fatal("a store failure must be returned so the bus retries")
	}
}

func TestResultProjector_TypesAndTopics(t *testing.T) {
	t.Parallel()
	p := NewResultProjector(&fakeResultStore{}, directRunner{}, "dr.topic", zerolog.Nop())
	if got := p.Topics(); len(got) != 1 || got[0] != "dr.topic" {
		t.Errorf("Topics() = %v, want [dr.topic]", got)
	}
	if got := p.EventTypes(); len(got) != 1 || got[0] != EventRecoveryValidated {
		t.Errorf("EventTypes() = %v, want [%s]", got, EventRecoveryValidated)
	}
}
