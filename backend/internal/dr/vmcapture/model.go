// Package vmcapture extends ClarioDR protected-workload coverage beyond
// databases and files to whole VMs and Kubernetes namespaces
// (DESIGN_DataStream_DR.md capability #15). It ships two real
// datastream/core.Capturer implementations that feed the EXISTING replication
// pipeline by emitting core.Frame batches the framestore / ingest / applier
// path already applies:
//
//   - VMDiskCapturer: treats a VM disk as a block device backed by an image
//     FILE and runs a real CHANGED-BLOCK-TRACKING (CBT) engine. The first pass
//     is a full base (every block); each later pass reads blocks, compares
//     content hashes against the persisted changed-block map, and emits ONLY
//     the blocks that changed. Blocks are emitted as FrameKindFileDelta frames
//     that the core FileApplier reconstructs byte-identically.
//
//   - K8sWorkloadCapturer: captures a namespace's resource set (Deployments,
//     StatefulSets, Services, ConfigMaps, Secrets, PVCs, ...) as a consistent,
//     NORMALIZED manifest snapshot (server-set fields stripped), deterministically
//     ordered by (kind, namespace, name), with a stable content hash and a
//     PVC -> data-reference linkage so PV data is captured via the block path.
//     The manifest set is emitted as FrameKindSnapshotChunk frames.
//
// The package is self-contained per the disjoint-ownership rule: it defines its
// own model types, its own DBTX store over internal/dr/repository.DBTX, its own
// chi.Router and its own background-loop trigger. It imports
// internal/datastream/core to SATISFY core.Capturer; it does not modify core.
package vmcapture

import (
	"errors"
	"time"
)

// Sentinel errors surfaced to callers and HTTP handlers.
var (
	// ErrNotFound is returned when no capture source or epoch matches a query.
	ErrNotFound = errors.New("vmcapture: not found")
	// ErrAlreadyExists is returned when a source name is reused for a tenant.
	ErrAlreadyExists = errors.New("vmcapture: already exists")
	// ErrInvalid is returned when an input is malformed.
	ErrInvalid = errors.New("vmcapture: invalid input")
	// ErrDisabled is returned when a run is requested for a disabled source.
	ErrDisabled = errors.New("vmcapture: source is disabled")
	// ErrNotConfigured is returned when a dependency required for a run (the
	// binding/source factory) is not wired.
	ErrNotConfigured = errors.New("vmcapture: dependency not configured")
)

// SourceKind selects which capturer a source uses.
const (
	// SourceKindVMDisk is a VM disk captured by block-level CBT.
	SourceKindVMDisk = "vm_disk"
	// SourceKindK8sWorkload is a K8s namespace resource set captured as a
	// normalized manifest snapshot.
	SourceKindK8sWorkload = "k8s_workload"
)

// Binding kinds: WHERE the bytes / resources come from. Exactly one real,
// tested implementation exists per source kind (file CBT and the K8s REST/
// fixture source); the production adapters are declared as additional binding
// kinds wired by the integration phase.
const (
	// BindingFile reads VM blocks from a real image file (the tested path).
	BindingFile = "file"
	// BindingVMwareCBT is the production VMware Changed-Block-Tracking adapter.
	BindingVMwareCBT = "vmware_cbt"
	// BindingLibvirt is the production libvirt/QEMU dirty-bitmap adapter.
	BindingLibvirt = "libvirt"

	// BindingREST talks to a real K8s API server over net/http (the tested
	// path uses an httptest server / in-memory fixtures behind the same
	// ResourceSource interface).
	BindingREST = "rest"
	// BindingFixture serves a fixed resource set for tests.
	BindingFixture = "fixture"
)

// Epoch kinds (mirror dr_workload_capture_epoch.epoch_kind).
const (
	// EpochBase is the first, full capture of a source.
	EpochBase = "base"
	// EpochIncremental is a delta capture carrying only changed units.
	EpochIncremental = "incremental"
)

// validSourceKinds / validVMBindings / validK8sBindings constrain inputs.
var (
	validSourceKinds = map[string]struct{}{
		SourceKindVMDisk:      {},
		SourceKindK8sWorkload: {},
	}
	validVMBindings = map[string]struct{}{
		BindingFile:      {},
		BindingVMwareCBT: {},
		BindingLibvirt:   {},
	}
	validK8sBindings = map[string]struct{}{
		BindingREST:    {},
		BindingFixture: {},
	}
)

// ValidSourceKind reports whether kind is a defined source kind.
func ValidSourceKind(kind string) bool {
	_, ok := validSourceKinds[kind]
	return ok
}

// ValidBinding reports whether binding is valid for the given source kind.
func ValidBinding(sourceKind, binding string) bool {
	switch sourceKind {
	case SourceKindVMDisk:
		_, ok := validVMBindings[binding]
		return ok
	case SourceKindK8sWorkload:
		_, ok := validK8sBindings[binding]
		return ok
	default:
		return false
	}
}

// Source is a registered capture source: a named workload bound to the
// replication stream it ships into plus its capturer config.
type Source struct {
	ID             string         `json:"id"`
	TenantID       string         `json:"tenant_id"`
	StreamID       string         `json:"stream_id"`
	Name           string         `json:"name"`
	SourceKind     string         `json:"source_kind"`
	BindingKind    string         `json:"binding_kind"`
	BlockSizeBytes int            `json:"block_size_bytes"`
	Config         map[string]any `json:"config"`
	Enabled        bool           `json:"enabled"`
	EpochCount     int            `json:"epoch_count"`
	LastRunAt      *time.Time     `json:"last_run_at,omitempty"`
	LastSeq        int64          `json:"last_seq"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

// Epoch is one capture pass of a source: the contiguous Frame Seq range it
// emitted plus the delta accounting and the deterministic content hash.
type Epoch struct {
	ID           string `json:"id"`
	TenantID     string `json:"tenant_id"`
	SourceID     string `json:"source_id"`
	StreamID     string `json:"stream_id"`
	Epoch        int    `json:"epoch"`
	EpochKind    string `json:"epoch_kind"`
	FromSeq      int64  `json:"from_seq"`
	ToSeq        int64  `json:"to_seq"`
	FrameCount   int    `json:"frame_count"`
	ChangedUnits int    `json:"changed_units"`
	TotalUnits   int    `json:"total_units"`
	PayloadBytes int64  `json:"payload_bytes"`
	ContentHash  string `json:"content_hash"`
	SourceMarker string `json:"source_marker"`
	// SetSummary is the ordered per-resource header map of a k8s_workload
	// epoch's captured set (no manifest bytes), used as the prior set for the
	// next pass's resource-level diff. Empty for vm_disk epochs.
	SetSummary []ResourceHeader `json:"set_summary,omitempty"`
	CapturedAt time.Time        `json:"captured_at"`
}

// ResourceHeader is the persisted, manifest-less identity of one captured K8s
// resource: enough to diff a later pass at resource granularity.
type ResourceHeader struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Hash      string `json:"hash"`
	DataRef   string `json:"data_ref,omitempty"`
}

// VMState is the persisted changed-block map of a VM disk source: the per-block
// content-hash bitmap of the last captured epoch plus the geometry it was
// computed against. Index i in BlockHashes covers disk bytes
// [i*BlockSizeBytes, min((i+1)*BlockSizeBytes, ImageBytes)).
type VMState struct {
	ID             string    `json:"id"`
	TenantID       string    `json:"tenant_id"`
	SourceID       string    `json:"source_id"`
	BlockSizeBytes int       `json:"block_size_bytes"`
	ImageBytes     int64     `json:"image_bytes"`
	BlockCount     int       `json:"block_count"`
	Epoch          int       `json:"epoch"`
	BlockHashes    []string  `json:"block_hashes"`
	UpdatedAt      time.Time `json:"updated_at"`
}
