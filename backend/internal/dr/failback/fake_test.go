package failback

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/repository"
)

// memStore is an in-memory failback store with REAL status-guard semantics so the
// gate logic (expected-status transitions, approval-only cutback, idempotent
// completion) is exercised for real — not merely recorded. It satisfies RunStore,
// FailbackStore and Claimer. It is concurrency-safe so the separate-transaction
// loop test can assert claim/advance ordering.
type memStore struct {
	mu    sync.Mutex
	runs  map[string]*FailbackRun
	steps map[string][]*FailbackStep // runID -> steps

	// instrumentation for the claim/advance separate-transaction assertion.
	claimedDuringAdvance bool
	advancing            bool

	// fault injection (read in the corresponding store methods).
	failRunErr  error
	upsertErr   error
	completeErr error
	updateErr   error
	nowFn       func() time.Time
}

func newMemStore() *memStore {
	return &memStore{
		runs:  map[string]*FailbackRun{},
		steps: map[string][]*FailbackStep{},
		nowFn: func() time.Time { return time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC) },
	}
}

func (m *memStore) now() time.Time { return m.nowFn().UTC() }

// setAdvancing marks (or clears) that an advance transaction is in flight. The
// loop test sets it true for the duration of the advance tx so SystemClaimRun can
// detect a claim that wrongly overlaps an advance (proving they are NOT separate).
func (m *memStore) setAdvancing(v bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.advancing = v
}

// seed inserts a run directly (bypassing CreateRun) for tests that start mid-FSM.
func (m *memStore) seed(run *FailbackRun) *FailbackRun {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *run
	if cp.ID == "" {
		cp.ID = uuid.NewString()
	}
	if cp.InitiatedAt.IsZero() {
		cp.InitiatedAt = m.now()
	}
	cp.UpdatedAt = m.now()
	m.runs[cp.ID] = &cp
	out := cp
	return &out
}

func (m *memStore) get(id string) *FailbackRun {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok {
		return nil
	}
	cp := *r
	return &cp
}

func (m *memStore) stepNames(runID string) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var names []string
	for _, s := range m.steps[runID] {
		names = append(names, s.Step)
	}
	return names
}

// --- RunStore + FailbackStore -------------------------------------------------

func (m *memStore) CreateRun(_ context.Context, _ repository.DBTX, r *FailbackRun) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r.ID = uuid.NewString()
	r.Status = StatusPlanning
	r.InitiatedAt = m.now()
	r.UpdatedAt = m.now()
	cp := *r
	m.runs[r.ID] = &cp
	return nil
}

func (m *memStore) GetRun(_ context.Context, _ repository.DBTX, tenantID, id string) (*FailbackRun, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok || r.TenantID != tenantID {
		return nil, ErrNotFound
	}
	cp := *r
	return &cp, nil
}

func (m *memStore) ListRuns(_ context.Context, _ repository.DBTX, tenantID string) ([]*FailbackRun, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*FailbackRun
	for _, r := range m.runs {
		if r.TenantID == tenantID {
			cp := *r
			out = append(out, &cp)
		}
	}
	return out, nil
}

func (m *memStore) UpdateRunStatus(_ context.Context, _ repository.DBTX, tenantID, id, newStatus, expectedStatus string, lastError *string) error {
	if m.updateErr != nil {
		return m.updateErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok || r.TenantID != tenantID {
		return ErrNotFound
	}
	if r.Status != expectedStatus {
		return ErrInvalidState
	}
	r.Status = newStatus
	r.LastError = lastError
	r.UpdatedAt = m.now()
	return nil
}

func (m *memStore) SetReverseStream(_ context.Context, _ repository.DBTX, tenantID, id, reverseStreamID string, sourceLSN *string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok || r.TenantID != tenantID {
		return ErrNotFound
	}
	r.ReverseStreamID = &reverseStreamID
	r.SourceLSN = sourceLSN
	r.UpdatedAt = m.now()
	return nil
}

func (m *memStore) UpdateDelta(_ context.Context, _ repository.DBTX, tenantID, id string, d DeltaUpdate) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok || r.TenantID != tenantID {
		return ErrNotFound
	}
	r.DeltaBytesRemaining = d.BytesRemaining
	r.DeltaSeqRemaining = d.SeqRemaining
	r.SourceLSN = d.SourceLSN
	r.AppliedLSN = d.AppliedLSN
	r.CutoverWindowOpen = d.CutoverWindowOpen
	r.UpdatedAt = m.now()
	return nil
}

func (m *memStore) MarkConverged(_ context.Context, _ repository.DBTX, tenantID, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok || r.TenantID != tenantID {
		return ErrNotFound
	}
	now := m.now()
	r.LastConvergedAt = &now
	return nil
}

func (m *memStore) ApproveCutback(_ context.Context, _ repository.DBTX, tenantID, id, approvedBy string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok || r.TenantID != tenantID {
		return ErrNotFound
	}
	if r.Status != StatusAwaitingCutbackApproval || r.ApprovedBy != nil {
		return ErrInvalidState
	}
	r.ApprovedBy = &approvedBy
	now := m.now()
	r.ApprovedAt = &now
	r.Status = StatusCuttingBack
	r.UpdatedAt = now
	return nil
}

func (m *memStore) CompleteRun(_ context.Context, _ repository.DBTX, tenantID, id, expectedStatus, newDirection string) error {
	if m.completeErr != nil {
		return m.completeErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok || r.TenantID != tenantID {
		return ErrNotFound
	}
	if r.Status != expectedStatus {
		return ErrInvalidState
	}
	r.Status = StatusCompleted
	r.NewDirection = &newDirection
	now := m.now()
	r.CompletedAt = &now
	r.LastError = nil
	r.UpdatedAt = now
	return nil
}

func (m *memStore) FailRun(_ context.Context, _ repository.DBTX, tenantID, id, expectedStatus string, reason *string) error {
	if m.failRunErr != nil {
		return m.failRunErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok || r.TenantID != tenantID {
		return ErrNotFound
	}
	if r.Status != expectedStatus {
		return ErrInvalidState
	}
	r.Status = StatusFailed
	r.LastError = reason
	now := m.now()
	r.CompletedAt = &now
	r.UpdatedAt = now
	return nil
}

func (m *memStore) UpsertStep(_ context.Context, _ repository.DBTX, step *FailbackStep) error {
	if m.upsertErr != nil {
		return m.upsertErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if step.ID == "" {
		step.ID = uuid.NewString()
	}
	if step.StartedAt.IsZero() {
		step.StartedAt = m.now()
	}
	existing := m.steps[step.RunID]
	for i, s := range existing {
		if s.Step == step.Step {
			cp := *step
			existing[i] = &cp
			return nil
		}
	}
	cp := *step
	m.steps[step.RunID] = append(existing, &cp)
	return nil
}

func (m *memStore) ListSteps(_ context.Context, _ repository.DBTX, runID string) ([]*FailbackStep, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*FailbackStep
	for _, s := range m.steps[runID] {
		cp := *s
		out = append(out, &cp)
	}
	return out, nil
}

// --- Claimer ------------------------------------------------------------------

// SystemClaimRun returns the first advanceable run (non-terminal, non-await),
// stamping claimed_at, exactly like the SQL claim. It records whether a claim
// occurred while an advance was "in progress" so a test can prove claim and
// advance run in separate transactions (no overlap).
func (m *memStore) SystemClaimRun(_ context.Context, _ repository.DBTX) (*FailbackRun, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.advancing {
		m.claimedDuringAdvance = true
	}
	for _, r := range m.runs {
		switch r.Status {
		case StatusCompleted, StatusFailed, StatusAwaitingCutbackApproval:
			continue
		}
		now := m.now()
		r.ClaimedAt = &now
		cp := *r
		return &cp, nil
	}
	return nil, nil
}

// --- fakes for driver collaborators ------------------------------------------

type fakeStarter struct {
	handle ReverseStreamHandle
	err    error
	calls  int
}

func (f *fakeStarter) StartReverseStream(_ context.Context, cfg ReverseStreamConfig) (ReverseStreamHandle, error) {
	f.calls++
	if f.err != nil {
		return ReverseStreamHandle{}, f.err
	}
	if f.handle.StreamID == "" {
		// idempotent default derived from the run id.
		return ReverseStreamHandle{StreamID: "reverse-" + cfg.RunID, SourceLSN: "0/100"}, nil
	}
	return f.handle, nil
}

type fakeCutback struct {
	detail map[string]any
	err    error
	calls  int
}

func (f *fakeCutback) ExecuteCutback(_ context.Context, _ *FailbackRun) (map[string]any, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.detail, nil
}

// fakeProber drives the DeltaTracker math deterministically.
type fakeProber struct {
	probe ReverseStreamProbe
	err   error
}

func (f fakeProber) Probe(_ context.Context, streamID string) (ReverseStreamProbe, error) {
	if f.err != nil {
		return ReverseStreamProbe{}, f.err
	}
	p := f.probe
	p.StreamID = streamID
	return p, nil
}

// recordingSink records emitted event types in order.
type recordingSink struct {
	mu    sync.Mutex
	types []string
	err   error
}

func (s *recordingSink) Emit(_ context.Context, _ repository.DBTX, _ string, eventType string, _ any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	s.types = append(s.types, eventType)
	return nil
}

func (s *recordingSink) eventTypes() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, len(s.types))
	copy(out, s.types)
	return out
}

// errIs is a small helper for table-driven error-cause assertions.
var errBoom = errors.New("boom")
