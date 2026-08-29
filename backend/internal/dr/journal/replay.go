package journal

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/datastream/core"
)

// SegmentReader loads the sealed canonical frame bytes for a journal segment.
// Production supplies a WORM/framestore-backed reader; tests use memory.
type SegmentReader interface {
	ReadSegment(ctx context.Context, tenantID uuid.UUID, segment Segment) ([]byte, error)
}

// FrameMetadata carries per-frame time/LSN metadata that is not present in
// core.EncodeFrame's wire format. It lets timestamp and mid-segment LSN cuts be
// applied exactly while keeping segment bytes in the canonical core format.
type FrameMetadata struct {
	Seq       uint64
	SourceLSN string
	At        time.Time
}

// FrameMetadataSource provides per-frame metadata for a sealed segment range.
// It is optional for exact Seq cuts, but required for mid-segment timestamp
// cuts because core.EncodeFrame deliberately omits EmittedAt.
type FrameMetadataSource interface {
	ListFrameMetadata(ctx context.Context, tenantID uuid.UUID, streamID string, minSeq, maxSeq int64) ([]FrameMetadata, error)
}

// Replayer decodes a resolved journal replay set and materializes the payload
// bytes up to the requested cut.
type Replayer struct {
	reader   SegmentReader
	metadata FrameMetadataSource
	compare  func(a, b string) int
}

// ReplayerConfig wires a Replayer.
type ReplayerConfig struct {
	Reader     SegmentReader
	Metadata   FrameMetadataSource
	CompareLSN func(a, b string) int
}

// NewReplayer constructs a journal replay executor.
func NewReplayer(cfg ReplayerConfig) (*Replayer, error) {
	if cfg.Reader == nil {
		return nil, errors.New("journal replayer: segment reader is required")
	}
	compare := cfg.CompareLSN
	if compare == nil {
		compare = CompareLSN
	}
	return &Replayer{reader: cfg.Reader, metadata: cfg.Metadata, compare: compare}, nil
}

// ReplayResult summarizes the exact materialized boundary.
type ReplayResult struct {
	StreamID      string    `json:"stream_id"`
	FramesApplied int       `json:"frames_applied"`
	LastSeq       uint64    `json:"last_seq"`
	LastLSN       string    `json:"last_lsn,omitempty"`
	LastAt        time.Time `json:"last_at"`
	PayloadBytes  int64     `json:"payload_bytes"`
	PayloadSHA256 string    `json:"payload_sha256"`
}

// Replay decodes res.Segments in order, applies the resolver cut per frame, and
// writes the reconstructed payload stream to dst. Segment content hashes are
// verified before decode, and the decoded Seq range must be contiguous.
func (r *Replayer) Replay(ctx context.Context, tenantID uuid.UUID, res *Resolution, dst io.Writer) (ReplayResult, error) {
	if r == nil || r.reader == nil {
		return ReplayResult{}, errors.New("journal replayer: segment reader is required")
	}
	if tenantID == uuid.Nil {
		return ReplayResult{}, fmt.Errorf("%w: tenant id is required", ErrInvalid)
	}
	if res == nil {
		return ReplayResult{}, fmt.Errorf("%w: resolution is required", ErrInvalid)
	}
	if res.StreamID == "" {
		return ReplayResult{}, fmt.Errorf("%w: resolution stream id is required", ErrInvalid)
	}
	if res.CutSeq <= 0 {
		return ReplayResult{}, fmt.Errorf("%w: resolution cut_seq must be positive", ErrInvalid)
	}
	if len(res.Segments) == 0 {
		return ReplayResult{}, ErrNoCoverage
	}
	if dst == nil {
		dst = io.Discard
	}
	if res.TargetKind == "timestamp" && res.TargetTS != nil && !res.ExactMatch && !res.BoundaryClamped && r.metadata == nil {
		return ReplayResult{}, fmt.Errorf("%w: timestamp replay inside a segment requires per-frame metadata", ErrInvalid)
	}

	hash := sha256.New()
	out := io.MultiWriter(dst, hash)
	result := ReplayResult{StreamID: res.StreamID}
	expected := res.Segments[0].MinSeq
	stop := false

	for _, seg := range res.Segments {
		if stop {
			break
		}
		if seg.Pruned {
			return ReplayResult{}, fmt.Errorf("%w: segment %s was pruned", ErrPruned, seg.ID)
		}
		if seg.StreamID != "" && seg.StreamID != res.StreamID {
			return ReplayResult{}, fmt.Errorf("%w: segment %s stream %s does not match resolution stream %s",
				ErrInvalid, seg.ID, seg.StreamID, res.StreamID)
		}
		if seg.MinSeq != expected {
			return ReplayResult{}, fmt.Errorf("%w: segment %s starts at seq %d, expected %d",
				ErrInvalid, seg.ID, seg.MinSeq, expected)
		}

		raw, err := r.reader.ReadSegment(ctx, tenantID, seg)
		if err != nil {
			return ReplayResult{}, fmt.Errorf("reading journal segment %s: %w", seg.ID, err)
		}
		if err := verifySegmentHash(seg, raw); err != nil {
			return ReplayResult{}, err
		}
		meta, err := r.metadataBySeq(ctx, tenantID, seg)
		if err != nil {
			return ReplayResult{}, err
		}

		br := bufio.NewReader(bytes.NewReader(raw))
		for {
			f, err := core.DecodeFrame(br)
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				return ReplayResult{}, fmt.Errorf("decoding journal segment %s: %w", seg.ID, err)
			}
			if f.Seq != uint64(expected) {
				return ReplayResult{}, fmt.Errorf("%w: segment %s decoded seq %d, expected %d",
					ErrInvalid, seg.ID, f.Seq, expected)
			}
			f.StreamID = res.StreamID

			frameMeta := meta[f.Seq]
			apply, done, err := r.shouldApply(res, f, frameMeta)
			if err != nil {
				return ReplayResult{}, err
			}
			if apply {
				n, err := out.Write(f.Payload)
				if err != nil {
					return ReplayResult{}, fmt.Errorf("writing replayed frame seq=%d: %w", f.Seq, err)
				}
				result.FramesApplied++
				result.LastSeq = f.Seq
				result.LastLSN = firstNonEmpty(frameMeta.SourceLSN, f.SourceLSN, result.LastLSN)
				result.LastAt = firstNonZero(frameMeta.At, result.LastAt)
				result.PayloadBytes += int64(n)
			}
			expected++
			if done {
				stop = true
				break
			}
		}
		if expected != seg.MaxSeq+1 && !stop {
			return ReplayResult{}, fmt.Errorf("%w: segment %s ended at seq %d, expected through %d",
				ErrInvalid, seg.ID, expected-1, seg.MaxSeq)
		}
	}

	result.PayloadSHA256 = hex.EncodeToString(hash.Sum(nil))
	if result.LastAt.IsZero() {
		result.LastAt = res.CutTS
	}
	if result.LastLSN == "" {
		result.LastLSN = res.CutLSN
	}
	return result, nil
}

func verifySegmentHash(seg Segment, raw []byte) error {
	if seg.ContentHash == "" {
		return nil
	}
	sum := sha256.Sum256(raw)
	if got := hex.EncodeToString(sum[:]); got != seg.ContentHash {
		return fmt.Errorf("%w: segment %s content hash mismatch", ErrInvalid, seg.ID)
	}
	return nil
}

func (r *Replayer) metadataBySeq(ctx context.Context, tenantID uuid.UUID, seg Segment) (map[uint64]FrameMetadata, error) {
	out := map[uint64]FrameMetadata{}
	if r.metadata == nil {
		return out, nil
	}
	rows, err := r.metadata.ListFrameMetadata(ctx, tenantID, seg.StreamID, seg.MinSeq, seg.MaxSeq)
	if err != nil {
		return nil, fmt.Errorf("loading journal frame metadata stream=%s [%d,%d]: %w",
			seg.StreamID, seg.MinSeq, seg.MaxSeq, err)
	}
	for _, row := range rows {
		out[row.Seq] = row
	}
	return out, nil
}

func (r *Replayer) shouldApply(res *Resolution, f core.Frame, meta FrameMetadata) (apply bool, done bool, err error) {
	if f.Seq > uint64(res.CutSeq) {
		return false, true, nil
	}

	switch res.TargetKind {
	case "seq":
		return true, f.Seq == uint64(res.CutSeq), nil
	case "lsn":
		if res.TargetLSN == "" || f.SourceLSN == "" {
			return true, f.Seq == uint64(res.CutSeq), nil
		}
		if r.compare(f.SourceLSN, res.TargetLSN) > 0 {
			return false, true, nil
		}
		return true, r.compare(f.SourceLSN, res.TargetLSN) == 0, nil
	case "timestamp":
		if res.TargetTS == nil || res.ExactMatch || res.BoundaryClamped {
			return true, f.Seq == uint64(res.CutSeq), nil
		}
		at := meta.At
		if at.IsZero() {
			return false, false, fmt.Errorf("%w: missing frame timestamp metadata for stream %s seq %d",
				ErrInvalid, res.StreamID, f.Seq)
		}
		if at.After(*res.TargetTS) {
			return false, true, nil
		}
		return true, f.Seq == uint64(res.CutSeq), nil
	default:
		return false, false, fmt.Errorf("%w: unsupported resolution target kind %q", ErrInvalid, res.TargetKind)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func firstNonZero(values ...time.Time) time.Time {
	for _, value := range values {
		if !value.IsZero() {
			return value
		}
	}
	return time.Time{}
}
