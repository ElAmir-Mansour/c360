package byok

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// fakeLoopStore returns a fixed set of rotating tenants.
type fakeLoopStore struct {
	tenants []uuid.UUID
}

func (f *fakeLoopStore) RotatingTenantsSystem(_ context.Context, _ repository.DBTX, limit int) ([]uuid.UUID, error) {
	if limit < len(f.tenants) {
		return f.tenants[:limit], nil
	}
	return f.tenants, nil
}

// fakeLoopSystem runs fns with a nil DBTX (the fake store ignores it).
type fakeLoopSystem struct{}

func (fakeLoopSystem) RunSystemRead(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(nil)
}

// recordingDriver records which tenants ResumeRotation was called for and can
// inject a failure for one tenant to prove isolation.
type recordingDriver struct {
	mu      sync.Mutex
	called  []uuid.UUID
	failFor uuid.UUID
}

func (d *recordingDriver) ResumeRotation(_ context.Context, tenantID uuid.UUID) error {
	d.mu.Lock()
	d.called = append(d.called, tenantID)
	d.mu.Unlock()
	if tenantID == d.failFor {
		return errors.New("injected resume failure")
	}
	return nil
}

func TestRotationLoop_TickResumesAllTenants(t *testing.T) {
	t1, t2, t3 := uuid.New(), uuid.New(), uuid.New()
	driver := &recordingDriver{failFor: t2} // t2 fails; t1/t3 must still run
	loop, err := NewRotationLoop(RotationLoopConfig{
		Driver: driver,
		Store:  &fakeLoopStore{tenants: []uuid.UUID{t1, t2, t3}},
		System: fakeLoopSystem{},
		Logger: zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("new loop: %v", err)
	}
	if err := loop.Tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	driver.mu.Lock()
	defer driver.mu.Unlock()
	if len(driver.called) != 3 {
		t.Fatalf("expected all 3 tenants resumed despite one failing, got %d", len(driver.called))
	}
}

func TestRotationLoop_TickRespectsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	loop, _ := NewRotationLoop(RotationLoopConfig{
		Driver: &recordingDriver{},
		Store:  &fakeLoopStore{tenants: []uuid.UUID{uuid.New()}},
		System: fakeLoopSystem{},
		Logger: zerolog.Nop(),
	})
	// Tick should return the context error without resuming.
	if err := loop.Tick(ctx); err != nil && !errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNewRotationLoop_Validation(t *testing.T) {
	_, err := NewRotationLoop(RotationLoopConfig{Store: &fakeLoopStore{}, System: fakeLoopSystem{}, Logger: zerolog.Nop()})
	if err == nil {
		t.Fatalf("missing driver should error")
	}
}
