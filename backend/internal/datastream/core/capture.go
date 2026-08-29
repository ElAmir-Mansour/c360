// Package core is the shared replication engine for the Clario360 DataStream
// suite: Capture -> Transport -> Apply -> Checkpoint -> Validate. It is built
// once and consumed by ClarioDR, ClarioMigration and ClarioSync, which differ
// only in which Capturer/Applier they wire and what triggers a run.
//
// The package contains no DR-specific type so the "build-once dividend" holds:
// fixing throughput, encryption or resume logic here improves every consumer
// simultaneously.
package core

import (
	"context"
	"time"
)

// FrameKind identifies the semantic category of a Frame's payload. It is a
// single byte on the wire (see frame.go) so consumers can route frames to the
// correct Applier without decoding the payload.
type FrameKind uint8

const (
	// FrameKindSnapshotChunk is a chunk of a one-shot full-state snapshot
	// (the SEED phase of a stream).
	FrameKindSnapshotChunk FrameKind = iota + 1
	// FrameKindWAL is a database write-ahead-log / logical-replication record
	// (the perpetual DELTA phase).
	FrameKindWAL
	// FrameKindFileDelta is an rsync-style file delta block.
	FrameKindFileDelta
	// FrameKindMarker is a consistency marker delimiting a recovery point at a
	// common source LSN. It carries no data payload of its own but pins an LSN.
	FrameKindMarker
)

// String renders a FrameKind for logs and metrics labels.
func (k FrameKind) String() string {
	switch k {
	case FrameKindSnapshotChunk:
		return "SNAPSHOT_CHUNK"
	case FrameKindWAL:
		return "WAL"
	case FrameKindFileDelta:
		return "FILE_DELTA"
	case FrameKindMarker:
		return "MARKER"
	default:
		return "UNKNOWN"
	}
}

// Valid reports whether k is one of the defined frame kinds.
func (k FrameKind) Valid() bool {
	switch k {
	case FrameKindSnapshotChunk, FrameKindWAL, FrameKindFileDelta, FrameKindMarker:
		return true
	default:
		return false
	}
}

// Frame is the atomic, ordered, resumable unit shipped over Transport.
//
// Payload is the raw (uncompressed, unencrypted) bytes as produced by a
// Capturer and consumed by an Applier; the Transport layer is solely
// responsible for compressing and encrypting it on the wire.
type Frame struct {
	StreamID  string    // replication stream (consistency-group member)
	Seq       uint64    // monotonic per stream; the resume cursor
	Kind      FrameKind // SNAPSHOT_CHUNK | WAL | FILE_DELTA | MARKER
	Payload   []byte    // compressed+encrypted by Transport, raw here
	SourceLSN string    // DB log sequence number / file offset (opaque to core)
	EmittedAt time.Time // for RPO computation
}

// Capturer produces an ordered Frame stream from a source. Runs on the agent.
type Capturer interface {
	// Start emits frames on out until ctx is cancelled or the source ends.
	// resumeFrom is the last durably-applied Seq (0 = from scratch).
	Start(ctx context.Context, resumeFrom uint64, out chan<- Frame) error
	Kind() FrameKind
	Close() error
}

// SourceLSNAcker is an optional Capturer capability used by log-based sources
// that can acknowledge a durable source cursor after the pipeline has applied
// and checkpointed frames. Implementations must treat repeated or older LSNs as
// idempotent no-ops.
type SourceLSNAcker interface {
	AckSourceLSN(ctx context.Context, sourceLSN string) error
}
