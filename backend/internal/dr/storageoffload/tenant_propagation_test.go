package storageoffload

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// capturingProvider records the tenant present in ctx when the orchestrator
// invokes it. The background offload loop drives snapshots on the system path
// (no tenant in ctx); this lets us assert DriveSnapshot pins each snapshot's OWN
// tenant into ctx before any provider I/O, so a resolver-backed provider builds
// the correct tenant's array client.
type capturingProvider struct {
	gotTenant       string
	gotDeleteTenant string
}

func (p *capturingProvider) Name() string { return "capture" }

func (p *capturingProvider) CreateSnapshot(ctx context.Context, _ SnapshotRequest) (SnapshotInfo, error) {
	p.gotTenant = auth.TenantFromContext(ctx)
	// Stop the drive right after recording: the test only asserts the ctx tenant,
	// not the full create/poll/catalog path.
	return SnapshotInfo{}, errors.New("capture: stop after recording tenant")
}

func (p *capturingProvider) SnapshotStatus(ctx context.Context, _ SnapshotRequest, _ string) (SnapshotInfo, error) {
	p.gotTenant = auth.TenantFromContext(ctx)
	return SnapshotInfo{}, errors.New("capture: stop after recording tenant")
}

func (p *capturingProvider) ListSnapshots(context.Context, SnapshotRequest) ([]string, error) {
	return nil, nil
}

func (p *capturingProvider) ReplicateSnapshot(context.Context, SnapshotRequest, string, string, string) (int64, error) {
	return 0, nil
}

func (p *capturingProvider) DeleteSnapshot(ctx context.Context, _ SnapshotRequest, _ string) error {
	p.gotDeleteTenant = auth.TenantFromContext(ctx)
	return nil
}

// TestDriveSnapshot_PinsSnapshotTenantIntoContext proves the cross-tenant fix:
// even though the inbound ctx carries no tenant (the loop's system path), the
// provider sees the SNAPSHOT's tenant in ctx, never a stale "last resolved" one.
func TestDriveSnapshot_PinsSnapshotTenantIntoContext(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	tenantID := uuid.New()
	volID := uuid.New()
	if err := store.CreateVolume(context.Background(), nil, &Volume{
		ID: volID, TenantID: tenantID, Name: "vol", Provider: "capture", SourceLocation: "/x",
	}); err != nil {
		t.Fatalf("CreateVolume: %v", err)
	}

	prov := &capturingProvider{}
	svc, err := NewService(Deps{
		Store:     store,
		Runner:    memRunner{},
		System:    memRunner{},
		Providers: map[string]StorageOffloadProvider{"capture": prov},
		Metrics:   NewMetrics(nil),
		Logger:    zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	snap := &Snapshot{
		ID: uuid.New(), TenantID: tenantID, VolumeID: volID,
		State: StatePending, Kind: SnapshotKindFull,
	}
	// Inbound ctx has NO tenant — mirrors the background loop's system path.
	_ = svc.DriveSnapshot(context.Background(), snap)

	if prov.gotTenant != tenantID.String() {
		t.Fatalf("provider saw tenant %q in ctx, want the snapshot's own tenant %q (DriveSnapshot did not pin it)",
			prov.gotTenant, tenantID.String())
	}
}

// TestApplyRetention_PinsVolumeTenantIntoContext proves the OTHER provider-driving
// loop path (retention) also pins the tenant: provider.DeleteSnapshot must see the
// volume's tenant in ctx even though retention runs on the system path with no
// tenant. Without this, retention deletes against an integration-backed array
// would fail closed.
func TestApplyRetention_PinsVolumeTenantIntoContext(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	tenantID := uuid.New()
	volumeID := uuid.New()

	// Two READY full snapshots; with RetentionMaxSnapshots=1 the older one is a
	// surplus the provider must delete.
	base := time.Now().UTC()
	keep := &Snapshot{ID: uuid.New(), TenantID: tenantID, VolumeID: volumeID, State: StateReady, Kind: SnapshotKindFull, CreatedAt: base.Add(-10 * time.Minute), ProviderHandle: "snap-keep"}
	surplus := &Snapshot{ID: uuid.New(), TenantID: tenantID, VolumeID: volumeID, State: StateReady, Kind: SnapshotKindFull, CreatedAt: base.Add(-40 * time.Minute), ProviderHandle: "snap-surplus"}
	vol := &Volume{ID: volumeID, TenantID: tenantID, Name: "ret-vol", Provider: "capture", SourceLocation: "/x", RetentionMaxSnapshots: 1}

	store.mu.Lock()
	store.volumes[volumeID] = vol
	for _, s := range []*Snapshot{keep, surplus} {
		store.snapshots[s.ID] = cloneSnapshot(s)
	}
	store.mu.Unlock()

	prov := &capturingProvider{}
	svc, err := NewService(Deps{
		Store:     store,
		Runner:    memRunner{},
		System:    memRunner{},
		Providers: map[string]StorageOffloadProvider{"capture": prov},
		Metrics:   NewMetrics(nil),
		Logger:    zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	// Inbound ctx has NO tenant — mirrors the loop's retention call.
	if _, err := svc.ApplyRetention(context.Background(), volumeID); err != nil {
		t.Fatalf("ApplyRetention: %v", err)
	}

	if prov.gotDeleteTenant != tenantID.String() {
		t.Fatalf("DeleteSnapshot saw tenant %q in ctx, want the volume's tenant %q (ApplyRetention did not pin it)",
			prov.gotDeleteTenant, tenantID.String())
	}
}
