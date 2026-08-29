package storageoffload

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const eventSource = "clario-dr-service/storageoffload"

// Lifecycle event types emitted on datastream.dr.events. They follow the
// com.clario360.datastream.dr.<entity>.<verb> convention used across DR.
const (
	EventTypeVolumeRegistered   = "com.clario360.datastream.dr.storageoffload.volume.registered"
	EventTypeSnapshotRequested  = "com.clario360.datastream.dr.storageoffload.snapshot.requested"
	EventTypeSnapshotReady      = "com.clario360.datastream.dr.storageoffload.snapshot.ready"
	EventTypeSnapshotReplicated = "com.clario360.datastream.dr.storageoffload.snapshot.replicated"
	EventTypeSnapshotExpired    = "com.clario360.datastream.dr.storageoffload.snapshot.expired"
	EventTypeSnapshotFailed     = "com.clario360.datastream.dr.storageoffload.snapshot.failed"
)

// drEventsTopic is the existing lifecycle topic (events.Topics.DREvents); kept
// as a literal-backed reference so this package does not edit shared files.
var drEventsTopic = events.Topics.DREvents

// TenantRunner runs read/write functions against the tenant-scoped DB so RLS
// sees app.current_tenant_id. The request path uses it. The DR service's
// pgxTenantRunner satisfies it (same uuid.UUID signature).
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// SystemRunner runs functions on the cross-tenant system path (RLS bypassed),
// as the leader-singleton loop does everywhere in dr_db. The DR service's
// PGXSystemRunner satisfies it.
type SystemRunner interface {
	RunSystemTx(ctx context.Context, fn func(repository.DBTX) error) error
	RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error
}

// catalogStore is the persistence surface the service drives (satisfied by
// *Store; an interface so the service is unit-testable without a database).
type catalogStore interface {
	CreateVolume(ctx context.Context, db repository.DBTX, v *Volume) error
	GetVolume(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID) (*Volume, error)
	GetVolumeSystem(ctx context.Context, db repository.DBTX, id uuid.UUID) (*Volume, error)
	ListVolumes(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]*Volume, error)
	CreateSnapshot(ctx context.Context, db repository.DBTX, snap *Snapshot) error
	GetSnapshot(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID) (*Snapshot, error)
	GetSnapshotSystem(ctx context.Context, db repository.DBTX, id uuid.UUID) (*Snapshot, error)
	ListSnapshotsByVolume(ctx context.Context, db repository.DBTX, tenantID, volumeID uuid.UUID) ([]*Snapshot, error)
	ListSnapshotsByVolumeSystem(ctx context.Context, db repository.DBTX, volumeID uuid.UUID) ([]*Snapshot, error)
	LatestReadySnapshot(ctx context.Context, db repository.DBTX, tenantID, volumeID uuid.UUID) (*Snapshot, error)
	ClaimActiveSnapshots(ctx context.Context, db repository.DBTX, limit int) ([]*Snapshot, error)
	MarkCreating(ctx context.Context, db repository.DBTX, id uuid.UUID, handle string) (bool, error)
	MarkReady(ctx context.Context, db repository.DBTX, id uuid.UUID, handle, manifestHash string, sizeBytes, changedBytes int64, fileCount int) (bool, error)
	MarkReplicating(ctx context.Context, db repository.DBTX, id uuid.UUID, target string) (bool, error)
	MarkReplicated(ctx context.Context, db repository.DBTX, id uuid.UUID, target string, transferred int64) (bool, error)
	MarkExpired(ctx context.Context, db repository.DBTX, id uuid.UUID) (bool, error)
	FailSnapshot(ctx context.Context, db repository.DBTX, id uuid.UUID, reason string) (bool, error)
	HasLiveChild(ctx context.Context, db repository.DBTX, id uuid.UUID) (bool, error)
}

// Deps wires the storage-offload orchestrator.
type Deps struct {
	Store     catalogStore
	Runner    TenantRunner
	System    SystemRunner
	Providers map[string]StorageOffloadProvider // by provider kind
	Metrics   *Metrics
	Logger    zerolog.Logger
	Now       func() time.Time
}

// Service is the storage-offload orchestrator. It registers volumes, requests
// snapshots from the backing provider, polls SnapshotStatus to completion and
// catalogs the result (size, manifest hash, parent linkage for incrementals),
// drives replication to a DR target, and expires snapshots by policy. Every
// state change is written transactionally with its datastream.dr.events outbox
// event so the catalog and its events commit together.
type Service struct {
	store     catalogStore
	runner    TenantRunner
	system    SystemRunner
	providers map[string]StorageOffloadProvider
	metrics   *Metrics
	logger    zerolog.Logger
	now       func() time.Time
}

// NewService constructs the orchestrator.
func NewService(d Deps) (*Service, error) {
	if d.Store == nil {
		return nil, errors.New("storageoffload service: store is required")
	}
	if d.Runner == nil {
		return nil, errors.New("storageoffload service: tenant runner is required")
	}
	if len(d.Providers) == 0 {
		return nil, errors.New("storageoffload service: at least one provider is required")
	}
	now := d.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		store:     d.Store,
		runner:    d.Runner,
		system:    d.System,
		providers: d.Providers,
		metrics:   d.Metrics,
		logger:    d.Logger.With().Str("component", "dr_storageoffload").Logger(),
		now:       now,
	}, nil
}

func (s *Service) provider(kind string) (StorageOffloadProvider, error) {
	p, ok := s.providers[kind]
	if !ok || p == nil {
		return nil, fmt.Errorf("%w: no provider registered for kind %q", ErrValidation, kind)
	}
	return p, nil
}

// RegisterVolume catalogs a new storage volume to offload and emits
// volume.registered — transactionally. The provider kind must be one this
// service was wired with.
func (s *Service) RegisterVolume(ctx context.Context, v *Volume) (*Volume, error) {
	if v.Provider == "" {
		v.Provider = ProviderFile
	}
	if _, err := s.provider(v.Provider); err != nil {
		return nil, err
	}
	if v.SourceLocation == "" {
		return nil, fmt.Errorf("%w: source_location is required", ErrValidation)
	}
	if v.RetentionMaxSnapshots < 0 || v.RetentionMaxAgeSeconds < 0 {
		return nil, fmt.Errorf("%w: retention values must be non-negative", ErrValidation)
	}
	err := s.runner.RunWithTenant(ctx, v.TenantID, func(db repository.DBTX) error {
		if cerr := s.store.CreateVolume(ctx, db, v); cerr != nil {
			return cerr
		}
		return s.emit(ctx, db, EventTypeVolumeRegistered, v.TenantID, map[string]any{
			"volume_id": v.ID.String(),
			"name":      v.Name,
			"provider":  v.Provider,
		})
	})
	if err != nil {
		return nil, err
	}
	s.logger.Info().Str("volume_id", v.ID.String()).Str("provider", v.Provider).Msg("storage volume registered")
	return v, nil
}

// GetVolume loads a volume within the tenant.
func (s *Service) GetVolume(ctx context.Context, tenantID, id uuid.UUID) (*Volume, error) {
	var v *Volume
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var gerr error
		v, gerr = s.store.GetVolume(ctx, db, tenantID, id)
		return gerr
	})
	return v, err
}

// ListVolumes returns the tenant's volumes.
func (s *Service) ListVolumes(ctx context.Context, tenantID uuid.UUID) ([]*Volume, error) {
	var out []*Volume
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var lerr error
		out, lerr = s.store.ListVolumes(ctx, db, tenantID)
		return lerr
	})
	return out, err
}

// RequestSnapshot records the intent to offload a snapshot of a volume. It picks
// full-vs-incremental automatically: if the volume already has a materialized
// snapshot it links the new one to it as an incremental parent; otherwise it is a
// full base. The PENDING row + snapshot.requested event commit together; the
// provider work (and READY transition) happen on the background loop (or
// DriveSnapshot in tests), so the request never blocks on a long array copy.
func (s *Service) RequestSnapshot(ctx context.Context, tenantID, volumeID uuid.UUID) (*Snapshot, error) {
	var snap *Snapshot
	err := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		vol, gerr := s.store.GetVolume(ctx, db, tenantID, volumeID)
		if gerr != nil {
			return gerr
		}
		kind := SnapshotKindFull
		var parentID *uuid.UUID
		parent, perr := s.store.LatestReadySnapshot(ctx, db, tenantID, volumeID)
		switch {
		case perr == nil:
			kind = SnapshotKindIncremental
			pid := parent.ID
			parentID = &pid
		case errors.Is(perr, ErrNotFound):
			// no prior snapshot: full base
		default:
			return perr
		}
		snap = &Snapshot{
			TenantID: tenantID,
			VolumeID: volumeID,
			ParentID: parentID,
			Kind:     kind,
			State:    StatePending,
		}
		if cerr := s.store.CreateSnapshot(ctx, db, snap); cerr != nil {
			return cerr
		}
		return s.emit(ctx, db, EventTypeSnapshotRequested, tenantID, map[string]any{
			"volume_id":   volumeID.String(),
			"snapshot_id": snap.ID.String(),
			"kind":        kind,
			"provider":    vol.Provider,
		})
	})
	if err != nil {
		return nil, err
	}
	s.metrics.IncRequested(snap.Kind)
	s.logger.Info().Str("snapshot_id", snap.ID.String()).Str("kind", snap.Kind).
		Str("volume_id", volumeID.String()).Msg("storage offload snapshot requested")
	return snap, nil
}

// GetSnapshot loads a snapshot within the tenant.
func (s *Service) GetSnapshot(ctx context.Context, tenantID, id uuid.UUID) (*Snapshot, error) {
	var snap *Snapshot
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var gerr error
		snap, gerr = s.store.GetSnapshot(ctx, db, tenantID, id)
		return gerr
	})
	return snap, err
}

// ListSnapshots returns a volume's snapshots within the tenant.
func (s *Service) ListSnapshots(ctx context.Context, tenantID, volumeID uuid.UUID) ([]*Snapshot, error) {
	var out []*Snapshot
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var lerr error
		out, lerr = s.store.ListSnapshotsByVolume(ctx, db, tenantID, volumeID)
		return lerr
	})
	return out, err
}

// RequestReplication moves a READY snapshot to REPLICATING so the loop ships it
// to toTarget. It returns the updated snapshot. Replicating a snapshot not in
// READY returns ErrInvalidState. The actual byte transfer happens on the loop
// (or DriveSnapshot in tests). The chosen target is persisted atomically with the
// READY -> REPLICATING transition so any loop node can resume it.
func (s *Service) RequestReplication(ctx context.Context, tenantID, snapshotID uuid.UUID, toTarget string) (*Snapshot, error) {
	if toTarget == "" {
		return nil, fmt.Errorf("%w: replication target is required", ErrValidation)
	}
	var snap *Snapshot
	err := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		current, gerr := s.store.GetSnapshot(ctx, db, tenantID, snapshotID)
		if gerr != nil {
			return gerr
		}
		if current.State == StateReplicating || current.State == StateReplicated {
			snap = current // idempotent
			return nil
		}
		if current.State != StateReady {
			return fmt.Errorf("snapshot %s is %s: %w", snapshotID, current.State, ErrInvalidState)
		}
		ok, terr := s.store.MarkReplicating(ctx, db, snapshotID, toTarget)
		if terr != nil {
			return terr
		}
		if !ok {
			snap, gerr = s.store.GetSnapshot(ctx, db, tenantID, snapshotID)
			return gerr
		}
		current.State = StateReplicating
		current.ReplicatedTarget = &toTarget
		snap = current
		return nil
	})
	if err != nil {
		return nil, err
	}
	if snap.State == StateReplicating {
		snap.ReplicatedTarget = &toTarget
	}
	return snap, nil
}

// DriveSnapshot advances a single snapshot one step on the system path, the unit
// of work the background loop performs. It is exported so tests drive it
// deterministically against real providers/stores without a running loop:
//
//   - PENDING/CREATING -> ask the provider to create (if needed) and poll
//     SnapshotStatus to completion, then catalog READY (size, hash, delta).
//   - REPLICATING        -> ship the snapshot to its recorded target and catalog
//     REPLICATED with the bytes transferred.
//
// A failure marks the snapshot FAILED and is returned; the loop isolates it.
func (s *Service) DriveSnapshot(ctx context.Context, snap *Snapshot) error {
	// The background offload loop claims snapshots ACROSS tenants on the system
	// (RLS-bypass) path, so the inbound ctx carries no tenant. Pin THIS snapshot's
	// own tenant into the ctx before any provider I/O so a resolver-backed provider
	// (one that builds its array client from the tenant's registered integration)
	// resolves the CORRECT tenant's credentials. Without this, a multi-tenant /
	// multi-array deployment would drive whichever tenant was resolved last. The
	// DB writes below set their tenant explicitly via the runner, so this only
	// affects credential resolution — it is additive and safe on the request path
	// too (where ctx already carries the same tenant).
	ctx = auth.WithTenantID(ctx, snap.TenantID.String())
	switch snap.State {
	case StatePending, StateCreating:
		return s.driveCreate(ctx, snap)
	case StateReplicating:
		return s.driveReplicate(ctx, snap)
	default:
		return nil
	}
}

// driveCreate resolves the volume and provider, requests the snapshot if it has
// no handle yet, polls SnapshotStatus to completion, then catalogs READY with the
// manifest-derived size/hash/delta. All real provider I/O happens here; only the
// catalog transitions are transactional with their events.
func (s *Service) driveCreate(ctx context.Context, snap *Snapshot) error {
	vol, err := s.systemVolume(ctx, snap.VolumeID)
	if err != nil {
		return s.failSnapshot(ctx, snap, err)
	}
	provider, err := s.provider(vol.Provider)
	if err != nil {
		return s.failSnapshot(ctx, snap, err)
	}

	req, parentManifest, err := s.buildRequest(ctx, vol, snap, provider)
	if err != nil {
		return s.failSnapshot(ctx, snap, err)
	}
	req.ParentManifest = parentManifest

	handle := snap.ProviderHandle
	if handle == "" {
		info, cerr := provider.CreateSnapshot(ctx, req)
		if cerr != nil {
			return s.failSnapshot(ctx, snap, fmt.Errorf("creating snapshot on provider: %w", cerr))
		}
		handle = info.Handle
		if err := s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
			_, merr := s.store.MarkCreating(ctx, db, snap.ID, handle)
			return merr
		}); err != nil {
			return err
		}
		snap.ProviderHandle = handle
		// If the provider completed synchronously, catalog READY immediately.
		if info.State == ProviderSnapshotReady && info.Manifest != nil {
			return s.catalogReady(ctx, snap, info)
		}
	}

	// Poll to completion.
	info, serr := provider.SnapshotStatus(ctx, req, handle)
	if serr != nil {
		return s.failSnapshot(ctx, snap, fmt.Errorf("polling snapshot status: %w", serr))
	}
	switch info.State {
	case ProviderSnapshotReady:
		if info.Manifest == nil {
			return s.failSnapshot(ctx, snap, errors.New("provider reported ready with no manifest"))
		}
		return s.catalogReady(ctx, snap, info)
	case ProviderSnapshotCreating:
		s.logger.Debug().Str("snapshot_id", snap.ID.String()).Msg("snapshot still creating; will re-poll")
		return nil
	case ProviderSnapshotMissing:
		return s.failSnapshot(ctx, snap, errors.New("provider snapshot vanished before completion"))
	default:
		return s.failSnapshot(ctx, snap, errors.New("provider reported snapshot error"))
	}
}

// buildRequest assembles the provider request for a snapshot, resolving the
// parent handle + manifest for an incremental. The parent manifest is read back
// from the provider so the incremental delta is computed against real content.
func (s *Service) buildRequest(ctx context.Context, vol *Volume, snap *Snapshot, provider StorageOffloadProvider) (SnapshotRequest, *Manifest, error) {
	req := SnapshotRequest{
		VolumeName:     vol.Name,
		SourceLocation: vol.SourceLocation,
		ArrayEndpoint:  vol.ArrayEndpoint,
	}
	if snap.ParentID == nil {
		return req, nil, nil
	}
	var parent *Snapshot
	if err := s.system.RunSystemRead(ctx, func(db repository.DBTX) error {
		var gerr error
		parent, gerr = s.store.GetSnapshotSystem(ctx, db, *snap.ParentID)
		return gerr
	}); err != nil {
		return req, nil, fmt.Errorf("loading parent snapshot %s: %w", *snap.ParentID, err)
	}
	req.ParentHandle = parent.ProviderHandle
	info, err := provider.SnapshotStatus(ctx, req, parent.ProviderHandle)
	if err != nil {
		return req, nil, fmt.Errorf("reading parent snapshot manifest: %w", err)
	}
	return req, info.Manifest, nil
}

// catalogReady transitions a snapshot to READY transactionally with the
// snapshot.ready event, recording the manifest-derived accounting.
func (s *Service) catalogReady(ctx context.Context, snap *Snapshot, info SnapshotInfo) error {
	manifestHash := HashManifest(info.Manifest)
	sizeBytes := info.Manifest.TotalSize()
	changed := info.ChangedBytes
	fileCount := len(info.Manifest.Entries)

	err := s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
		ok, merr := s.store.MarkReady(ctx, db, snap.ID, info.Handle, manifestHash, sizeBytes, changed, fileCount)
		if merr != nil {
			return merr
		}
		if !ok {
			return nil // re-claim raced; already ready
		}
		return s.emit(ctx, db, EventTypeSnapshotReady, snap.TenantID, map[string]any{
			"snapshot_id":   snap.ID.String(),
			"volume_id":     snap.VolumeID.String(),
			"manifest_hash": manifestHash,
			"size_bytes":    sizeBytes,
			"changed_bytes": changed,
			"file_count":    fileCount,
			"kind":          snap.Kind,
		})
	})
	if err != nil {
		return err
	}
	s.metrics.IncReady(changed)
	s.metrics.ObserveCreate(s.now().Sub(snap.CreatedAt).Seconds())
	s.logger.Info().Str("snapshot_id", snap.ID.String()).Int64("size_bytes", sizeBytes).
		Int64("changed_bytes", changed).Int("files", fileCount).Msg("storage offload snapshot ready")
	snap.State = StateReady
	return nil
}

// driveReplicate ships a REPLICATING snapshot to its recorded target and catalogs
// REPLICATED. For an incremental it passes the parent's replicated target as the
// base so only the delta is transferred.
func (s *Service) driveReplicate(ctx context.Context, snap *Snapshot) error {
	if snap.ReplicatedTarget == nil || *snap.ReplicatedTarget == "" {
		return s.failSnapshot(ctx, snap, errors.New("replicating snapshot has no target set"))
	}
	target := *snap.ReplicatedTarget
	vol, err := s.systemVolume(ctx, snap.VolumeID)
	if err != nil {
		return s.failSnapshot(ctx, snap, err)
	}
	provider, err := s.provider(vol.Provider)
	if err != nil {
		return s.failSnapshot(ctx, snap, err)
	}

	req, parentManifest, err := s.buildRequest(ctx, vol, snap, provider)
	if err != nil {
		return s.failSnapshot(ctx, snap, err)
	}
	req.ParentManifest = parentManifest

	baseTarget := ""
	if snap.ParentID != nil {
		var parent *Snapshot
		if perr := s.system.RunSystemRead(ctx, func(db repository.DBTX) error {
			var gerr error
			parent, gerr = s.store.GetSnapshotSystem(ctx, db, *snap.ParentID)
			return gerr
		}); perr == nil && parent.ReplicatedTarget != nil {
			baseTarget = *parent.ReplicatedTarget
		}
	}

	transferred, rerr := provider.ReplicateSnapshot(ctx, req, snap.ProviderHandle, target, baseTarget)
	if rerr != nil {
		return s.failSnapshot(ctx, snap, fmt.Errorf("replicating snapshot: %w", rerr))
	}

	err = s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
		ok, merr := s.store.MarkReplicated(ctx, db, snap.ID, target, transferred)
		if merr != nil {
			return merr
		}
		if !ok {
			return nil
		}
		return s.emit(ctx, db, EventTypeSnapshotReplicated, snap.TenantID, map[string]any{
			"snapshot_id":       snap.ID.String(),
			"volume_id":         snap.VolumeID.String(),
			"target":            target,
			"bytes_transferred": transferred,
			"kind":              snap.Kind,
		})
	})
	if err != nil {
		return err
	}
	s.metrics.IncReplicated(transferred)
	s.metrics.ObserveReplicate(s.now().Sub(snap.CreatedAt).Seconds())
	s.logger.Info().Str("snapshot_id", snap.ID.String()).Str("target", target).
		Int64("bytes_transferred", transferred).Msg("storage offload snapshot replicated")
	snap.State = StateReplicated
	return nil
}

// ApplyRetention expires snapshots of a volume that exceed the retention policy
// (too many, or too old), but NEVER expires a snapshot still referenced as the
// live parent of an incremental child — that would corrupt the chain. It runs on
// the system path and deletes the provider-side bytes before cataloging EXPIRED.
// Returns the number expired. Idempotent: terminal snapshots are skipped.
func (s *Service) ApplyRetention(ctx context.Context, volumeID uuid.UUID) (int, error) {
	var (
		vol       *Volume
		snapshots []*Snapshot
	)
	if err := s.system.RunSystemRead(ctx, func(db repository.DBTX) error {
		var gerr error
		vol, gerr = s.store.GetVolumeSystem(ctx, db, volumeID)
		if gerr != nil {
			return gerr
		}
		snapshots, gerr = s.store.ListSnapshotsByVolumeSystem(ctx, db, volumeID)
		return gerr
	}); err != nil {
		return 0, err
	}

	// Retention runs on the system (RLS-bypass) path, so ctx carries no tenant.
	// Pin the volume's tenant before any provider I/O (the DeleteSnapshot below)
	// so a resolver-backed provider builds THIS tenant's array client — same fix
	// as DriveSnapshot. Without it, retention deletes against an integration-backed
	// array would fail closed for lack of a tenant. The system runner sets its own
	// RLS bypass explicitly, so this only affects credential resolution.
	ctx = auth.WithTenantID(ctx, vol.TenantID.String())

	policy := vol.Policy()
	candidates := s.retentionCandidates(snapshots, policy)
	if len(candidates) == 0 {
		return 0, nil
	}
	provider, err := s.provider(vol.Provider)
	if err != nil {
		return 0, err
	}
	req := SnapshotRequest{VolumeName: vol.Name, SourceLocation: vol.SourceLocation, ArrayEndpoint: vol.ArrayEndpoint}

	expired := 0
	for _, snap := range candidates {
		if err := ctx.Err(); err != nil {
			return expired, err
		}
		// Re-check live-child under the deletion transaction so a child created
		// after the read is still respected.
		var hasChild bool
		if cerr := s.system.RunSystemRead(ctx, func(db repository.DBTX) error {
			var herr error
			hasChild, herr = s.store.HasLiveChild(ctx, db, snap.ID)
			return herr
		}); cerr != nil {
			return expired, cerr
		}
		if hasChild {
			continue // referenced parent: keep
		}
		if snap.ProviderHandle != "" {
			if derr := provider.DeleteSnapshot(ctx, req, snap.ProviderHandle); derr != nil {
				s.logger.Warn().Err(derr).Str("snapshot_id", snap.ID.String()).Msg("provider delete during retention failed; keeping catalog row")
				continue
			}
		}
		if werr := s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
			ok, merr := s.store.MarkExpired(ctx, db, snap.ID)
			if merr != nil {
				return merr
			}
			if !ok {
				return nil
			}
			expired++
			return s.emit(ctx, db, EventTypeSnapshotExpired, snap.TenantID, map[string]any{
				"snapshot_id": snap.ID.String(),
				"volume_id":   snap.VolumeID.String(),
			})
		}); werr != nil {
			return expired, werr
		}
	}
	s.metrics.IncExpired(expired)
	if expired > 0 {
		s.logger.Info().Str("volume_id", volumeID.String()).Int("expired", expired).Msg("storage offload retention expired snapshots")
	}
	return expired, nil
}

// retentionCandidates selects the snapshots eligible for expiry under policy from
// the live (non-terminal) set, NEWEST FIRST as input. A snapshot is a candidate
// when it is older than MaxAge, OR it is beyond the newest MaxSnapshots. This is
// pure domain logic (no I/O) and is unit-tested directly.
func (s *Service) retentionCandidates(snapshots []*Snapshot, policy RetentionPolicy) []*Snapshot {
	live := make([]*Snapshot, 0, len(snapshots))
	for _, snap := range snapshots {
		if IsTerminal(snap.State) {
			continue
		}
		live = append(live, snap)
	}
	sort.Slice(live, func(i, j int) bool { return live[i].CreatedAt.After(live[j].CreatedAt) })

	now := s.now()
	seen := make(map[uuid.UUID]bool)
	var candidates []*Snapshot
	for idx, snap := range live {
		expire := false
		if policy.MaxSnapshots > 0 && idx >= policy.MaxSnapshots {
			expire = true
		}
		if policy.MaxAge > 0 && now.Sub(snap.CreatedAt) > policy.MaxAge {
			expire = true
		}
		if expire && !seen[snap.ID] {
			seen[snap.ID] = true
			candidates = append(candidates, snap)
		}
	}
	return candidates
}

// systemVolume loads a snapshot's volume on the system path.
func (s *Service) systemVolume(ctx context.Context, volumeID uuid.UUID) (*Volume, error) {
	var vol *Volume
	err := s.system.RunSystemRead(ctx, func(db repository.DBTX) error {
		var gerr error
		vol, gerr = s.store.GetVolumeSystem(ctx, db, volumeID)
		return gerr
	})
	if err != nil {
		return nil, fmt.Errorf("loading volume %s: %w", volumeID, err)
	}
	return vol, nil
}

// failSnapshot moves a snapshot to FAILED on the system path, transactionally
// with the snapshot.failed event, and returns the original cause for the caller.
func (s *Service) failSnapshot(ctx context.Context, snap *Snapshot, cause error) error {
	reason := cause.Error()
	werr := s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
		ok, ferr := s.store.FailSnapshot(ctx, db, snap.ID, reason)
		if ferr != nil {
			return ferr
		}
		if !ok {
			return nil
		}
		return s.emit(ctx, db, EventTypeSnapshotFailed, snap.TenantID, map[string]any{
			"snapshot_id": snap.ID.String(),
			"volume_id":   snap.VolumeID.String(),
			"error":       reason,
		})
	})
	if werr != nil {
		s.logger.Error().Err(werr).Str("snapshot_id", snap.ID.String()).Msg("failed to record snapshot failure")
		return cause
	}
	s.metrics.IncFailed()
	s.logger.Warn().Err(cause).Str("snapshot_id", snap.ID.String()).Msg("storage offload snapshot FAILED")
	return cause
}

// emit stages a lifecycle event to the DR events outbox within the caller's
// transaction so catalog state + event commit atomically.
func (s *Service) emit(ctx context.Context, db repository.DBTX, eventType string, tenantID uuid.UUID, data map[string]any) error {
	if _, ok := data["tenant_id"]; !ok {
		data["tenant_id"] = tenantID.String()
	}
	evt, err := events.NewEvent(eventType, eventSource, tenantID.String(), data)
	if err != nil {
		return fmt.Errorf("storageoffload: building %s event: %w", eventType, err)
	}
	if err := outbox.Write(ctx, db, drEventsTopic, evt); err != nil {
		return fmt.Errorf("storageoffload: staging %s event: %w", eventType, err)
	}
	return nil
}
