package model_test

import (
	"testing"
	"time"

	"github.com/clario360/platform/internal/dr/model"
)

func TestReplicationStream_LiveRPO(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name      string
		appliedAt *time.Time
		wantRPO   time.Duration
		wantOK    bool
	}{
		{
			name:      "never applied -> not ok",
			appliedAt: nil,
			wantOK:    false,
		},
		{
			name:      "applied 90s ago -> 90s RPO",
			appliedAt: ptrTime(now.Add(-90 * time.Second)),
			wantRPO:   90 * time.Second,
			wantOK:    true,
		},
		{
			name:      "clock skew (future applied_at) floors at zero",
			appliedAt: ptrTime(now.Add(5 * time.Second)),
			wantRPO:   0,
			wantOK:    true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			s := &model.ReplicationStream{AppliedAt: tt.appliedAt}
			rpo, ok := s.LiveRPO(now)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if ok && rpo != tt.wantRPO {
				t.Errorf("rpo = %v, want %v", rpo, tt.wantRPO)
			}
		})
	}
}

func TestReplicationStream_SourceLagRPO(t *testing.T) {
	t.Parallel()
	applied := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name      string
		appliedAt *time.Time
		sourceAt  *time.Time
		wantLag   time.Duration
		wantOK    bool
	}{
		{
			name:      "never applied -> not ok",
			appliedAt: nil,
			sourceAt:  ptrTime(applied.Add(-30 * time.Second)),
			wantOK:    false,
		},
		{
			name:      "no source commit timestamp (legacy row) -> not ok",
			appliedAt: ptrTime(applied),
			sourceAt:  nil,
			wantOK:    false,
		},
		{
			name:      "committed 120s before apply -> 120s source lag",
			appliedAt: ptrTime(applied),
			sourceAt:  ptrTime(applied.Add(-120 * time.Second)),
			wantLag:   120 * time.Second,
			wantOK:    true,
		},
		{
			name:      "clock skew (source after apply) floors at zero",
			appliedAt: ptrTime(applied),
			sourceAt:  ptrTime(applied.Add(3 * time.Second)),
			wantLag:   0,
			wantOK:    true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			s := &model.ReplicationStream{AppliedAt: tt.appliedAt, SourceCommittedAt: tt.sourceAt}
			lag, ok := s.SourceLagRPO()
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if ok && lag != tt.wantLag {
				t.Errorf("lag = %v, want %v", lag, tt.wantLag)
			}
		})
	}
}

func TestFailoverRun_RTOActual(t *testing.T) {
	t.Parallel()
	initiated := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	t.Run("in-flight has no actual", func(t *testing.T) {
		run := &model.FailoverRun{InitiatedAt: initiated}
		if _, ok := run.RTOActual(); ok {
			t.Fatal("expected ok=false for in-flight run")
		}
	})

	t.Run("completed yields elapsed", func(t *testing.T) {
		completed := initiated.Add(11*time.Minute + 42*time.Second)
		run := &model.FailoverRun{InitiatedAt: initiated, CompletedAt: &completed}
		rto, ok := run.RTOActual()
		if !ok {
			t.Fatal("expected ok=true for completed run")
		}
		if want := 11*time.Minute + 42*time.Second; rto != want {
			t.Errorf("rto = %v, want %v", rto, want)
		}
	})
}

func TestFailoverRun_IsTerminal(t *testing.T) {
	t.Parallel()
	terminal := []string{model.StatusCompleted, model.StatusFailed, model.StatusCancelled, model.StatusRolledBack}
	for _, s := range terminal {
		if !(&model.FailoverRun{Status: s}).IsTerminal() {
			t.Errorf("status %q should be terminal", s)
		}
	}
	nonTerminal := []string{model.StatusInitiated, model.StatusQuiescing, model.StatusAwaitingApproval, model.StatusExecuting}
	for _, s := range nonTerminal {
		if (&model.FailoverRun{Status: s}).IsTerminal() {
			t.Errorf("status %q should NOT be terminal", s)
		}
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
