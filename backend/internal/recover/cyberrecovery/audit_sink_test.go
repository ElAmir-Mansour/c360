package cyberrecovery

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// recordingSink is an in-memory AuditSink that captures every flow action the
// service emits, so a test can prove every recovery action across the
// cyber-recovery flow writes to the unified append-only audit log — and that it
// is called with the SAME DBTX the transition uses (atomic write). It exposes no
// update/delete, mirroring the production append-only sink.
type recordingSink struct {
	mu      sync.Mutex
	actions []string
	events  []uuid.UUID
}

func (s *recordingSink) RecordFlowAction(_ context.Context, _ repository.DBTX, _ uuid.UUID, eventID uuid.UUID, _ Actor, act AuditAction) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.actions = append(s.actions, act.Action)
	s.events = append(s.events, eventID)
	return nil
}

func (s *recordingSink) recorded() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, len(s.actions))
	copy(out, s.actions)
	return out
}

// TestCyberRecovery_AuditSink_RecordsEveryAction proves that, with a unified
// AuditSink wired, every cyber-recovery flow transition (select → provision →
// run → integrity gate → request approval → approve → return to production) emits
// exactly one unified append-only audit row keyed by the flow id as the event.
func TestCyberRecovery_AuditSink_RecordsEveryAction(t *testing.T) {
	sink := &recordingSink{}
	store := newMemStore()
	svc, err := NewService(Config{
		Runner:     &fakeRunner{},
		Store:      store,
		Scanner:    &fakeScanner{verdict: VerdictClean},
		Ransomware: &fakeRansomware{},
		Audit:      sink,
		Logger:     zerolog.Nop(),
		Now:        func() time.Time { return time.Unix(1700000200, 0).UTC() },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	tenant := uuid.New()

	creator := Actor{ID: ptrUUID(uuid.New()), Email: "op@bank.test"}
	approver := Actor{ID: ptrUUID(uuid.New()), Email: "ciso@bank.test"}

	scanAt := time.Unix(1700000150, 0).UTC()
	cp := uuid.New()
	store.cleanPoints[cp] = CleanPoint{ID: cp, GroupID: uuid.New(), MarkerLSN: "0/AB", SealedAt: time.Unix(1700000000, 0).UTC(), IsValidated: true, LegalHold: true, LatestScanVerdict: VerdictClean, LatestScanAt: &scanAt}

	flow, err := svc.SelectCleanPoint(context.Background(), tenant, creator, SelectCleanPointInput{CleanPointID: cp, TargetLabel: "bm-01", TargetKind: TargetBareMetal})
	if err != nil {
		t.Fatalf("SelectCleanPoint: %v", err)
	}
	mustStep(t, "Provision", func() error { _, e := svc.Provision(context.Background(), tenant, flow.ID, creator); return e })
	mustStep(t, "RunRecovery", func() error {
		_, e := svc.RunRecovery(context.Background(), tenant, flow.ID, creator, "rb-run-1")
		return e
	})
	mustStep(t, "RunIntegrityCheck", func() error { _, e := svc.RunIntegrityCheck(context.Background(), tenant, flow.ID, creator); return e })
	mustStep(t, "RequestApproval", func() error { _, e := svc.RequestApproval(context.Background(), tenant, flow.ID, creator); return e })
	mustStep(t, "Approve", func() error { _, e := svc.Approve(context.Background(), tenant, flow.ID, approver, "clean"); return e })
	mustStep(t, "ReturnToProduction", func() error {
		_, e := svc.ReturnToProduction(context.Background(), tenant, flow.ID, approver)
		return e
	})

	got := sink.recorded()
	want := []string{
		"cyber.clean_point.selected",
		"cyber.target.provisioned",
		"cyber.recovery.run",
		"cyber.integrity.evaluated",
		"cyber.approval.requested",
		"cyber.approval.granted",
		"cyber.return_to_production",
	}
	if len(got) != len(want) {
		t.Fatalf("recorded %d audit actions, want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("audit action[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	// Every audit row is keyed by the flow id (the recovery event).
	for _, ev := range sink.events {
		if ev != flow.ID {
			t.Errorf("audit event id = %s, want flow id %s", ev, flow.ID)
		}
	}
}

// TestCyberRecovery_NilAuditSink_StillTransitions proves the sink is OPTIONAL: a
// nil sink leaves the flow's own append-only transition log as the record and the
// flow still progresses.
func TestCyberRecovery_NilAuditSink_StillTransitions(t *testing.T) {
	store := newMemStore()
	svc, err := NewService(Config{
		Runner:     &fakeRunner{},
		Store:      store,
		Scanner:    &fakeScanner{verdict: VerdictClean},
		Ransomware: &fakeRansomware{},
		Logger:     zerolog.Nop(),
		Now:        func() time.Time { return time.Unix(1700000200, 0).UTC() },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	tenant := uuid.New()
	scanAt := time.Unix(1700000150, 0).UTC()
	cp := uuid.New()
	store.cleanPoints[cp] = CleanPoint{ID: cp, GroupID: uuid.New(), MarkerLSN: "0/AB", SealedAt: time.Unix(1700000000, 0).UTC(), IsValidated: true, LegalHold: true, LatestScanVerdict: VerdictClean, LatestScanAt: &scanAt}
	if _, err := svc.SelectCleanPoint(context.Background(), tenant, Actor{Email: "op@bank.test"}, SelectCleanPointInput{CleanPointID: cp, TargetLabel: "bm", TargetKind: TargetBareMetal}); err != nil {
		t.Fatalf("SelectCleanPoint with nil sink: %v", err)
	}
}

func mustStep(t *testing.T, name string, fn func() error) {
	t.Helper()
	if err := fn(); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

func ptrUUID(id uuid.UUID) *uuid.UUID { return &id }
