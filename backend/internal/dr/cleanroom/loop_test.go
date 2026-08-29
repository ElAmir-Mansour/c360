package cleanroom

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// memSource yields a fixed set of pending points once, then nothing.
type memSource struct {
	mu     sync.Mutex
	points []PendingPoint
	served bool
	err    error
}

func (s *memSource) PendingCleanroomScans(_ context.Context, limit int) ([]PendingPoint, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return nil, s.err
	}
	if s.served {
		return nil, nil
	}
	s.served = true
	if limit > 0 && limit < len(s.points) {
		return s.points[:limit], nil
	}
	return s.points, nil
}

// recordingLoopService records the points it was asked to scan and returns a
// verdict (or an error for designated points).
type recordingLoopService struct {
	mu      sync.Mutex
	scanned []uuid.UUID
	failOn  map[uuid.UUID]bool
}

func (s *recordingLoopService) ScanRecoveryPoint(_ context.Context, _, pointID uuid.UUID) (*Scan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.scanned = append(s.scanned, pointID)
	if s.failOn[pointID] {
		return nil, errors.New("boom")
	}
	return &Scan{RecoveryPointID: pointID.String(), Verdict: VerdictClean}, nil
}

func TestLoop_Tick_ScansAllPending(t *testing.T) {
	t.Parallel()
	p1 := PendingPoint{TenantID: uuid.New(), RecoveryPointID: uuid.New(), GroupID: uuid.New()}
	p2 := PendingPoint{TenantID: uuid.New(), RecoveryPointID: uuid.New(), GroupID: uuid.New()}
	src := &memSource{points: []PendingPoint{p1, p2}}
	svc := &recordingLoopService{}
	loop, err := NewLoop(LoopConfig{Source: src, Service: svc, Logger: zerolog.Nop(), Batch: 10})
	if err != nil {
		t.Fatalf("NewLoop: %v", err)
	}
	n, err := loop.tick(context.Background())
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	if n != 2 {
		t.Fatalf("scanned: got %d want 2", n)
	}
	if len(svc.scanned) != 2 {
		t.Fatalf("expected 2 scans, got %d", len(svc.scanned))
	}
}

func TestLoop_Tick_ContinuesOnScanError(t *testing.T) {
	t.Parallel()
	bad := PendingPoint{TenantID: uuid.New(), RecoveryPointID: uuid.New()}
	good := PendingPoint{TenantID: uuid.New(), RecoveryPointID: uuid.New()}
	src := &memSource{points: []PendingPoint{bad, good}}
	svc := &recordingLoopService{failOn: map[uuid.UUID]bool{bad.RecoveryPointID: true}}
	loop, _ := NewLoop(LoopConfig{Source: src, Service: svc, Logger: zerolog.Nop(), Batch: 10})

	n, err := loop.tick(context.Background())
	if err != nil {
		t.Fatalf("tick should not surface a per-point error: %v", err)
	}
	if n != 1 {
		t.Fatalf("scanned count should exclude the failed point: got %d want 1", n)
	}
	// Both points were attempted (the bad one did not stall the queue).
	if len(svc.scanned) != 2 {
		t.Fatalf("expected both points attempted, got %d", len(svc.scanned))
	}
}

func TestLoop_Tick_SourceError(t *testing.T) {
	t.Parallel()
	src := &memSource{err: errors.New("db down")}
	loop, _ := NewLoop(LoopConfig{Source: src, Service: &recordingLoopService{}, Logger: zerolog.Nop()})
	if _, err := loop.tick(context.Background()); err == nil {
		t.Fatal("expected source error to surface")
	}
}

func TestLoop_Run_StopsOnContextCancel(t *testing.T) {
	t.Parallel()
	src := &memSource{points: []PendingPoint{{TenantID: uuid.New(), RecoveryPointID: uuid.New()}}}
	svc := &recordingLoopService{}
	loop, _ := NewLoop(LoopConfig{Source: src, Service: svc, Logger: zerolog.Nop()})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		loop.Run(ctx)
		close(done)
	}()
	cancel()
	<-done // returns promptly on cancel
}

func TestNewLoop_RequiresDeps(t *testing.T) {
	t.Parallel()
	if _, err := NewLoop(LoopConfig{Service: &recordingLoopService{}}); err == nil {
		t.Fatal("expected error for nil source")
	}
	if _, err := NewLoop(LoopConfig{Source: &memSource{}}); err == nil {
		t.Fatal("expected error for nil service")
	}
	// Defaults applied.
	loop, err := NewLoop(LoopConfig{Source: &memSource{}, Service: &recordingLoopService{}})
	if err != nil {
		t.Fatalf("valid config: %v", err)
	}
	if loop.interval <= 0 || loop.batch <= 0 {
		t.Fatalf("defaults not applied: interval=%v batch=%d", loop.interval, loop.batch)
	}
}
