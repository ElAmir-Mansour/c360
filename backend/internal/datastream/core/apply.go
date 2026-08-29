package core

import "context"

// Applier durably applies frames to the recovery target, idempotently and in
// order. Returns the highest contiguously-applied Seq for checkpointing.
//
// The orchestrator (see pipeline.go) owns frame ordering and de-duplication, so
// an Applier sees frames in contiguous Seq order. It must nonetheless be
// idempotent on (StreamID, Seq): a duplicate delivered after a resume must be a
// safe no-op, because the network may re-deliver frames the Applier has already
// committed.
type Applier interface {
	Apply(ctx context.Context, f Frame) (appliedSeq uint64, err error)
	Kind() FrameKind
}
