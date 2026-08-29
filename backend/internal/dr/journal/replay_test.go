package journal

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/datastream/core"
)

type memSegmentReader struct {
	byKey map[string][]byte
}

func (r memSegmentReader) ReadSegment(_ context.Context, _ uuid.UUID, seg Segment) ([]byte, error) {
	raw, ok := r.byKey[seg.ObjectKey]
	if !ok {
		return nil, errors.New("missing segment")
	}
	return append([]byte(nil), raw...), nil
}

type memMetadataSource struct {
	rows map[uint64]FrameMetadata
}

func (m memMetadataSource) ListFrameMetadata(context.Context, uuid.UUID, string, int64, int64) ([]FrameMetadata, error) {
	out := make([]FrameMetadata, 0, len(m.rows))
	for _, row := range m.rows {
		out = append(out, row)
	}
	return out, nil
}

func TestReplayer_ReplaysResolvedSeqCut(t *testing.T) {
	t.Parallel()

	raw, hash, err := encodeSegment([]core.Frame{
		frame(1, core.FrameKindWAL, "0/1", "a", t0),
		frame(2, core.FrameKindWAL, "0/2", "b", t0.Add(time.Second)),
		frame(3, core.FrameKindWAL, "0/3", "c", t0.Add(2*time.Second)),
	})
	if err != nil {
		t.Fatalf("encodeSegment: %v", err)
	}
	replayer, err := NewReplayer(ReplayerConfig{Reader: memSegmentReader{byKey: map[string][]byte{"seg-1": raw}}})
	if err != nil {
		t.Fatalf("NewReplayer: %v", err)
	}
	cut := int64(2)
	res := &Resolution{
		StreamID:   testStream,
		TargetKind: "seq",
		TargetSeq:  &cut,
		CutSeq:     cut,
		CutLSN:     "0/2",
		Segments: []Segment{{
			ID:          "seg-1",
			StreamID:    testStream,
			MinSeq:      1,
			MaxSeq:      3,
			ObjectKey:   "seg-1",
			ContentHash: hash,
		}},
	}

	var out bytes.Buffer
	got, err := replayer.Replay(context.Background(), uuid.MustParse(testTenant), res, &out)
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if out.String() != "ab" {
		t.Fatalf("materialized bytes = %q, want ab", out.String())
	}
	if got.FramesApplied != 2 || got.LastSeq != 2 || got.LastLSN != "0/2" || got.PayloadBytes != 2 {
		t.Fatalf("result = %+v", got)
	}
}

func TestReplayer_TimestampCutUsesFrameMetadata(t *testing.T) {
	t.Parallel()

	raw, hash, err := encodeSegment([]core.Frame{
		frame(1, core.FrameKindWAL, "0/1", "a", time.Time{}),
		frame(2, core.FrameKindWAL, "0/2", "b", time.Time{}),
		frame(3, core.FrameKindWAL, "0/3", "c", time.Time{}),
	})
	if err != nil {
		t.Fatalf("encodeSegment: %v", err)
	}
	target := t0.Add(1500 * time.Millisecond)
	replayer, err := NewReplayer(ReplayerConfig{
		Reader: memSegmentReader{byKey: map[string][]byte{"seg-1": raw}},
		Metadata: memMetadataSource{rows: map[uint64]FrameMetadata{
			1: {Seq: 1, SourceLSN: "0/1", At: t0},
			2: {Seq: 2, SourceLSN: "0/2", At: t0.Add(time.Second)},
			3: {Seq: 3, SourceLSN: "0/3", At: t0.Add(2 * time.Second)},
		}},
	})
	if err != nil {
		t.Fatalf("NewReplayer: %v", err)
	}
	res := &Resolution{
		StreamID:   testStream,
		TargetKind: "timestamp",
		TargetTS:   &target,
		CutSeq:     3,
		CutLSN:     "0/3",
		CutTS:      t0.Add(2 * time.Second),
		ExactMatch: false,
		Segments: []Segment{{
			ID:          "seg-1",
			StreamID:    testStream,
			MinSeq:      1,
			MaxSeq:      3,
			ObjectKey:   "seg-1",
			ContentHash: hash,
		}},
	}

	var out bytes.Buffer
	got, err := replayer.Replay(context.Background(), uuid.MustParse(testTenant), res, &out)
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if out.String() != "ab" {
		t.Fatalf("materialized bytes = %q, want ab", out.String())
	}
	if got.LastSeq != 2 || got.LastLSN != "0/2" || !got.LastAt.Equal(t0.Add(time.Second)) {
		t.Fatalf("result = %+v", got)
	}
}

func TestReplayer_RejectsHashMismatch(t *testing.T) {
	t.Parallel()

	raw, _, err := encodeSegment([]core.Frame{frame(1, core.FrameKindWAL, "0/1", "a", t0)})
	if err != nil {
		t.Fatalf("encodeSegment: %v", err)
	}
	replayer, err := NewReplayer(ReplayerConfig{Reader: memSegmentReader{byKey: map[string][]byte{"seg-1": raw}}})
	if err != nil {
		t.Fatalf("NewReplayer: %v", err)
	}
	res := &Resolution{
		StreamID:   testStream,
		TargetKind: "seq",
		CutSeq:     1,
		Segments: []Segment{{
			ID:          "seg-1",
			StreamID:    testStream,
			MinSeq:      1,
			MaxSeq:      1,
			ObjectKey:   "seg-1",
			ContentHash: "not-a-real-hash",
		}},
	}

	_, err = replayer.Replay(context.Background(), uuid.MustParse(testTenant), res, ioDiscard{})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("Replay err = %v, want ErrInvalid", err)
	}
}

type ioDiscard struct{}

func (ioDiscard) Write(p []byte) (int, error) { return len(p), nil }
