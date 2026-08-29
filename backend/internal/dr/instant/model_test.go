package instant

import "testing"

func TestCanTransition(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		from    string
		to      string
		allowed bool
	}{
		{"hydrating->ready", StateHydrating, StateReady, true},
		{"hydrating->failed", StateHydrating, StateFailed, true},
		{"ready->finalizing", StateReady, StateFinalizing, true},
		{"ready->failed", StateReady, StateFailed, true},
		{"finalizing->finalized", StateFinalizing, StateFinalized, true},
		{"finalizing->failed", StateFinalizing, StateFailed, true},

		// Illegal transitions.
		{"hydrating->finalizing (skips ready)", StateHydrating, StateFinalizing, false},
		{"hydrating->finalized", StateHydrating, StateFinalized, false},
		{"ready->finalized (skips finalizing)", StateReady, StateFinalized, false},
		{"ready->hydrating (backward)", StateReady, StateHydrating, false},
		{"finalizing->ready (backward)", StateFinalizing, StateReady, false},
		{"finalized->anything (terminal)", StateFinalized, StateReady, false},
		{"finalized->finalizing (terminal)", StateFinalized, StateFinalizing, false},
		{"failed->anything (terminal)", StateFailed, StateHydrating, false},
		{"failed->ready (terminal)", StateFailed, StateReady, false},

		// A no-op is not a transition.
		{"hydrating->hydrating (no-op)", StateHydrating, StateHydrating, false},
		{"ready->ready (no-op)", StateReady, StateReady, false},

		// Unknown states.
		{"unknown from", "BOGUS", StateReady, false},
		{"unknown to", StateHydrating, "BOGUS", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := CanTransition(tc.from, tc.to); got != tc.allowed {
				t.Fatalf("CanTransition(%q,%q) = %v, want %v", tc.from, tc.to, got, tc.allowed)
			}
		})
	}
}

func TestIsTerminal(t *testing.T) {
	t.Parallel()
	cases := map[string]bool{
		StateHydrating:  false,
		StateReady:      false,
		StateFinalizing: false,
		StateFinalized:  true,
		StateFailed:     true,
	}
	for state, want := range cases {
		if got := IsTerminal(state); got != want {
			t.Fatalf("IsTerminal(%q) = %v, want %v", state, got, want)
		}
	}
}

func TestSessionPercentComplete(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		total   int
		done    int
		wantPct float64
	}{
		{"zero total reports complete", 0, 0, 100},
		{"none done", 10, 0, 0},
		{"half done", 10, 5, 50},
		{"all done", 8, 8, 100},
		{"over-count clamps to 100", 4, 9, 100},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := &Session{ChunksTotal: tc.total, ChunksHydrated: tc.done}
			if got := s.PercentComplete(); got != tc.wantPct {
				t.Fatalf("PercentComplete(total=%d done=%d) = %v, want %v", tc.total, tc.done, got, tc.wantPct)
			}
			complete := tc.total > 0 && tc.done >= tc.total
			if got := s.HydrationComplete(); got != complete {
				t.Fatalf("HydrationComplete = %v, want %v", got, complete)
			}
		})
	}
}
