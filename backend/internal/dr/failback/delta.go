package failback

import (
	"context"
	"fmt"

	"github.com/clario360/platform/internal/datastream/core"
)

// ReverseStreamProbe reports the live state of a reverse replication stream (DR
// site -> original primary). The DeltaTracker uses it to compute the backlog
// still to be shipped before the restored primary has caught up to the DR head.
//
// HeadSeq/HeadLSN are the highest frame the DR-side capturer has produced;
// AppliedSeq/AppliedLSN are the highest frame durably applied at the primary.
// BytesPending is the un-applied byte backlog (sum of payload bytes for frames in
// (AppliedSeq, HeadSeq]). CutoverWindowOpen reports whether DR-side writes have
// been quiesced / a maintenance window opened so the head will stop advancing —
// without it, "remaining <= threshold" can flap forever as new writes land.
type ReverseStreamProbe struct {
	StreamID          string
	HeadSeq           uint64
	AppliedSeq        uint64
	HeadLSN           string
	AppliedLSN        string
	BytesPending      int64
	CutoverWindowOpen bool
}

// ReverseStreamProber measures the live reverse-stream backlog. In production it
// is backed by the core pipeline's checkpoint (AppliedSeq/AppliedLSN) and the
// capturer head (HeadSeq/HeadLSN); in tests a fake prober drives the convergence
// math deterministically.
type ReverseStreamProber interface {
	Probe(ctx context.Context, streamID string) (ReverseStreamProbe, error)
}

// DeltaMeasurement is the DeltaTracker's verdict for one tick: the remaining
// backlog and whether the run may declare DELTA_CONVERGED.
type DeltaMeasurement struct {
	BytesRemaining    int64
	SeqRemaining      int64
	SourceLSN         string // the DR-side head LSN (reverse stream source)
	AppliedLSN        string // the primary-side applied LSN
	CutoverWindowOpen bool
	// Converged is true only when BytesRemaining <= threshold AND the cutover
	// window is open. It is the single gate the driver checks before declaring
	// DELTA_CONVERGED — never a fabricated always-true.
	Converged bool
}

// DeltaTracker computes the bytes/LSN remaining to converge on the reverse stream
// and decides convergence against a configurable threshold. It is deliberately
// stateless: each Measure call reads the live probe and the run's threshold, so a
// driver restart recomputes from durable state with no in-memory assumptions.
type DeltaTracker struct {
	prober ReverseStreamProber
}

// NewDeltaTracker wires a tracker over a reverse-stream prober.
func NewDeltaTracker(prober ReverseStreamProber) (*DeltaTracker, error) {
	if prober == nil {
		return nil, fmt.Errorf("failback: delta tracker requires a reverse-stream prober")
	}
	return &DeltaTracker{prober: prober}, nil
}

// Measure probes the reverse stream for run and computes the remaining backlog
// and convergence verdict against the run's configured threshold.
//
// SeqRemaining = HeadSeq - AppliedSeq (clamped at 0: AppliedSeq can never lead the
// head, but a transient out-of-order probe must not produce a negative). The byte
// backlog comes from the probe (real payload bytes still to apply). Convergence
// requires BOTH conditions:
//
//  1. BytesRemaining <= run.ConvergeThresholdBytes — the data window is small
//     enough that cutting back loses at most threshold bytes; and
//  2. the cutover window is open — DR-side writes are quiesced so the head will
//     not keep moving and the small window will actually drain to zero.
//
// A threshold of 0 demands the backlog be fully drained (the strictest, zero-loss
// convergence). This is the real delta math, validated by unit tests at and over
// the threshold and with the window closed.
func (t *DeltaTracker) Measure(ctx context.Context, run *FailbackRun, streamID string) (DeltaMeasurement, error) {
	if streamID == "" {
		return DeltaMeasurement{}, fmt.Errorf("failback: delta measure requires a stream id: %w", ErrValidation)
	}
	probe, err := t.prober.Probe(ctx, streamID)
	if err != nil {
		return DeltaMeasurement{}, fmt.Errorf("failback: probing reverse stream %s: %w", streamID, err)
	}

	var seqRemaining int64
	if probe.HeadSeq > probe.AppliedSeq {
		seqRemaining = int64(probe.HeadSeq - probe.AppliedSeq)
	}
	bytesRemaining := probe.BytesPending
	if bytesRemaining < 0 {
		bytesRemaining = 0
	}
	// When the apply cursor has fully caught up to the head, no bytes remain even
	// if the probe reports a stale BytesPending; reconcile the two so a fully
	// drained stream is unambiguously converged.
	if seqRemaining == 0 {
		bytesRemaining = 0
	}

	threshold := run.ConvergeThresholdBytes
	if threshold < 0 {
		threshold = 0
	}
	converged := probe.CutoverWindowOpen && bytesRemaining <= threshold

	return DeltaMeasurement{
		BytesRemaining:    bytesRemaining,
		SeqRemaining:      seqRemaining,
		SourceLSN:         probe.HeadLSN,
		AppliedLSN:        probe.AppliedLSN,
		CutoverWindowOpen: probe.CutoverWindowOpen,
		Converged:         converged,
	}, nil
}

// CheckpointProber adapts a core.Checkpointer + a head-LSN source into a
// ReverseStreamProber, so the reverse stream's applied cursor is read from the
// real RPO ledger (core.Checkpoint.AppliedSeq/SourceLSN) rather than a fabricated
// value. The HeadFn supplies the DR-side capturer head (the authoritative source
// position) and the quiesce window state; in the agentless control-plane path the
// head is the reverse pipeline's last emitted frame.
type CheckpointProber struct {
	checkpointer core.Checkpointer
	headFn       func(ctx context.Context, streamID string) (Head, error)
}

// Head is the DR-side reverse-stream head: the highest frame produced and the
// byte/quiesce state needed to compute the backlog ahead of the applied cursor.
type Head struct {
	HeadSeq           uint64
	HeadLSN           string
	BytesPending      int64
	CutoverWindowOpen bool
}

// NewCheckpointProber wires a prober over the reverse stream's checkpointer and a
// head source.
func NewCheckpointProber(cp core.Checkpointer, headFn func(ctx context.Context, streamID string) (Head, error)) (*CheckpointProber, error) {
	if cp == nil {
		return nil, fmt.Errorf("failback: checkpoint prober requires a checkpointer")
	}
	if headFn == nil {
		return nil, fmt.Errorf("failback: checkpoint prober requires a head source")
	}
	return &CheckpointProber{checkpointer: cp, headFn: headFn}, nil
}

// Probe reads the applied cursor from the reverse stream's durable checkpoint and
// the head from the head source, producing a backlog measurement.
func (p *CheckpointProber) Probe(ctx context.Context, streamID string) (ReverseStreamProbe, error) {
	cp, err := p.checkpointer.Load(ctx, streamID)
	if err != nil {
		return ReverseStreamProbe{}, fmt.Errorf("loading reverse checkpoint %s: %w", streamID, err)
	}
	head, err := p.headFn(ctx, streamID)
	if err != nil {
		return ReverseStreamProbe{}, fmt.Errorf("reading reverse head %s: %w", streamID, err)
	}
	return ReverseStreamProbe{
		StreamID:          streamID,
		HeadSeq:           head.HeadSeq,
		AppliedSeq:        cp.AppliedSeq,
		HeadLSN:           head.HeadLSN,
		AppliedLSN:        cp.SourceLSN,
		BytesPending:      head.BytesPending,
		CutoverWindowOpen: head.CutoverWindowOpen,
	}, nil
}
