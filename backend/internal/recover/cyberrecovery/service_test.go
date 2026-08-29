package cyberrecovery

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/ransomware"
	"github.com/clario360/platform/internal/dr/repository"
)

// --- fakes (mocks live only in test files) ---------------------------------

// fakeRunner runs fn with a nil DBTX (the fake store ignores it). It serializes
// transactions with a mutex so the concurrency test exercises the optimistic
// version check, not a data race on the in-memory map.
type fakeRunner struct{ mu sync.Mutex }

func (r *fakeRunner) RunReadWithTenant(ctx context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return fn(nil)
}

func (r *fakeRunner) RunWithTenant(ctx context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return fn(nil)
}

// memStore is an in-memory Store. It is not a source of truth for product code.
type memStore struct {
	flows       map[uuid.UUID]*Flow
	events      []FlowEvent
	cleanPoints map[uuid.UUID]CleanPoint
}

func newMemStore() *memStore {
	return &memStore{
		flows:       map[uuid.UUID]*Flow{},
		cleanPoints: map[uuid.UUID]CleanPoint{},
	}
}

func (m *memStore) CreateFlow(_ context.Context, _ repository.DBTX, f *Flow) error {
	f.ID = uuid.New()
	f.Version = 1
	f.CreatedAt = time.Unix(1700000000, 0).UTC()
	f.UpdatedAt = f.CreatedAt
	clone := *f
	m.flows[f.ID] = &clone
	return nil
}

func (m *memStore) GetFlow(_ context.Context, _ repository.DBTX, _ uuid.UUID, flowID uuid.UUID) (*Flow, error) {
	f, ok := m.flows[flowID]
	if !ok {
		return nil, ErrFlowNotFound
	}
	clone := *f
	return &clone, nil
}

func (m *memStore) ListFlows(_ context.Context, _ repository.DBTX, _ uuid.UUID, _ int) ([]Flow, error) {
	out := []Flow{}
	for _, f := range m.flows {
		out = append(out, *f)
	}
	return out, nil
}

func (m *memStore) UpdateFlow(_ context.Context, _ repository.DBTX, f *Flow, expected int64) error {
	cur, ok := m.flows[f.ID]
	if !ok {
		return ErrFlowNotFound
	}
	if cur.Version != expected {
		return ErrVersionConflict
	}
	f.Version = expected + 1
	f.UpdatedAt = time.Now().UTC()
	clone := *f
	m.flows[f.ID] = &clone
	return nil
}

func (m *memStore) AppendEvent(_ context.Context, _ repository.DBTX, e *FlowEvent) error {
	e.ID = uuid.New()
	e.CreatedAt = time.Now().UTC()
	m.events = append(m.events, *e)
	return nil
}

func (m *memStore) ListEvents(_ context.Context, _ repository.DBTX, _ uuid.UUID, flowID uuid.UUID) ([]FlowEvent, error) {
	out := []FlowEvent{}
	for _, e := range m.events {
		if e.FlowID == flowID {
			out = append(out, e)
		}
	}
	return out, nil
}

func (m *memStore) ListCleanPoints(_ context.Context, _ repository.DBTX, _ uuid.UUID, _ int) ([]CleanPoint, error) {
	out := []CleanPoint{}
	for _, cp := range m.cleanPoints {
		out = append(out, cp)
	}
	return out, nil
}

func (m *memStore) GetCleanPoint(_ context.Context, _ repository.DBTX, _ uuid.UUID, pointID uuid.UUID) (*CleanPoint, error) {
	cp, ok := m.cleanPoints[pointID]
	if !ok {
		return nil, ErrCleanPointNotFound
	}
	return &cp, nil
}

// fakeScanner returns a scripted verdict; calls counts invocations.
type fakeScanner struct {
	verdict string
	calls   int
	err     error
}

func (s *fakeScanner) ScanRecoveryPoint(_ context.Context, _, _ uuid.UUID) (IntegrityResult, error) {
	s.calls++
	if s.err != nil {
		return IntegrityResult{}, s.err
	}
	return IntegrityResult{
		ScanID:    uuid.New(),
		Verdict:   s.verdict,
		Detail:    "scripted verdict",
		ScannedAt: time.Unix(1700000100, 0).UTC(),
	}, nil
}

// fakeRansomware returns scripted signals.
type fakeRansomware struct{ signals []ransomware.Signal }

func (r *fakeRansomware) ListSignals(_ context.Context, _ repository.DBTX, _ string, _ int) ([]ransomware.Signal, error) {
	return r.signals, nil
}

// --- harness ---------------------------------------------------------------

type harness struct {
	svc     *Service
	store   *memStore
	scanner *fakeScanner
	tenant  uuid.UUID
}

func newHarness(t *testing.T, verdict string, forbidSelf bool) *harness {
	t.Helper()
	store := newMemStore()
	scanner := &fakeScanner{verdict: verdict}
	svc, err := NewService(Config{
		Runner:             &fakeRunner{},
		Store:              store,
		Scanner:            scanner,
		Ransomware:         &fakeRansomware{},
		Logger:             zerolog.Nop(),
		ForbidSelfApproval: forbidSelf,
		Now:                func() time.Time { return time.Unix(1700000200, 0).UTC() },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return &harness{svc: svc, store: store, scanner: scanner, tenant: uuid.New()}
}

// seedCleanPoint registers a clean (validated + clean-room CLEAN) point.
func (h *harness) seedCleanPoint(verdict string) uuid.UUID {
	id := uuid.New()
	scanAt := time.Unix(1700000150, 0).UTC()
	h.store.cleanPoints[id] = CleanPoint{
		ID:                id,
		GroupID:           uuid.New(),
		MarkerLSN:         "0/ABCDEF",
		SealedAt:          time.Unix(1700000000, 0).UTC(),
		IsValidated:       true,
		LegalHold:         true,
		LatestScanVerdict: verdict,
		LatestScanAt:      &scanAt,
	}
	return id
}

// driveToApproved runs a flow from selection through approval, returning the id.
func (h *harness) driveToApproved(t *testing.T, creator, approver Actor) uuid.UUID {
	t.Helper()
	cp := h.seedCleanPoint(VerdictClean)
	flow, err := h.svc.SelectCleanPoint(context.Background(), h.tenant, creator, SelectCleanPointInput{
		CleanPointID: cp, TargetLabel: "bare-metal-01", TargetKind: TargetBareMetal,
	})
	if err != nil {
		t.Fatalf("SelectCleanPoint: %v", err)
	}
	if _, err := h.svc.Provision(context.Background(), h.tenant, flow.ID, creator); err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if _, err := h.svc.RunRecovery(context.Background(), h.tenant, flow.ID, creator, "runbook-run-1"); err != nil {
		t.Fatalf("RunRecovery: %v", err)
	}
	if _, err := h.svc.RunIntegrityCheck(context.Background(), h.tenant, flow.ID, creator); err != nil {
		t.Fatalf("RunIntegrityCheck: %v", err)
	}
	if _, err := h.svc.RequestApproval(context.Background(), h.tenant, flow.ID, creator); err != nil {
		t.Fatalf("RequestApproval: %v", err)
	}
	if _, err := h.svc.Approve(context.Background(), h.tenant, flow.ID, approver, "looks clean"); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	return flow.ID
}

func actor() Actor {
	id := uuid.New()
	return Actor{ID: &id, Email: "operator@tenant.example"}
}

// --- ALLOWED gate case -----------------------------------------------------

// TestReturnToProduction_AllowedAfterCleanGateAndApproval proves the happy path:
// a CLEAN integrity scan plus an authorized approver's sign-off lets the flow
// return to production.
func TestReturnToProduction_AllowedAfterCleanGateAndApproval(t *testing.T) {
	h := newHarness(t, VerdictClean, false)
	creator, approver := actor(), actor()
	flowID := h.driveToApproved(t, creator, approver)

	flow, err := h.svc.ReturnToProduction(context.Background(), h.tenant, flowID, approver)
	if err != nil {
		t.Fatalf("ReturnToProduction (allowed): %v", err)
	}
	if flow.Phase != PhaseReturnedToProduction {
		t.Fatalf("phase = %s, want returned_to_production", flow.Phase)
	}
	if flow.ReturnedBy == nil || *flow.ReturnedBy != *approver.ID {
		t.Errorf("returned_by provenance not recorded")
	}
}

// --- FORBIDDEN gate cases (the heart of the requirement) -------------------

// TestReturnToProduction_BlockedWithoutIntegrityPass proves the HARD gate: with
// a non-clean integrity verdict, return-to-production is refused server-side and
// the flow never advances.
func TestReturnToProduction_BlockedWithoutIntegrityPass(t *testing.T) {
	h := newHarness(t, VerdictClean, false)
	creator := actor()
	cp := h.seedCleanPoint(VerdictClean)
	flow, _ := h.svc.SelectCleanPoint(context.Background(), h.tenant, creator, SelectCleanPointInput{
		CleanPointID: cp, TargetLabel: "host", TargetKind: TargetCleanRoom,
	})
	mustProvisionRecover(t, h, flow.ID, creator)

	// The scanner now returns a DIRTY verdict — the gate must fail.
	h.scanner.verdict = "malware"
	checked, err := h.svc.RunIntegrityCheck(context.Background(), h.tenant, flow.ID, creator)
	if err != nil {
		t.Fatalf("RunIntegrityCheck: %v", err)
	}
	if checked.Phase != PhaseIntegrityFailed {
		t.Fatalf("phase = %s, want integrity_failed", checked.Phase)
	}

	// Even attempting to approve must fail (integrity gate not passed).
	if _, err := h.svc.Approve(context.Background(), h.tenant, flow.ID, actor(), ""); !errors.Is(err, ErrIntegrityGateNotPassed) {
		t.Fatalf("Approve on dirty flow err = %v, want ErrIntegrityGateNotPassed", err)
	}

	// And return-to-production must be HARD-blocked.
	if _, err := h.svc.ReturnToProduction(context.Background(), h.tenant, flow.ID, actor()); !errors.Is(err, ErrIntegrityGateNotPassed) {
		t.Fatalf("ReturnToProduction err = %v, want ErrIntegrityGateNotPassed", err)
	}
	// The flow must NOT have advanced to production.
	got, _ := h.store.GetFlow(context.Background(), nil, h.tenant, flow.ID)
	if got.Phase == PhaseReturnedToProduction {
		t.Fatal("flow returned to production despite a failed integrity gate")
	}
}

// TestReturnToProduction_BlockedWithoutApproval proves the second half of the
// gate: a CLEAN scan WITHOUT an approver sign-off still blocks return-to-prod.
func TestReturnToProduction_BlockedWithoutApproval(t *testing.T) {
	h := newHarness(t, VerdictClean, false)
	creator := actor()
	cp := h.seedCleanPoint(VerdictClean)
	flow, _ := h.svc.SelectCleanPoint(context.Background(), h.tenant, creator, SelectCleanPointInput{
		CleanPointID: cp, TargetLabel: "host", TargetKind: TargetCleanRoom,
	})
	mustProvisionRecover(t, h, flow.ID, creator)
	if _, err := h.svc.RunIntegrityCheck(context.Background(), h.tenant, flow.ID, creator); err != nil {
		t.Fatalf("RunIntegrityCheck: %v", err)
	}
	if _, err := h.svc.RequestApproval(context.Background(), h.tenant, flow.ID, creator); err != nil {
		t.Fatalf("RequestApproval: %v", err)
	}

	// No Approve() call — return must be refused for lack of an approver.
	if _, err := h.svc.ReturnToProduction(context.Background(), h.tenant, flow.ID, actor()); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("ReturnToProduction err = %v, want ErrApprovalRequired", err)
	}
}

// TestReturnToProduction_StaleApprovalInvalidatedByRescan proves provenance
// integrity: approving, then re-running the gate (producing a NEW scan) clears
// the approval so the stale sign-off cannot be replayed against the new scan.
func TestReturnToProduction_StaleApprovalInvalidatedByRescan(t *testing.T) {
	h := newHarness(t, VerdictClean, false)
	creator, approver := actor(), actor()
	flowID := h.driveToApproved(t, creator, approver)

	// A re-scan after approval — still clean, but a NEW scan id.
	if _, err := h.svc.RunIntegrityCheck(context.Background(), h.tenant, flowID, creator); err != nil {
		t.Fatalf("re-scan: %v", err)
	}
	// The prior approval is now stale; return-to-prod must be blocked.
	if _, err := h.svc.ReturnToProduction(context.Background(), h.tenant, flowID, approver); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("ReturnToProduction after rescan err = %v, want ErrApprovalRequired", err)
	}
}

// --- authorization-adjacent: separation of duties --------------------------

// TestApprove_SelfApprovalForbidden proves the creator cannot approve their own
// flow when separation of duties is enforced.
func TestApprove_SelfApprovalForbidden(t *testing.T) {
	h := newHarness(t, VerdictClean, true) // forbidSelfApproval = true
	creator := actor()
	cp := h.seedCleanPoint(VerdictClean)
	flow, _ := h.svc.SelectCleanPoint(context.Background(), h.tenant, creator, SelectCleanPointInput{
		CleanPointID: cp, TargetLabel: "host", TargetKind: TargetCleanRoom,
	})
	mustProvisionRecover(t, h, flow.ID, creator)
	if _, err := h.svc.RunIntegrityCheck(context.Background(), h.tenant, flow.ID, creator); err != nil {
		t.Fatalf("RunIntegrityCheck: %v", err)
	}
	if _, err := h.svc.Approve(context.Background(), h.tenant, flow.ID, creator, ""); !errors.Is(err, ErrSelfApproval) {
		t.Fatalf("self-approval err = %v, want ErrSelfApproval", err)
	}
	// A different approver succeeds.
	if _, err := h.svc.Approve(context.Background(), h.tenant, flow.ID, actor(), ""); err != nil {
		t.Fatalf("third-party approve: %v", err)
	}
}

// --- edge / validation cases -----------------------------------------------

// TestSelectCleanPoint_RejectsDirtyPoint proves a never-clean point cannot seed
// a flow.
func TestSelectCleanPoint_RejectsDirtyPoint(t *testing.T) {
	h := newHarness(t, VerdictClean, false)
	cp := h.seedCleanPoint("integrity_failed")
	if _, err := h.svc.SelectCleanPoint(context.Background(), h.tenant, actor(), SelectCleanPointInput{
		CleanPointID: cp, TargetLabel: "host",
	}); !errors.Is(err, ErrCleanPointNotClean) {
		t.Fatalf("err = %v, want ErrCleanPointNotClean", err)
	}
}

func TestSelectCleanPoint_Validation(t *testing.T) {
	h := newHarness(t, VerdictClean, false)
	cp := h.seedCleanPoint(VerdictClean)
	cases := map[string]SelectCleanPointInput{
		"missing clean point": {TargetLabel: "host"},
		"missing label":       {CleanPointID: cp},
		"bad target kind":     {CleanPointID: cp, TargetLabel: "host", TargetKind: "nonsense"},
	}
	for name, in := range cases {
		if _, err := h.svc.SelectCleanPoint(context.Background(), h.tenant, actor(), in); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("%s: err = %v, want ErrInvalidInput", name, err)
		}
	}
}

// TestRunIntegrityCheck_RequiresRecoveredPhase proves the gate cannot run before
// the recovery step.
func TestRunIntegrityCheck_RequiresRecoveredPhase(t *testing.T) {
	h := newHarness(t, VerdictClean, false)
	cp := h.seedCleanPoint(VerdictClean)
	flow, _ := h.svc.SelectCleanPoint(context.Background(), h.tenant, actor(), SelectCleanPointInput{
		CleanPointID: cp, TargetLabel: "host",
	})
	// Still at clean_point_selected — the gate must reject.
	if _, err := h.svc.RunIntegrityCheck(context.Background(), h.tenant, flow.ID, actor()); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("err = %v, want ErrInvalidTransition", err)
	}
}

// --- concurrency (stateful gate) -------------------------------------------

// TestReturnToProduction_ConcurrentReturnsOnlyOneWins proves that two operators
// racing to return the same approved flow do not double-advance: exactly one
// succeeds, the other observes a version conflict or already-returned state.
func TestReturnToProduction_ConcurrentReturnsOnlyOneWins(t *testing.T) {
	h := newHarness(t, VerdictClean, false)
	creator, approver := actor(), actor()
	flowID := h.driveToApproved(t, creator, approver)

	const racers = 8
	var wg sync.WaitGroup
	var mu sync.Mutex
	var successes int
	errs := make([]error, 0, racers)
	wg.Add(racers)
	for i := 0; i < racers; i++ {
		go func() {
			defer wg.Done()
			_, err := h.svc.ReturnToProduction(context.Background(), h.tenant, flowID, approver)
			mu.Lock()
			if err == nil {
				successes++
			} else {
				errs = append(errs, err)
			}
			mu.Unlock()
		}()
	}
	wg.Wait()

	if successes != 1 {
		t.Fatalf("concurrent returns succeeded %d times, want exactly 1", successes)
	}
	for _, err := range errs {
		if !errors.Is(err, ErrVersionConflict) && !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("loser error = %v, want version conflict or invalid transition", err)
		}
	}
	got, _ := h.store.GetFlow(context.Background(), nil, h.tenant, flowID)
	if got.Phase != PhaseReturnedToProduction {
		t.Fatalf("final phase = %s, want returned_to_production", got.Phase)
	}
}

// --- overview --------------------------------------------------------------

// TestOverview_DerivesFromRealState proves the dashboard is computed from real
// records (clean points, signals, flows) and never canned.
func TestOverview_DerivesFromRealState(t *testing.T) {
	h := newHarness(t, VerdictClean, false)
	h.svc.ransomware = &fakeRansomware{signals: []ransomware.Signal{
		{ID: "s1", Severity: ransomware.SeverityConfirmed, Kind: ransomware.SignalEntropy},
		{ID: "s2", Severity: ransomware.SeverityWarning, Kind: ransomware.SignalByteRate},
	}}
	cleanID := h.seedCleanPoint(VerdictClean)
	_ = cleanID

	flow, _ := h.svc.SelectCleanPoint(context.Background(), h.tenant, actor(), SelectCleanPointInput{
		CleanPointID: cleanID, TargetLabel: "host",
	})
	_ = flow

	ov, err := h.svc.Overview(context.Background(), h.tenant)
	if err != nil {
		t.Fatalf("Overview: %v", err)
	}
	if ov.ConfirmedRansomwareSignals != 1 {
		t.Errorf("confirmed signals = %d, want 1", ov.ConfirmedRansomwareSignals)
	}
	if len(ov.RansomwareSignals) != 2 {
		t.Errorf("signals = %d, want 2", len(ov.RansomwareSignals))
	}
	if ov.LatestCleanPoint == nil {
		t.Error("expected a latest clean point")
	}
	if ov.CleanPointFreshnessSeconds == nil {
		t.Error("expected clean-point freshness")
	}
	if ov.ActiveFlows != 1 {
		t.Errorf("active flows = %d, want 1", ov.ActiveFlows)
	}
}

func TestNewService_Validation(t *testing.T) {
	good := Config{
		Runner: &fakeRunner{}, Store: newMemStore(),
		Scanner: &fakeScanner{}, Ransomware: &fakeRansomware{}, Logger: zerolog.Nop(),
	}
	cases := map[string]func(*Config){
		"nil runner":     func(c *Config) { c.Runner = nil },
		"nil store":      func(c *Config) { c.Store = nil },
		"nil scanner":    func(c *Config) { c.Scanner = nil },
		"nil ransomware": func(c *Config) { c.Ransomware = nil },
	}
	for name, mutate := range cases {
		cfg := good
		mutate(&cfg)
		if _, err := NewService(cfg); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
}

// mustProvisionRecover advances a freshly selected flow to recovered.
func mustProvisionRecover(t *testing.T, h *harness, flowID uuid.UUID, a Actor) {
	t.Helper()
	if _, err := h.svc.Provision(context.Background(), h.tenant, flowID, a); err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if _, err := h.svc.RunRecovery(context.Background(), h.tenant, flowID, a, ""); err != nil {
		t.Fatalf("RunRecovery: %v", err)
	}
}
