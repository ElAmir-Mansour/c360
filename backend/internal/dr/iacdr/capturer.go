package iacdr

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/clario360/platform/internal/datastream/core"
)

// SnapshotCapturer is a one-shot core.Capturer that ships a parsed IaC snapshot
// as ordered SNAPSHOT_CHUNK frames the EXISTING DataStream ingest/apply pipeline
// can persist (framestore.Store appends them; recovery points seal over them).
// This is how a captured estate's IaC rides the same resumable, encrypted
// transport as the data streams: one frame per resource, in deterministic
// address order, terminated by a MARKER frame that pins the snapshot's content
// hash as the recovery point's source LSN.
//
// It is a REAL Capturer (it implements internal/datastream/core.Capturer and
// emits real core.Frame values with real JSON payloads), exercised by unit tests
// that drain its output channel and assert the frame sequence, kinds, payloads
// and resume behaviour — no external infrastructure required, because the source
// (a parsed snapshot) is in-memory by construction.
type SnapshotCapturer struct {
	streamID  string
	resources []Resource
	// contentHash pins the whole snapshot identity; emitted on the trailing MARKER.
	contentHash string
	now         func() time.Time
}

// NewSnapshotCapturer builds a capturer over an already-parsed snapshot's
// resources. streamID is the replication stream the frames belong to.
func NewSnapshotCapturer(streamID string, resources []Resource) *SnapshotCapturer {
	return &SnapshotCapturer{
		streamID:    streamID,
		resources:   resources,
		contentHash: ComputeContentHash(resources),
		now:         func() time.Time { return time.Now().UTC() },
	}
}

// withClock overrides the timestamp source for deterministic tests.
func (c *SnapshotCapturer) withClock(now func() time.Time) *SnapshotCapturer {
	if now != nil {
		c.now = now
	}
	return c
}

// Kind reports that this capturer produces SNAPSHOT_CHUNK frames — the SEED
// phase of a stream, exactly the kind the framestore/apply path expects for a
// one-shot full-state capture.
func (c *SnapshotCapturer) Kind() core.FrameKind { return core.FrameKindSnapshotChunk }

// FrameResource is the wire payload of one IaC SNAPSHOT_CHUNK frame: a single
// captured resource plus its sequence position, so an applier can rebuild the
// snapshot deterministically.
type FrameResource struct {
	Seq      uint64   `json:"seq"`
	Provider string   `json:"provider"`
	Type     string   `json:"type"`
	Name     string   `json:"name"`
	Address  string   `json:"address"`
	Attrs    any      `json:"attributes"`
	Deps     []string `json:"depends_on"`
	Hash     string   `json:"hash"`
}

// FrameMarkerPayload is the wire payload of the trailing MARKER frame.
type FrameMarkerPayload struct {
	ResourceCount int    `json:"resource_count"`
	ContentHash   string `json:"content_hash"`
}

// Start emits one SNAPSHOT_CHUNK frame per resource (seq 1..N) followed by a
// MARKER frame (seq N+1) carrying the snapshot content hash, then returns. It
// honours resumeFrom: already-applied sequence numbers (<= resumeFrom) are
// skipped so a resumed stream does not re-ship persisted resources, mirroring the
// core PGCapturer's resume contract. It respects ctx cancellation between frames.
func (c *SnapshotCapturer) Start(ctx context.Context, resumeFrom uint64, out chan<- core.Frame) error {
	var seq uint64
	for _, r := range c.resources {
		seq++
		if seq <= resumeFrom {
			continue
		}
		payload, err := json.Marshal(FrameResource{
			Seq:      seq,
			Provider: r.Provider,
			Type:     r.Type,
			Name:     r.Name,
			Address:  r.Address,
			Attrs:    r.Attributes,
			Deps:     r.DependsOn,
			Hash:     r.Hash,
		})
		if err != nil {
			return fmt.Errorf("iacdr capturer: marshaling resource %s: %w", r.Address, err)
		}
		frame := core.Frame{
			StreamID:  c.streamID,
			Seq:       seq,
			Kind:      core.FrameKindSnapshotChunk,
			Payload:   payload,
			SourceLSN: r.Hash,
			EmittedAt: c.now(),
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case out <- frame:
		}
	}

	// Trailing MARKER pins the snapshot's content hash as the recovery point LSN.
	seq++
	if seq > resumeFrom {
		markerPayload, err := json.Marshal(FrameMarkerPayload{
			ResourceCount: len(c.resources),
			ContentHash:   c.contentHash,
		})
		if err != nil {
			return fmt.Errorf("iacdr capturer: marshaling marker: %w", err)
		}
		marker := core.Frame{
			StreamID:  c.streamID,
			Seq:       seq,
			Kind:      core.FrameKindMarker,
			Payload:   markerPayload,
			SourceLSN: c.contentHash,
			EmittedAt: c.now(),
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case out <- marker:
		}
	}
	return nil
}

// Close releases the capturer. A snapshot capturer holds no external resources
// (its source is the in-memory parsed snapshot), so Close is a no-op success.
func (c *SnapshotCapturer) Close() error { return nil }

// compile-time check that SnapshotCapturer satisfies the shared core interface.
var _ core.Capturer = (*SnapshotCapturer)(nil)
