package storageoffload

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// TestOffloadLoop_DrivesPendingSnapshotToReady wires the real loop over the real
// service + file provider and asserts a single Tick advances a PENDING snapshot
// all the way to READY by polling the provider — the poll-to-completion path
// driven from the background loop, end-to-end against the filesystem.
func TestOffloadLoop_DrivesPendingSnapshotToReady(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	volumeDir := t.TempDir()
	snapRoot := t.TempDir()
	writeVolumeFile(t, volumeDir, "f.txt", []byte("content"))

	store := newMemStore()
	svc, _ := newTestService(t, store, snapRoot)
	tenantID := uuid.New()

	vol, err := svc.RegisterVolume(ctx, &Volume{
		TenantID: tenantID, Name: "loopvol", Provider: ProviderFile,
		ArrayEndpoint: snapRoot, SourceLocation: volumeDir, RetentionMaxSnapshots: 5,
	})
	if err != nil {
		t.Fatalf("RegisterVolume: %v", err)
	}
	snap, err := svc.RequestSnapshot(ctx, tenantID, vol.ID)
	if err != nil {
		t.Fatalf("RequestSnapshot: %v", err)
	}

	loop, err := NewOffloadLoop(OffloadLoopConfig{
		Driver: svc, Store: store, System: memRunner{}, Logger: zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewOffloadLoop: %v", err)
	}

	if err := loop.Tick(ctx); err != nil {
		t.Fatalf("Tick: %v", err)
	}

	got, err := svc.GetSnapshot(ctx, tenantID, snap.ID)
	if err != nil {
		t.Fatalf("GetSnapshot: %v", err)
	}
	if got.State != StateReady {
		t.Fatalf("after loop Tick state = %q, want READY", got.State)
	}
	if got.FileCount != 1 {
		t.Errorf("FileCount = %d, want 1", got.FileCount)
	}
}

// TestNewOffloadLoop_Validation proves required deps are enforced.
func TestNewOffloadLoop_Validation(t *testing.T) {
	t.Parallel()
	if _, err := NewOffloadLoop(OffloadLoopConfig{}); err == nil {
		t.Fatal("expected error for missing driver")
	}
	if _, err := NewOffloadLoop(OffloadLoopConfig{Driver: stubDriver{}}); err == nil {
		t.Fatal("expected error for missing store")
	}
	if _, err := NewOffloadLoop(OffloadLoopConfig{Driver: stubDriver{}, Store: newMemStore()}); err == nil {
		t.Fatal("expected error for missing system runner")
	}
}

type stubDriver struct{}

func (stubDriver) DriveSnapshot(context.Context, *Snapshot) error         { return nil }
func (stubDriver) ApplyRetention(context.Context, uuid.UUID) (int, error) { return 0, nil }
