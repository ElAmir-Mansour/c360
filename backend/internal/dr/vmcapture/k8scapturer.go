package vmcapture

import (
	"context"
	"fmt"
	"sync"

	"github.com/clario360/platform/internal/datastream/core"
)

// K8sStateStore loads the prior captured manifest set (for the diff) and
// persists a new capture epoch. The service layer supplies a DB-backed
// implementation; tests supply an in-memory one. The prior set is stored as the
// per-resource (key, hash) map so the capturer can compute the changed set
// without re-shipping unchanged manifests on an incremental pass.
type K8sStateStore interface {
	// LoadK8sState returns the prior manifest set summary for sourceID (the
	// ordered NormalizedResource headers — Kind/Namespace/Name/Hash/DataRef,
	// without Manifest bytes) and the prior epoch number (0 when none).
	LoadK8sState(ctx context.Context, sourceID string) (prior *K8sManifestSet, epoch int, err error)
	// SaveK8sEpoch persists the new manifest-set summary and records the epoch.
	SaveK8sEpoch(ctx context.Context, in SaveK8sEpochInput) (Epoch, error)
}

// SaveK8sEpochInput carries everything one completed K8s capture pass persists.
type SaveK8sEpochInput struct {
	TenantID     string
	SourceID     string
	StreamID     string
	Epoch        int
	EpochKind    string
	FromSeq      int64
	ToSeq        int64
	FrameCount   int
	ChangedUnits int
	TotalUnits   int
	PayloadBytes int64
	ContentHash  string
	SourceMarker string
	// Set is the full normalized set captured this pass; the store keeps its
	// per-resource (key, hash, data_ref) summary as the next pass's prior.
	Set *K8sManifestSet
}

// DataRefFunc derives the block-path data reference for a PVC, so the PVC's
// volume DATA is replicated via the VM/file block path while its MANIFEST is
// captured here. The default derives a deterministic stream-scoped reference;
// the integration phase may supply one that points at a real provisioned block
// stream.
type DataRefFunc func(namespace, name string) string

// K8sWorkloadCapturer is a real core.Capturer: each Start lists the workload's
// resources through its ResourceSource, normalizes and orders them, diffs
// against the prior captured set, ships the manifest set as
// FrameKindSnapshotChunk frames (closed by a MARKER), then persists the epoch.
// The first pass is the BASE; later passes report the changed-resource count.
//
// On an incremental pass the FULL set is still shipped as frames (a manifest
// snapshot is a consistent whole-set recovery point — partial manifest streams
// cannot be safely reconstructed mid-apply), but the epoch's ChangedUnits
// records exactly how many resources differed, which is the K8s analogue of the
// VM changed-block count and what proves a no-change pass.
type K8sWorkloadCapturer struct {
	tenantID  string
	sourceID  string
	streamID  string
	source    ResourceSource
	state     K8sStateStore
	dataRefFn DataRefFunc

	mu        sync.Mutex
	closed    bool
	lastEpoch *Epoch
}

// K8sWorkloadConfig wires a K8sWorkloadCapturer.
type K8sWorkloadConfig struct {
	TenantID  string
	SourceID  string
	StreamID  string
	Source    ResourceSource
	State     K8sStateStore
	DataRefFn DataRefFunc
}

// NewK8sWorkloadCapturer constructs a K8sWorkloadCapturer. Source and State are
// required. When DataRefFn is nil a deterministic default is used so PVCs always
// link to a stable data reference.
func NewK8sWorkloadCapturer(cfg K8sWorkloadConfig) (*K8sWorkloadCapturer, error) {
	if cfg.StreamID == "" {
		return nil, fmt.Errorf("%w: stream id is required", ErrInvalid)
	}
	if cfg.SourceID == "" {
		return nil, fmt.Errorf("%w: source id is required", ErrInvalid)
	}
	if cfg.TenantID == "" {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalid)
	}
	if cfg.Source == nil {
		return nil, fmt.Errorf("%w: resource source is required", ErrNotConfigured)
	}
	if cfg.State == nil {
		return nil, fmt.Errorf("%w: k8s state store is required", ErrNotConfigured)
	}
	dataRefFn := cfg.DataRefFn
	if dataRefFn == nil {
		streamID := cfg.StreamID
		dataRefFn = func(namespace, name string) string {
			return fmt.Sprintf("block://%s/pvc/%s/%s", streamID, namespace, name)
		}
	}
	return &K8sWorkloadCapturer{
		tenantID:  cfg.TenantID,
		sourceID:  cfg.SourceID,
		streamID:  cfg.StreamID,
		source:    cfg.Source,
		state:     cfg.State,
		dataRefFn: dataRefFn,
	}, nil
}

// Kind reports the frame kind this capturer produces (snapshot chunks).
func (c *K8sWorkloadCapturer) Kind() core.FrameKind { return core.FrameKindSnapshotChunk }

// Close latches the capturer closed.
func (c *K8sWorkloadCapturer) Close() error {
	c.mu.Lock()
	c.closed = true
	c.mu.Unlock()
	return nil
}

// LastEpoch returns the epoch the most recent successful Start persisted.
func (c *K8sWorkloadCapturer) LastEpoch() *Epoch {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastEpoch
}

// Start runs one manifest-snapshot pass and emits its frames on out, assigning
// Seq strictly above resumeFrom.
func (c *K8sWorkloadCapturer) Start(ctx context.Context, resumeFrom uint64, out chan<- core.Frame) error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return fmt.Errorf("%w: capturer is closed", ErrInvalid)
	}
	c.mu.Unlock()

	prior, priorEpoch, err := c.state.LoadK8sState(ctx, c.sourceID)
	if err != nil {
		return fmt.Errorf("vmcapture: load prior manifest set: %w", err)
	}

	raw, err := c.source.ListResources(ctx)
	if err != nil {
		return fmt.Errorf("vmcapture: list k8s resources: %w", err)
	}
	set, err := BuildManifestSet(raw, c.dataRefFn)
	if err != nil {
		return err
	}

	diff := DiffManifestSets(prior, set)

	frames, payloadBytes := EncodeManifestSetFrames(set, c.streamID, resumeFrom)
	for _, f := range frames {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case out <- f:
		}
	}

	epochNum := priorEpoch + 1
	epochKind := EpochIncremental
	if priorEpoch == 0 {
		epochKind = EpochBase
	}
	fromSeq := int64(resumeFrom) + 1
	toSeq := int64(resumeFrom) + int64(len(frames))

	epoch, err := c.state.SaveK8sEpoch(ctx, SaveK8sEpochInput{
		TenantID:     c.tenantID,
		SourceID:     c.sourceID,
		StreamID:     c.streamID,
		Epoch:        epochNum,
		EpochKind:    epochKind,
		FromSeq:      fromSeq,
		ToSeq:        toSeq,
		FrameCount:   len(frames),
		ChangedUnits: diff.Changed(),
		TotalUnits:   len(set.Resources),
		PayloadBytes: payloadBytes,
		ContentHash:  set.SetHash,
		SourceMarker: "k8s-set:" + set.SetHash,
		Set:          set,
	})
	if err != nil {
		return fmt.Errorf("vmcapture: persist k8s epoch: %w", err)
	}

	c.mu.Lock()
	c.lastEpoch = &epoch
	c.mu.Unlock()
	return nil
}
