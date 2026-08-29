package storageoffload

import (
	"context"
	"errors"
)

// SnapshotState is the provider-reported state of an array snapshot, distinct
// from the catalog state in model.go. A provider only knows about the snapshot's
// own lifecycle (creating -> ready -> error); the orchestrator maps it onto the
// richer catalog state machine (which also covers replication and retention).
type SnapshotState string

const (
	// ProviderSnapshotCreating means the array is still quiescing/copying.
	ProviderSnapshotCreating SnapshotState = "creating"
	// ProviderSnapshotReady means the snapshot is complete and consistent.
	ProviderSnapshotReady SnapshotState = "ready"
	// ProviderSnapshotError means the array reported a failure.
	ProviderSnapshotError SnapshotState = "error"
	// ProviderSnapshotMissing means no such snapshot handle exists on the array.
	ProviderSnapshotMissing SnapshotState = "missing"
)

// SnapshotRequest asks a provider to take a snapshot of a source volume. When
// ParentHandle is non-empty the provider is asked for an INCREMENTAL snapshot
// diffed against that parent (copy only changed content); an empty ParentHandle
// requests a full base snapshot.
type SnapshotRequest struct {
	// VolumeName is the operator-facing volume name (for handle derivation/logs).
	VolumeName string
	// SourceLocation is the LUN / export / on-disk volume path to snapshot.
	SourceLocation string
	// ArrayEndpoint is the array management endpoint / snapshot root.
	ArrayEndpoint string
	// ParentHandle, when set, is the provider handle of the snapshot to diff
	// against for an incremental.
	ParentHandle string
	// ParentManifest, when set, is the parent snapshot's manifest, supplied so a
	// provider can compute the incremental delta without re-reading the parent.
	ParentManifest *Manifest
}

// SnapshotInfo is what a provider returns once it has accepted (or completed) a
// snapshot request: the array-side handle plus the manifest describing the
// captured content. Size/ChangedBytes/FileCount/ManifestHash are derived by the
// orchestrator from the manifest, so a provider need only return Handle +
// Manifest + the current State.
type SnapshotInfo struct {
	// Handle is the array-side snapshot identifier (for the file provider, the
	// on-disk snapshot directory relative to the snapshot root).
	Handle string
	// Manifest describes the captured files; nil until the snapshot is ready.
	Manifest *Manifest
	// State is the provider's current view of the snapshot.
	State SnapshotState
	// ChangedBytes is the bytes the provider actually copied (for an incremental,
	// the delta; for a full, the total). The orchestrator records it for delta
	// accounting and may also recompute it from the manifest diff.
	ChangedBytes int64
}

// StorageOffloadProvider is the narrow boundary to a storage array (or, for the
// bundled real implementation, the local filesystem). It is deliberately small
// so deployment-specific array adapters can implement the same five operations
// the orchestrator drives:
//
//   - CreateSnapshot   ask the array to take a (full or incremental) snapshot
//   - SnapshotStatus   poll the array for a snapshot's state + manifest
//   - ListSnapshots    enumerate the array's snapshots of a volume
//   - ReplicateSnapshot ship a snapshot to a DR target (array-to-array / array-to-file)
//   - DeleteSnapshot   remove a snapshot from the array (retention/expiry)
//
// The orchestrator (service.go) catalogs everything in Postgres; the provider
// owns only the array-side bytes. FileProvider is fully real and exercised by
// tests with real filesystem I/O; named array providers require a concrete
// adapter/client to be registered by the deployment.
type StorageOffloadProvider interface {
	// Name returns the provider kind (one of the Provider* constants).
	Name() string

	// CreateSnapshot asks the backing store to take a snapshot. It returns the
	// handle immediately; the snapshot may still be creating (poll SnapshotStatus
	// to completion). A real implementation does the array-side copy-on-write.
	CreateSnapshot(ctx context.Context, req SnapshotRequest) (SnapshotInfo, error)

	// SnapshotStatus polls the current state (and, once ready, the manifest) of a
	// snapshot by handle. The orchestrator calls it from the background loop until
	// the snapshot is ready.
	SnapshotStatus(ctx context.Context, req SnapshotRequest, handle string) (SnapshotInfo, error)

	// ListSnapshots enumerates the handles of snapshots the backing store holds
	// for a volume, newest first where the store can order them.
	ListSnapshots(ctx context.Context, req SnapshotRequest) ([]string, error)

	// ReplicateSnapshot ships the snapshot identified by handle to toTarget. When
	// the snapshot is incremental the implementation should copy only the changed
	// content (by manifest diff) on top of a previously-replicated parent at the
	// target; baseTarget names that prior replicated location (empty for a full).
	// It returns the bytes transferred.
	ReplicateSnapshot(ctx context.Context, req SnapshotRequest, handle, toTarget, baseTarget string) (int64, error)

	// DeleteSnapshot removes the snapshot identified by handle from the backing
	// store. It must be idempotent: deleting an absent handle is a no-op.
	DeleteSnapshot(ctx context.Context, req SnapshotRequest, handle string) error
}

// ErrProviderUnavailable is returned by an array adapter that has been declared
// but whose backing client is not wired in this deployment, so the orchestrator
// surfaces a clear "configure the array client" error instead of a nil-pointer
// panic.
var ErrProviderUnavailable = errors.New("storageoffload: provider backing client not configured")
