package executor

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// memIdempotencyStore is an in-memory IdempotencyStore for unit tests. It mirrors
// the ON CONFLICT DO NOTHING semantics of the real repository: the first Claim for
// a key wins; subsequent Claims report claimed=false and hand back the existing
// (possibly completed) record.
type memIdempotencyStore struct {
	mu   sync.Mutex
	rows map[string]*model.ActivityExecution
}

func newMemIdempotencyStore() *memIdempotencyStore {
	return &memIdempotencyStore{rows: map[string]*model.ActivityExecution{}}
}

func (m *memIdempotencyStore) Claim(_ context.Context, act *model.ActivityExecution) (bool, *model.ActivityExecution, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.rows[act.IdempotencyKey]; ok {
		cp := *existing
		return false, &cp, nil
	}
	row := *act
	row.Status = model.ActivityStatusPending
	m.rows[act.IdempotencyKey] = &row
	return true, nil, nil
}

func (m *memIdempotencyStore) MarkCompleted(_ context.Context, key string, responseData json.RawMessage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if row, ok := m.rows[key]; ok {
		row.Status = model.ActivityStatusCompleted
		row.ResponseData = responseData
	}
	return nil
}

func (m *memIdempotencyStore) MarkFailed(_ context.Context, key, errMsg string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if row, ok := m.rows[key]; ok {
		row.Status = model.ActivityStatusFailed
		row.ErrorMessage = &errMsg
	}
	return nil
}

func serviceStep() *model.StepDefinition {
	return &model.StepDefinition{
		ID:   "call-external",
		Type: model.StepTypeServiceTask,
		Name: "Call External",
		Config: map[string]interface{}{
			"service": "billing",
			"method":  "POST",
			"url":     "/charge",
			"body":    map[string]interface{}{"amount": 100},
		},
	}
}

func serviceInstance() *model.WorkflowInstance {
	return &model.WorkflowInstance{
		ID:          "inst-svc-1",
		TenantID:    "tenant-svc",
		Variables:   map[string]interface{}{},
		StepOutputs: map[string]interface{}{},
	}
}

// TestServiceTask_IdempotentReexecutionDoesNotDoubleFire proves the core
// at-most-once guarantee: re-executing the SAME activity attempt (as recovery
// does — it re-creates a step exec with attempt=1, so the derived key matches)
// replays the cached response and does NOT issue a second outbound HTTP call.
func TestServiceTask_IdempotentReexecutionDoesNotDoubleFire(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		// The Idempotency-Key header must be present on the outbound call.
		if r.Header.Get("Idempotency-Key") == "" {
			t.Errorf("outbound request missing Idempotency-Key header")
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"charged":true,"ref":"abc"}`))
	}))
	defer srv.Close()

	store := newMemIdempotencyStore()
	exe := NewServiceTaskExecutor(map[string]string{"billing": srv.URL}, zerolog.Nop())
	exe.SetIdempotencyStore(store)

	inst := serviceInstance()
	step := serviceStep()
	// First execution: fresh step exec, attempt 1.
	exec1 := &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 1}
	res1, err := exe.Execute(context.Background(), inst, step, exec1)
	if err != nil {
		t.Fatalf("first Execute error = %v", err)
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("after first execute, downstream hits = %d, want 1", got)
	}

	// Second execution: RECOVERY re-run — same instance/step/attempt => same key.
	exec2 := &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 1}
	res2, err := exe.Execute(context.Background(), inst, step, exec2)
	if err != nil {
		t.Fatalf("recovery re-Execute error = %v", err)
	}

	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("after recovery re-execute, downstream hits = %d, want 1 (must NOT double-fire)", got)
	}

	// The replayed result must equal the original output (cached response).
	if res1 == nil || res2 == nil {
		t.Fatalf("results must be non-nil: res1=%v res2=%v", res1, res2)
	}
	if !equalJSON(res1.Output["response"], res2.Output["response"]) {
		t.Fatalf("replayed response %#v != original %#v", res2.Output["response"], res1.Output["response"])
	}
}

// TestServiceTask_NewAttemptGetsFreshKeyAndFires confirms that a genuine retry
// (higher attempt number) derives a DISTINCT key and IS allowed to fire.
func TestServiceTask_NewAttemptGetsFreshKeyAndFires(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	store := newMemIdempotencyStore()
	exe := NewServiceTaskExecutor(map[string]string{"billing": srv.URL}, zerolog.Nop())
	exe.SetIdempotencyStore(store)

	inst := serviceInstance()
	step := serviceStep()

	if _, err := exe.Execute(context.Background(), inst, step, &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 1}); err != nil {
		t.Fatalf("attempt 1 error = %v", err)
	}
	if _, err := exe.Execute(context.Background(), inst, step, &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 2}); err != nil {
		t.Fatalf("attempt 2 error = %v", err)
	}
	if got := atomic.LoadInt32(&hits); got != 2 {
		t.Fatalf("distinct attempts should each fire once: hits = %d, want 2", got)
	}
}

// TestServiceTask_NoStoreKeepsLegacyBehaviour proves the guard is opt-in: without
// a store, re-execution fires every time (legacy at-least-once) and no
// Idempotency-Key header is required.
func TestServiceTask_NoStoreKeepsLegacyBehaviour(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if r.Header.Get("Idempotency-Key") != "" {
			t.Errorf("legacy path must NOT send Idempotency-Key, got %q", r.Header.Get("Idempotency-Key"))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	exe := NewServiceTaskExecutor(map[string]string{"billing": srv.URL}, zerolog.Nop())
	inst := serviceInstance()
	step := serviceStep()

	for i := 0; i < 2; i++ {
		if _, err := exe.Execute(context.Background(), inst, step, &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 1}); err != nil {
			t.Fatalf("legacy Execute %d error = %v", i, err)
		}
	}
	if got := atomic.LoadInt32(&hits); got != 2 {
		t.Fatalf("legacy path hits = %d, want 2 (at-least-once)", got)
	}
}

func equalJSON(a, b interface{}) bool {
	ab, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return string(ab) == string(bb)
}
