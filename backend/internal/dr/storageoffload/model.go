// Package storageoffload implements ClarioDR capability #17 — SAN/NAS STORAGE
// OFFLOAD.
//
// For large estates, copying every byte through the ClarioDR host is wasteful:
// a storage array can snapshot and replicate far more efficiently than a
// host-based copy. This package lets ClarioDR ORCHESTRATE and CATALOG
// array-assisted snapshots + replication rather than copy through the host —
// the array (or, in the bundled real implementation, the local filesystem) does
// the heavy lifting and ClarioDR records the lineage, drives replication to a DR
// target, and expires snapshots by policy.
//
// The real heavy lifting lives behind one narrow interface, StorageOffloadProvider
// (provider.go), with a fully-real concrete implementation — FileProvider
// (file_provider.go) — that performs copy-on-write-style snapshots of an on-disk
// volume using content hashing + hard links for unchanged files and real
// incremental replication by manifest diff. Named array provider kinds sit
// behind the same interface only when a deployment supplies a concrete vendor
// adapter or API gateway.
//
// The package owns its own model, store (over repository.DBTX, two tables in
// migrations/dr_db/000026), Prometheus metrics, HTTP router, orchestrator
// Service, and background poll/retention loop. Per the disjoint-ownership rule
// it edits no shared DR files; it emits lifecycle events on the existing
// datastream.dr.events topic through the outbox.
package storageoffload

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Sentinel errors mapped to HTTP statuses by the router layer.
var (
	// ErrNotFound is returned when a volume or snapshot does not exist for the
	// tenant.
	ErrNotFound = errors.New("storageoffload: not found")
	// ErrAlreadyExists is returned when a volume name is already registered for
	// the tenant.
	ErrAlreadyExists = errors.New("storageoffload: already exists")
	// ErrInvalidState is returned when an operation is requested on a snapshot
	// in a state that does not permit it (e.g. replicating a not-yet-ready
	// snapshot, or deleting a snapshot that is still a live parent).
	ErrInvalidState = errors.New("storageoffload: invalid snapshot state")
	// ErrValidation marks a caller-correctable request problem.
	ErrValidation = errors.New("storageoffload: validation error")
)

// Provider kinds. file is the bundled, fully-real local copy-on-write provider.
// The other names are catalog values for deployments that wire concrete
// vendor-specific adapters or an array API gateway into the provider map.
const (
	ProviderFile           = "file"
	ProviderNetAppONTAP    = "netapp_ontap"
	ProviderDellPowerStore = "dell_powerstore"
	ProviderNFS            = "nfs"
)

// Snapshot kinds. A full snapshot captures every block/file; an incremental
// snapshot is diffed against a parent and copies only changed/new content.
const (
	SnapshotKindFull        = "full"
	SnapshotKindIncremental = "incremental"
)

// Snapshot orchestration states. The orchestrator requests a snapshot (PENDING),
// the provider begins it (CREATING), it completes (READY), the orchestrator may
// then replicate it (REPLICATING -> REPLICATED), and retention eventually
// expires it (EXPIRED). FAILED is reachable from any non-terminal state.
const (
	StatePending     = "PENDING"
	StateCreating    = "CREATING"
	StateReady       = "READY"
	StateReplicating = "REPLICATING"
	StateReplicated  = "REPLICATED"
	StateExpired     = "EXPIRED"
	StateFailed      = "FAILED"
)

// IsTerminal reports whether a snapshot state allows no further orchestration.
func IsTerminal(state string) bool {
	return state == StateExpired || state == StateFailed
}

// ActiveSnapshotStates are the non-terminal states the background loop polls and
// drives forward.
func ActiveSnapshotStates() []string {
	return []string{StatePending, StateCreating, StateReplicating}
}

// Volume is a registered SAN block / NAS file volume to offload snapshots from.
// For the file provider SourceLocation is the on-disk volume directory and
// ArrayEndpoint is the snapshot root.
type Volume struct {
	ID                     uuid.UUID  `json:"id"`
	TenantID               uuid.UUID  `json:"tenant_id"`
	Name                   string     `json:"name"`
	Provider               string     `json:"provider"`
	ArrayEndpoint          string     `json:"array_endpoint"`
	SourceLocation         string     `json:"source_location"`
	SiteID                 *uuid.UUID `json:"site_id,omitempty"`
	RetentionMaxSnapshots  int        `json:"retention_max_snapshots"`
	RetentionMaxAgeSeconds int64      `json:"retention_max_age_seconds"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

// RetentionPolicy is the volume's retention configuration in a self-contained
// value the orchestrator can reason about. MaxSnapshots == 0 means unlimited
// count; MaxAge == 0 means no age limit.
type RetentionPolicy struct {
	MaxSnapshots int
	MaxAge       time.Duration
}

// Policy returns the volume's retention policy.
func (v *Volume) Policy() RetentionPolicy {
	return RetentionPolicy{
		MaxSnapshots: v.RetentionMaxSnapshots,
		MaxAge:       time.Duration(v.RetentionMaxAgeSeconds) * time.Second,
	}
}

// Snapshot is one offloaded snapshot of a volume, catalogued in dr_storage_snapshot.
type Snapshot struct {
	ID               uuid.UUID  `json:"id"`
	TenantID         uuid.UUID  `json:"tenant_id"`
	VolumeID         uuid.UUID  `json:"volume_id"`
	ParentID         *uuid.UUID `json:"parent_id,omitempty"`
	ProviderHandle   string     `json:"provider_handle"`
	Kind             string     `json:"kind"`
	State            string     `json:"state"`
	ManifestHash     string     `json:"manifest_hash"`
	SizeBytes        int64      `json:"size_bytes"`
	ChangedBytes     int64      `json:"changed_bytes"`
	FileCount        int        `json:"file_count"`
	ReplicatedTarget *string    `json:"replicated_target,omitempty"`
	LastError        *string    `json:"last_error,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	ReadyAt          *time.Time `json:"ready_at,omitempty"`
	ReplicatedAt     *time.Time `json:"replicated_at,omitempty"`
	ExpiredAt        *time.Time `json:"expired_at,omitempty"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// ManifestEntry describes one file captured in a snapshot: its path relative to
// the volume root, its size, its content hash, and its mode bits. The content
// hash is what makes incremental diffing real — an unchanged file has the same
// (path, hash) across snapshots and need not be re-copied during replication.
type ManifestEntry struct {
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	Hash    string `json:"hash"`
	Mode    uint32 `json:"mode"`
	ModTime int64  `json:"mod_time_unix"`
}

// Manifest is the content-addressed catalogue of a snapshot: the ordered set of
// files with their hashes. It is the provider's authoritative description of what
// the snapshot contains and is the basis for both tamper-evidence (ManifestHash)
// and incremental diffing (DiffManifests).
type Manifest struct {
	Volume    string          `json:"volume"`
	CreatedAt time.Time       `json:"created_at"`
	ParentID  string          `json:"parent_id,omitempty"`
	Entries   []ManifestEntry `json:"entries"`
}

// TotalSize sums the logical size of every entry in the manifest.
func (m *Manifest) TotalSize() int64 {
	var total int64
	for i := range m.Entries {
		total += m.Entries[i].Size
	}
	return total
}

// ManifestDiff is the result of comparing a child manifest against its parent:
// the entries that are new or changed (must be copied during incremental
// replication), the paths that were deleted, and the unchanged entries (which an
// incremental skips). Bytes is the sum of the sizes of the changed/new entries —
// the real "blocks copied" accounting for an incremental.
type ManifestDiff struct {
	Changed   []ManifestEntry
	Unchanged []ManifestEntry
	Deleted   []string
	Bytes     int64
}

// DiffManifests computes the change set of child relative to parent by content
// hash, the core incremental-snapshot delta algorithm. An entry is unchanged iff
// the parent has the same path with an identical hash; otherwise it is changed
// (new path, or same path with a different hash). A parent path absent from child
// is deleted. This is real domain logic with no I/O and is unit-tested directly.
func DiffManifests(parent, child *Manifest) ManifestDiff {
	parentByPath := make(map[string]ManifestEntry, len(parent.Entries))
	for _, e := range parent.Entries {
		parentByPath[e.Path] = e
	}
	childPaths := make(map[string]struct{}, len(child.Entries))

	var diff ManifestDiff
	for _, e := range child.Entries {
		childPaths[e.Path] = struct{}{}
		prev, ok := parentByPath[e.Path]
		if ok && prev.Hash == e.Hash {
			diff.Unchanged = append(diff.Unchanged, e)
			continue
		}
		diff.Changed = append(diff.Changed, e)
		diff.Bytes += e.Size
	}
	for _, e := range parent.Entries {
		if _, ok := childPaths[e.Path]; !ok {
			diff.Deleted = append(diff.Deleted, e.Path)
		}
	}
	return diff
}
