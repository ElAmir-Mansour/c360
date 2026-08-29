package service_test

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/journal"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/service"
)

type testJournalResolver struct {
	res *journal.Resolution
	err error
}

func (r testJournalResolver) Resolve(context.Context, uuid.UUID, uuid.UUID, journal.ResolveRequest) (*journal.Resolution, error) {
	return r.res, r.err
}

type testJournalSegments struct {
	raw  map[string][]byte
	meta []journal.FrameMetadata
}

func (s testJournalSegments) ReadSegment(_ context.Context, _ uuid.UUID, seg journal.Segment) ([]byte, error) {
	return append([]byte(nil), s.raw[seg.ObjectKey]...), nil
}

func (s testJournalSegments) ListFrameMetadata(context.Context, uuid.UUID, string, int64, int64) ([]journal.FrameMetadata, error) {
	return append([]journal.FrameMetadata(nil), s.meta...), nil
}

func TestJournalChunkSource_ReplaysMaterializedBytes(t *testing.T) {
	t.Parallel()

	streamID := uuid.NewString()
	tenantID := uuid.New()
	at := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	raw := encodeJournalFrames(t,
		core.Frame{Seq: 1, Kind: core.FrameKindWAL, SourceLSN: "0/1", Payload: []byte("one")},
		core.Frame{Seq: 2, Kind: core.FrameKindWAL, SourceLSN: "0/2", Payload: []byte("two")},
	)
	replayer, err := journal.NewReplayer(journal.ReplayerConfig{
		Reader: testJournalSegments{raw: map[string][]byte{"seg": raw}},
		Metadata: testJournalSegments{meta: []journal.FrameMetadata{
			{Seq: 1, SourceLSN: "0/1", At: at},
			{Seq: 2, SourceLSN: "0/2", At: at.Add(time.Second)},
		}},
	})
	if err != nil {
		t.Fatalf("NewReplayer: %v", err)
	}
	seq := int64(2)
	source := service.JournalChunkSource{
		Resolver: testJournalResolver{res: &journal.Resolution{
			StreamID:   streamID,
			TargetKind: "seq",
			TargetSeq:  &seq,
			CutSeq:     2,
			CutLSN:     "0/2",
			CutTS:      at.Add(time.Second),
			Segments: []journal.Segment{{
				ID:        "seg",
				StreamID:  streamID,
				MinSeq:    1,
				MaxSeq:    2,
				ObjectKey: "seg",
			}},
		}},
		Replayer: replayer,
		Target:   journal.ResolveRequest{Seq: &seq},
	}

	reader, marker, lastCommit, err := source.Chunk(context.Background(), tenantID, &model.ReplicationStream{ID: streamID})
	if err != nil {
		t.Fatalf("Chunk: %v", err)
	}
	var got bytes.Buffer
	if _, err := got.ReadFrom(reader); err != nil {
		t.Fatalf("ReadFrom: %v", err)
	}
	if got.String() != "onetwo" || marker != "0/2" || !lastCommit.Equal(at.Add(time.Second)) {
		t.Fatalf("chunk=%q marker=%q last=%s", got.String(), marker, lastCommit)
	}
}

func encodeJournalFrames(t *testing.T, frames ...core.Frame) []byte {
	t.Helper()
	var buf bytes.Buffer
	for _, frame := range frames {
		if err := core.EncodeFrame(&buf, frame); err != nil {
			t.Fatalf("EncodeFrame: %v", err)
		}
	}
	return buf.Bytes()
}
