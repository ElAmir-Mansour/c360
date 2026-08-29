package failback

import (
	"context"
	"errors"
	"testing"
)

func TestDeltaTracker_Measure_ConvergenceMath(t *testing.T) {
	tests := []struct {
		name           string
		threshold      int64
		probe          ReverseStreamProbe
		wantBytes      int64
		wantSeq        int64
		wantConverged  bool
		wantSourceLSN  string
		wantAppliedLSN string
		wantWindow     bool
	}{
		{
			name:      "over threshold with window open is not converged",
			threshold: 1024,
			probe: ReverseStreamProbe{
				HeadSeq: 100, AppliedSeq: 40,
				HeadLSN: "0/A00", AppliedLSN: "0/400",
				BytesPending: 4096, CutoverWindowOpen: true,
			},
			wantBytes: 4096, wantSeq: 60, wantConverged: false,
			wantSourceLSN: "0/A00", wantAppliedLSN: "0/400", wantWindow: true,
		},
		{
			name:      "at threshold with window open is converged",
			threshold: 4096,
			probe: ReverseStreamProbe{
				HeadSeq: 100, AppliedSeq: 90,
				HeadLSN: "0/A00", AppliedLSN: "0/980",
				BytesPending: 4096, CutoverWindowOpen: true,
			},
			wantBytes: 4096, wantSeq: 10, wantConverged: true,
			wantSourceLSN: "0/A00", wantAppliedLSN: "0/980", wantWindow: true,
		},
		{
			name:      "under threshold but window CLOSED is not converged",
			threshold: 4096,
			probe: ReverseStreamProbe{
				HeadSeq: 100, AppliedSeq: 99,
				HeadLSN: "0/A00", AppliedLSN: "0/9F0",
				BytesPending: 100, CutoverWindowOpen: false,
			},
			wantBytes: 100, wantSeq: 1, wantConverged: false,
			wantSourceLSN: "0/A00", wantAppliedLSN: "0/9F0", wantWindow: false,
		},
		{
			name:      "fully drained with zero threshold is converged",
			threshold: 0,
			probe: ReverseStreamProbe{
				HeadSeq: 100, AppliedSeq: 100,
				HeadLSN: "0/A00", AppliedLSN: "0/A00",
				BytesPending: 0, CutoverWindowOpen: true,
			},
			wantBytes: 0, wantSeq: 0, wantConverged: true,
			wantSourceLSN: "0/A00", wantAppliedLSN: "0/A00", wantWindow: true,
		},
		{
			name:      "zero threshold with residual bytes is NOT converged",
			threshold: 0,
			probe: ReverseStreamProbe{
				HeadSeq: 100, AppliedSeq: 99,
				HeadLSN: "0/A00", AppliedLSN: "0/9F0",
				BytesPending: 64, CutoverWindowOpen: true,
			},
			wantBytes: 64, wantSeq: 1, wantConverged: false,
			wantSourceLSN: "0/A00", wantAppliedLSN: "0/9F0", wantWindow: true,
		},
		{
			name:      "applied caught up to head reconciles stale byte backlog to zero",
			threshold: 0,
			probe: ReverseStreamProbe{
				HeadSeq: 50, AppliedSeq: 50,
				HeadLSN: "0/500", AppliedLSN: "0/500",
				BytesPending: 999, CutoverWindowOpen: true,
			},
			wantBytes: 0, wantSeq: 0, wantConverged: true,
			wantSourceLSN: "0/500", wantAppliedLSN: "0/500", wantWindow: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tracker, err := NewDeltaTracker(fakeProber{probe: tc.probe})
			if err != nil {
				t.Fatalf("NewDeltaTracker: %v", err)
			}
			run := &FailbackRun{ConvergeThresholdBytes: tc.threshold}
			got, err := tracker.Measure(context.Background(), run, "reverse-1")
			if err != nil {
				t.Fatalf("Measure: %v", err)
			}
			if got.BytesRemaining != tc.wantBytes {
				t.Errorf("BytesRemaining = %d, want %d", got.BytesRemaining, tc.wantBytes)
			}
			if got.SeqRemaining != tc.wantSeq {
				t.Errorf("SeqRemaining = %d, want %d", got.SeqRemaining, tc.wantSeq)
			}
			if got.Converged != tc.wantConverged {
				t.Errorf("Converged = %v, want %v", got.Converged, tc.wantConverged)
			}
			if got.SourceLSN != tc.wantSourceLSN {
				t.Errorf("SourceLSN = %q, want %q", got.SourceLSN, tc.wantSourceLSN)
			}
			if got.AppliedLSN != tc.wantAppliedLSN {
				t.Errorf("AppliedLSN = %q, want %q", got.AppliedLSN, tc.wantAppliedLSN)
			}
			if got.CutoverWindowOpen != tc.wantWindow {
				t.Errorf("CutoverWindowOpen = %v, want %v", got.CutoverWindowOpen, tc.wantWindow)
			}
		})
	}
}

func TestDeltaTracker_Measure_NegativeBacklogClampedAndAppliedAheadOfHead(t *testing.T) {
	// A transient out-of-order probe where the apply cursor leads the head must
	// not yield a negative remaining; it clamps to zero.
	tracker, err := NewDeltaTracker(fakeProber{probe: ReverseStreamProbe{
		HeadSeq: 10, AppliedSeq: 20, BytesPending: -5, CutoverWindowOpen: true,
	}})
	if err != nil {
		t.Fatalf("NewDeltaTracker: %v", err)
	}
	got, err := tracker.Measure(context.Background(), &FailbackRun{ConvergeThresholdBytes: 0}, "s")
	if err != nil {
		t.Fatalf("Measure: %v", err)
	}
	if got.SeqRemaining != 0 || got.BytesRemaining != 0 {
		t.Fatalf("clamp failed: seq=%d bytes=%d", got.SeqRemaining, got.BytesRemaining)
	}
	if !got.Converged {
		t.Fatalf("fully-drained clamped backlog should be converged")
	}
}

func TestDeltaTracker_Measure_ProbeErrorPropagates(t *testing.T) {
	tracker, err := NewDeltaTracker(fakeProber{err: errBoom})
	if err != nil {
		t.Fatalf("NewDeltaTracker: %v", err)
	}
	if _, err := tracker.Measure(context.Background(), &FailbackRun{}, "s"); err == nil {
		t.Fatal("expected probe error")
	} else if !errors.Is(err, errBoom) {
		t.Fatalf("error = %v, want wrapped boom", err)
	}
}

func TestDeltaTracker_Measure_EmptyStreamIDRejected(t *testing.T) {
	tracker, err := NewDeltaTracker(fakeProber{})
	if err != nil {
		t.Fatalf("NewDeltaTracker: %v", err)
	}
	if _, err := tracker.Measure(context.Background(), &FailbackRun{}, ""); !errors.Is(err, ErrValidation) {
		t.Fatalf("error = %v, want ErrValidation", err)
	}
}

func TestNewDeltaTracker_NilProberRejected(t *testing.T) {
	if _, err := NewDeltaTracker(nil); err == nil {
		t.Fatal("expected error for nil prober")
	}
}
