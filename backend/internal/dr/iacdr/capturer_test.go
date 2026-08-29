package iacdr

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/clario360/platform/internal/datastream/core"
)

func drainFrames(t *testing.T, c *SnapshotCapturer, resumeFrom uint64) []core.Frame {
	t.Helper()
	out := make(chan core.Frame, 64)
	errCh := make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	go func() { errCh <- c.Start(ctx, resumeFrom, out) }()

	var frames []core.Frame
	// Start returns after emitting all frames; read until it returns, then drain.
	if err := <-errCh; err != nil {
		t.Fatalf("Start: %v", err)
	}
	close(out)
	for f := range out {
		frames = append(frames, f)
	}
	return frames
}

func TestSnapshotCapturer_EmitsFramesAndMarker(t *testing.T) {
	resources := []Resource{
		mkRes("aws", "aws_vpc", "main", map[string]any{"cidr": "10.0.0.0/16"}),
		mkRes("aws", "aws_subnet", "main", map[string]any{"cidr": "10.0.1.0/24"}, "aws_vpc.main"),
	}
	fixed := time.Date(2026, 6, 13, 0, 0, 0, 0, time.UTC)
	c := NewSnapshotCapturer("stream-1", resources).withClock(func() time.Time { return fixed })

	if c.Kind() != core.FrameKindSnapshotChunk {
		t.Fatalf("Kind = %v, want SNAPSHOT_CHUNK", c.Kind())
	}

	frames := drainFrames(t, c, 0)

	// 2 SNAPSHOT_CHUNK + 1 MARKER.
	if len(frames) != 3 {
		t.Fatalf("frames = %d, want 3", len(frames))
	}
	for i := 0; i < 2; i++ {
		if frames[i].Kind != core.FrameKindSnapshotChunk {
			t.Errorf("frame %d kind = %v, want SNAPSHOT_CHUNK", i, frames[i].Kind)
		}
		if frames[i].Seq != uint64(i+1) {
			t.Errorf("frame %d seq = %d, want %d", i, frames[i].Seq, i+1)
		}
		if frames[i].StreamID != "stream-1" {
			t.Errorf("frame %d stream = %q", i, frames[i].StreamID)
		}
		var fr FrameResource
		if err := json.Unmarshal(frames[i].Payload, &fr); err != nil {
			t.Fatalf("frame %d payload not decodable: %v", i, err)
		}
		if fr.Hash == "" || fr.Address == "" {
			t.Errorf("frame %d payload incomplete: %+v", i, fr)
		}
	}

	marker := frames[2]
	if marker.Kind != core.FrameKindMarker {
		t.Fatalf("last frame kind = %v, want MARKER", marker.Kind)
	}
	var mp FrameMarkerPayload
	if err := json.Unmarshal(marker.Payload, &mp); err != nil {
		t.Fatalf("marker payload: %v", err)
	}
	if mp.ResourceCount != 2 {
		t.Errorf("marker resource_count = %d, want 2", mp.ResourceCount)
	}
	if mp.ContentHash != ComputeContentHash(resources) {
		t.Errorf("marker content_hash mismatch")
	}
	if marker.SourceLSN != ComputeContentHash(resources) {
		t.Errorf("marker SourceLSN should pin the content hash")
	}
}

func TestSnapshotCapturer_Resume(t *testing.T) {
	resources := []Resource{
		mkRes("aws", "aws_vpc", "main", nil),
		mkRes("aws", "aws_subnet", "main", nil),
		mkRes("aws", "aws_instance", "web", nil),
	}
	c := NewSnapshotCapturer("s", resources)
	// Resume after seq 2: should emit only resource 3 (seq 3) and the marker (seq 4).
	frames := drainFrames(t, c, 2)
	if len(frames) != 2 {
		t.Fatalf("resumed frames = %d, want 2", len(frames))
	}
	if frames[0].Seq != 3 || frames[0].Kind != core.FrameKindSnapshotChunk {
		t.Errorf("first resumed frame = seq %d kind %v", frames[0].Seq, frames[0].Kind)
	}
	if frames[1].Seq != 4 || frames[1].Kind != core.FrameKindMarker {
		t.Errorf("marker frame = seq %d kind %v", frames[1].Seq, frames[1].Kind)
	}

	// Resume past the marker: emit nothing.
	c2 := NewSnapshotCapturer("s", resources)
	none := drainFrames(t, c2, 4)
	if len(none) != 0 {
		t.Fatalf("resume past end emitted %d frames, want 0", len(none))
	}
}

func TestSnapshotCapturer_ContextCancel(t *testing.T) {
	resources := []Resource{mkRes("aws", "aws_vpc", "main", nil)}
	c := NewSnapshotCapturer("s", resources)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel before start
	// Unbuffered channel so the first send blocks until ctx is observed.
	out := make(chan core.Frame)
	err := c.Start(ctx, 0, out)
	if err == nil {
		t.Fatal("expected context cancellation error")
	}
}
