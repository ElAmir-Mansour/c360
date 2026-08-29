package gameday

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestValidScope_AndProductionGuard(t *testing.T) {
	tests := []struct {
		scope        string
		valid        bool
		isProduction bool
	}{
		{ScopeDrill, true, false},
		{ScopeNonProd, true, false},
		{ScopeProduction, false, true},
		{"", false, true},        // unknown scope fails CLOSED (treated as production)
		{"staging", false, true}, // any non-allowed scope is unsafe
	}
	for _, tt := range tests {
		if got := ValidScope(tt.scope); got != tt.valid {
			t.Errorf("ValidScope(%q) = %v, want %v", tt.scope, got, tt.valid)
		}
		if got := IsProductionScope(tt.scope); got != tt.isProduction {
			t.Errorf("IsProductionScope(%q) = %v, want %v", tt.scope, got, tt.isProduction)
		}
	}
}

func TestScenarioValidate(t *testing.T) {
	tests := []struct {
		name    string
		sc      Scenario
		wantErr error
	}{
		{
			name: "ok",
			sc:   Scenario{Scope: ScopeDrill, Steps: []Step{{Action: ActionPauseStream}}},
		},
		{
			name:    "production scope rejected",
			sc:      Scenario{Scope: ScopeProduction, Steps: []Step{{Action: ActionPauseStream}}},
			wantErr: ErrProductionScope,
		},
		{
			name:    "unknown scope rejected",
			sc:      Scenario{Scope: "weird", Steps: []Step{{Action: ActionPauseStream}}},
			wantErr: ErrInvalidScope,
		},
		{
			name:    "no steps rejected",
			sc:      Scenario{Scope: ScopeDrill},
			wantErr: ErrNoSteps,
		},
		{
			name:    "invalid action rejected",
			sc:      Scenario{Scope: ScopeDrill, Steps: []Step{{Action: "frobnicate"}}},
			wantErr: ErrInvalidAction,
		},
	}
	for _, tt := range tests {
		err := tt.sc.Validate()
		if tt.wantErr == nil {
			if err != nil {
				t.Errorf("%s: Validate() = %v, want nil", tt.name, err)
			}
			continue
		}
		if !errors.Is(err, tt.wantErr) {
			t.Errorf("%s: Validate() = %v, want %v", tt.name, err, tt.wantErr)
		}
	}
}

func TestExpectationHasDetectionRecovery(t *testing.T) {
	e := Expectation{Signal: "lag_alert", DetectWithin: Duration(30 * time.Second)}
	if !e.HasDetection() {
		t.Fatal("HasDetection() = false, want true")
	}
	if e.HasRecovery() {
		t.Fatal("HasRecovery() = true, want false (no recover_within)")
	}
	e.RecoverWithin = Duration(time.Minute)
	if !e.HasRecovery() {
		t.Fatal("HasRecovery() = false, want true")
	}
	// No signal -> neither.
	none := Expectation{DetectWithin: Duration(time.Second)}
	if none.HasDetection() || none.HasRecovery() {
		t.Fatal("expectation without a signal must score nothing")
	}
}

func TestScoreRatio(t *testing.T) {
	cases := []struct {
		passed, total int
		want          float64
	}{
		{0, 0, 0},
		{1, 1, 1},
		{3, 4, 0.75},
		{0, 5, 0},
	}
	for _, c := range cases {
		if got := scoreRatio(c.passed, c.total); got != c.want {
			t.Errorf("scoreRatio(%d,%d) = %v, want %v", c.passed, c.total, got, c.want)
		}
	}
}

func TestRunIsTerminal(t *testing.T) {
	for _, s := range []string{RunStatusPassed, RunStatusFailed, RunStatusAborted} {
		if !(Run{Status: s}).IsTerminal() {
			t.Errorf("%q should be terminal", s)
		}
	}
	for _, s := range []string{RunStatusPending, RunStatusRunning} {
		if (Run{Status: s}).IsTerminal() {
			t.Errorf("%q should NOT be terminal", s)
		}
	}
}

func TestDurationJSONRoundTrip(t *testing.T) {
	type wrap struct {
		D Duration `json:"d"`
	}
	// Marshal renders a Go duration string.
	out, err := json.Marshal(wrap{D: Duration(90 * time.Second)})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(out) != `{"d":"1m30s"}` {
		t.Fatalf("marshaled = %s, want {\"d\":\"1m30s\"}", out)
	}

	// Unmarshal accepts a duration string.
	var w wrap
	if err := json.Unmarshal([]byte(`{"d":"45s"}`), &w); err != nil {
		t.Fatalf("unmarshal string: %v", err)
	}
	if w.D.Std() != 45*time.Second {
		t.Fatalf("string decode = %v, want 45s", w.D.Std())
	}

	// Unmarshal accepts a bare nanosecond number.
	var w2 wrap
	if err := json.Unmarshal([]byte(`{"d":1000000000}`), &w2); err != nil {
		t.Fatalf("unmarshal number: %v", err)
	}
	if w2.D.Std() != time.Second {
		t.Fatalf("number decode = %v, want 1s", w2.D.Std())
	}

	// Empty string / null -> zero.
	var w3 wrap
	if err := json.Unmarshal([]byte(`{"d":""}`), &w3); err != nil {
		t.Fatalf("unmarshal empty: %v", err)
	}
	if w3.D.Std() != 0 {
		t.Fatalf("empty decode = %v, want 0", w3.D.Std())
	}

	// Bad duration string -> error.
	var w4 wrap
	if err := json.Unmarshal([]byte(`{"d":"not-a-duration"}`), &w4); err == nil {
		t.Fatal("expected error decoding a bad duration string")
	}
}
