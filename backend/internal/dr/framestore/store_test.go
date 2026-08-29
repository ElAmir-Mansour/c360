package framestore_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/framestore"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

const (
	testTenant = "aaaaaaaa-0000-0000-0000-000000000001"
	testStream = "11111111-1111-1111-1111-111111111111"
)

func TestAppendFrameComputesHashAndMetadata(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	repo := &fakeRepo{}
	store := framestore.New(repo, nil, framestore.WithClock(func() time.Time { return now }))
	tenantID := uuid.MustParse(testTenant)
	payload := []byte("wal:insert account=42")

	_, err := store.AppendFrame(context.Background(), tenantID, core.Frame{
		StreamID:  testStream,
		Seq:       9,
		Kind:      core.FrameKindWAL,
		SourceLSN: "0/16B6248",
		Payload:   payload,
	})
	if err != nil {
		t.Fatalf("AppendFrame: %v", err)
	}
	if len(repo.appended) != 1 {
		t.Fatalf("appended = %d, want 1", len(repo.appended))
	}
	got := repo.appended[0]
	if got.TenantID != testTenant || got.StreamID != testStream || got.Seq != 9 {
		t.Fatalf("wrong key metadata: %+v", got)
	}
	if got.Kind != core.FrameKindWAL.String() || got.SourceMarker != "0/16B6248" || !got.AppliedAt.Equal(now) {
		t.Fatalf("wrong frame metadata: %+v", got)
	}
	if got.PayloadSHA256 != sha256Hex(payload) || got.PayloadBytes != int64(len(payload)) {
		t.Fatalf("wrong payload digest metadata: %+v", got)
	}

	payload[0] = 'X'
	if bytes.Equal(repo.appended[0].Payload, payload) {
		t.Fatal("stored append payload aliases caller buffer")
	}
}

func TestLatestContiguousReturnsDeterministicChunkAndManifest(t *testing.T) {
	t.Parallel()

	appliedAt := time.Date(2026, 6, 13, 10, 5, 0, 0, time.UTC)
	frames := []repository.AppliedFrame{
		appliedFrame(1, core.FrameKindSnapshotChunk.String(), "0/1", []byte("alpha"), appliedAt),
		appliedFrame(2, core.FrameKindWAL.String(), "0/2", []byte("beta"), appliedAt.Add(time.Second)),
	}
	repo := &fakeRepo{frames: frames}
	store := framestore.New(repo, nil)
	tenantID := uuid.MustParse(testTenant)

	first, err := store.LatestContiguous(context.Background(), tenantID, testStream, 4)
	if err != nil {
		t.Fatalf("LatestContiguous first: %v", err)
	}
	second, err := store.LatestContiguous(context.Background(), tenantID, testStream, 4)
	if err != nil {
		t.Fatalf("LatestContiguous second: %v", err)
	}

	firstBytes := readAll(t, first.Reader)
	secondBytes := readAll(t, second.Reader)
	if string(firstBytes) != "alphabeta" {
		t.Fatalf("chunk bytes = %q, want alphabeta", firstBytes)
	}
	if !bytes.Equal(firstBytes, secondBytes) {
		t.Fatalf("chunk bytes not deterministic: %q vs %q", firstBytes, secondBytes)
	}

	manifest := first.Manifest
	if manifest.FromSeq != 1 || manifest.ThroughSeq != 2 || manifest.FrameCount != 2 {
		t.Fatalf("wrong manifest range: %+v", manifest)
	}
	if manifest.PayloadBytes != int64(len("alphabeta")) || manifest.PayloadSHA256 != sha256Hex([]byte("alphabeta")) {
		t.Fatalf("wrong manifest payload metadata: %+v", manifest)
	}
	if manifest.SourceMarker != "0/2" || !manifest.AppliedAt.Equal(appliedAt.Add(time.Second)) {
		t.Fatalf("wrong marker/apply metadata: %+v", manifest)
	}
	if len(manifest.Frames) != 2 || manifest.Frames[0].PayloadSHA256 != sha256Hex([]byte("alpha")) {
		t.Fatalf("wrong frame manifest: %+v", manifest.Frames)
	}
	if repo.lastTenant != testTenant || repo.lastStream != testStream || repo.lastThrough != 4 {
		t.Fatalf("repository query was not scoped correctly: tenant=%s stream=%s through=%d", repo.lastTenant, repo.lastStream, repo.lastThrough)
	}
}

func TestChunkSourceUsesDurableAppliedBytesThroughCheckpoint(t *testing.T) {
	t.Parallel()

	appliedAt := time.Date(2026, 6, 13, 10, 10, 0, 0, time.UTC)
	repo := &fakeRepo{frames: []repository.AppliedFrame{
		appliedFrame(1, core.FrameKindWAL.String(), "0/1", []byte("one"), appliedAt),
		appliedFrame(2, core.FrameKindMarker.String(), "0/2", nil, appliedAt.Add(time.Second)),
	}}
	store := framestore.New(repo, nil)
	tenantID := uuid.MustParse(testTenant)

	reader, marker, lastCommit, err := store.Chunk(context.Background(), tenantID, &model.ReplicationStream{
		ID:         testStream,
		TenantID:   testTenant,
		AppliedSeq: 2,
	})
	if err != nil {
		t.Fatalf("Chunk: %v", err)
	}
	if got := string(readAll(t, reader)); got != "one" {
		t.Fatalf("chunk bytes = %q, want one", got)
	}
	if marker != "0/2" || !lastCommit.Equal(appliedAt.Add(time.Second)) {
		t.Fatalf("marker/commit = %q %s", marker, lastCommit)
	}
	if repo.lastThrough != 2 {
		t.Fatalf("through seq = %d, want 2", repo.lastThrough)
	}
}

func TestChunkSourceErrorsWhenDurableFramesLagCheckpoint(t *testing.T) {
	t.Parallel()

	appliedAt := time.Date(2026, 6, 13, 10, 15, 0, 0, time.UTC)
	repo := &fakeRepo{frames: []repository.AppliedFrame{
		appliedFrame(1, core.FrameKindWAL.String(), "0/1", []byte("one"), appliedAt),
		appliedFrame(2, core.FrameKindWAL.String(), "0/2", []byte("two"), appliedAt.Add(time.Second)),
	}}
	store := framestore.New(repo, nil)
	tenantID := uuid.MustParse(testTenant)

	_, _, _, err := store.Chunk(context.Background(), tenantID, &model.ReplicationStream{
		ID:         testStream,
		TenantID:   testTenant,
		AppliedSeq: 3,
	})
	if !errors.Is(err, framestore.ErrIncompleteContiguousFrames) {
		t.Fatalf("got err %v, want ErrIncompleteContiguousFrames", err)
	}
	if repo.lastThrough != 3 {
		t.Fatalf("through seq = %d, want 3", repo.lastThrough)
	}
}

func TestLatestContiguousNoFramesForAdvancedCheckpoint(t *testing.T) {
	t.Parallel()

	store := framestore.New(&fakeRepo{}, nil)
	_, err := store.LatestContiguous(context.Background(), uuid.MustParse(testTenant), testStream, 3)
	if !errors.Is(err, framestore.ErrNoContiguousFrames) {
		t.Fatalf("got err %v, want ErrNoContiguousFrames", err)
	}
}

type fakeRepo struct {
	appended    []repository.AppendAppliedFrameInput
	frames      []repository.AppliedFrame
	lastTenant  string
	lastStream  string
	lastThrough int64
}

func (f *fakeRepo) AppendAppliedFrame(_ context.Context, _ repository.DBTX, in repository.AppendAppliedFrameInput) (*repository.AppliedFrame, error) {
	in.Payload = append([]byte(nil), in.Payload...)
	f.appended = append(f.appended, in)
	return &repository.AppliedFrame{
		ID:            "frame-id",
		TenantID:      in.TenantID,
		StreamID:      in.StreamID,
		Seq:           in.Seq,
		Kind:          in.Kind,
		SourceMarker:  in.SourceMarker,
		Payload:       append([]byte(nil), in.Payload...),
		PayloadSHA256: in.PayloadSHA256,
		PayloadBytes:  in.PayloadBytes,
		AppliedAt:     in.AppliedAt,
		CreatedAt:     in.AppliedAt,
	}, nil
}

func (f *fakeRepo) ListContiguousAppliedFrames(_ context.Context, _ repository.DBTX, tenantID, streamID string, throughSeq int64) ([]repository.AppliedFrame, error) {
	f.lastTenant = tenantID
	f.lastStream = streamID
	f.lastThrough = throughSeq
	out := make([]repository.AppliedFrame, 0, len(f.frames))
	for _, frame := range f.frames {
		if frame.Seq <= throughSeq {
			frame.Payload = append([]byte(nil), frame.Payload...)
			out = append(out, frame)
		}
	}
	return out, nil
}

func appliedFrame(seq int64, kind, marker string, payload []byte, appliedAt time.Time) repository.AppliedFrame {
	return repository.AppliedFrame{
		ID:            "frame",
		TenantID:      testTenant,
		StreamID:      testStream,
		Seq:           seq,
		Kind:          kind,
		SourceMarker:  marker,
		Payload:       append([]byte(nil), payload...),
		PayloadSHA256: sha256Hex(payload),
		PayloadBytes:  int64(len(payload)),
		AppliedAt:     appliedAt,
		CreatedAt:     appliedAt,
	}
}

func readAll(t *testing.T, r io.Reader) []byte {
	t.Helper()
	b, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	return b
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
