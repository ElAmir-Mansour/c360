package appconsistent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestScriptQuiesceProvider_Quiesce exercises the REAL os/exec path: a successful
// command (exit 0) is a clean quiesce; a failing command (exit non-zero) is
// ErrQuiesceFailed with captured output.
func TestScriptQuiesceProvider_Quiesce(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("script provider test uses /bin/sh")
	}
	tests := []struct {
		name       string
		freezeCmd  string
		wantErr    bool
		wantOutput string
	}{
		{
			name:      "true succeeds",
			freezeCmd: "true",
			wantErr:   false,
		},
		{
			name:       "echo succeeds and captures stdout",
			freezeCmd:  "echo frozen",
			wantErr:    false,
			wantOutput: "frozen",
		},
		{
			name:       "extracts marker lsn",
			freezeCmd:  "echo frozen; echo CLARIO_MARKER_LSN=0/16B3748",
			wantErr:    false,
			wantOutput: "frozen",
		},
		{
			name:      "false fails",
			freezeCmd: "false",
			wantErr:   true,
		},
		{
			name:       "exit 3 fails with captured stderr",
			freezeCmd:  "echo 'cannot freeze: device busy' 1>&2; exit 3",
			wantErr:    true,
			wantOutput: "cannot freeze: device busy",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := &ScriptQuiesceProvider{
				FreezeCmd: tc.freezeCmd,
				ThawCmd:   "true",
				Timeout:   5 * time.Second,
			}
			res, err := p.Quiesce(context.Background())
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (output=%q)", res.Output)
				}
				if !errors.Is(err, ErrQuiesceFailed) {
					t.Fatalf("expected ErrQuiesceFailed, got %v", err)
				}
			} else if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.wantOutput != "" && !strings.Contains(res.Output, tc.wantOutput) {
				t.Fatalf("output %q does not contain %q", res.Output, tc.wantOutput)
			}
			if tc.name == "extracts marker lsn" && res.MarkerLSN != "0/16B3748" {
				t.Fatalf("marker LSN = %q, want 0/16B3748", res.MarkerLSN)
			}
			if p.Kind() != ProviderScript {
				t.Fatalf("Kind() = %q, want %q", p.Kind(), ProviderScript)
			}
		})
	}
}

// TestScriptQuiesceProvider_Thaw verifies the REAL thaw command path: a clean
// exit thaws, a non-zero exit is ErrThawFailed.
func TestScriptQuiesceProvider_Thaw(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("script provider test uses /bin/sh")
	}
	t.Run("thaw succeeds", func(t *testing.T) {
		p := &ScriptQuiesceProvider{FreezeCmd: "true", ThawCmd: "echo unfrozen", Timeout: 5 * time.Second}
		res, err := p.Thaw(context.Background(), QuiesceResult{})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(res.Output, "unfrozen") {
			t.Fatalf("output %q does not contain %q", res.Output, "unfrozen")
		}
	})
	t.Run("thaw fails", func(t *testing.T) {
		p := &ScriptQuiesceProvider{FreezeCmd: "true", ThawCmd: "exit 1", Timeout: 5 * time.Second}
		_, err := p.Thaw(context.Background(), QuiesceResult{})
		if !errors.Is(err, ErrThawFailed) {
			t.Fatalf("expected ErrThawFailed, got %v", err)
		}
	})
}

// TestScriptQuiesceProvider_Timeout verifies a hanging command is killed at the
// timeout and reported as a failed quiesce.
func TestScriptQuiesceProvider_Timeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("script provider test uses /bin/sh")
	}
	p := &ScriptQuiesceProvider{FreezeCmd: "sleep 5", ThawCmd: "true", Timeout: 100 * time.Millisecond}
	start := time.Now()
	_, err := p.Quiesce(context.Background())
	elapsed := time.Since(start)
	if !errors.Is(err, ErrQuiesceFailed) {
		t.Fatalf("expected ErrQuiesceFailed on timeout, got %v", err)
	}
	if elapsed > 3*time.Second {
		t.Fatalf("command was not killed promptly: %s", elapsed)
	}
}

// TestScriptQuiesceProvider_EmptyCommands rejects unconfigured commands.
func TestScriptQuiesceProvider_EmptyCommands(t *testing.T) {
	p := &ScriptQuiesceProvider{}
	if _, err := p.Quiesce(context.Background()); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty freeze: expected ErrInvalidInput, got %v", err)
	}
	if _, err := p.Thaw(context.Background(), QuiesceResult{}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty thaw: expected ErrInvalidInput, got %v", err)
	}
}

// TestHTTPQuiesceProvider drives a REAL httptest server implementing the agent
// webhook: /quiesce issues a barrier token, /thaw must echo it back.
func TestHTTPQuiesceProvider(t *testing.T) {
	const wantToken = "barrier-token-abc123"

	var (
		mu          sync.Mutex
		quiesced    bool
		thawedToken string
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req quiesceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/quiesce":
			quiesced = true
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(quiesceResponse{BarrierToken: wantToken, MarkerLSN: "0/16B3748", Message: "frozen"})
		case "/thaw":
			thawedToken = req.BarrierToken
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(quiesceResponse{Message: "thawed"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	p := &HTTPQuiesceProvider{BaseURL: srv.URL, Timeout: 5 * time.Second}
	if p.Kind() != ProviderHTTP {
		t.Fatalf("Kind() = %q, want %q", p.Kind(), ProviderHTTP)
	}

	qres, err := p.Quiesce(context.Background())
	if err != nil {
		t.Fatalf("quiesce: %v", err)
	}
	if qres.BarrierToken != wantToken {
		t.Fatalf("barrier token = %q, want %q", qres.BarrierToken, wantToken)
	}
	if qres.MarkerLSN != "0/16B3748" {
		t.Fatalf("marker LSN = %q, want 0/16B3748", qres.MarkerLSN)
	}
	if !strings.Contains(qres.Output, "frozen") {
		t.Fatalf("quiesce output = %q, want it to contain %q", qres.Output, "frozen")
	}

	if _, err := p.Thaw(context.Background(), qres); err != nil {
		t.Fatalf("thaw: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if !quiesced {
		t.Fatal("agent never received quiesce")
	}
	if thawedToken != wantToken {
		t.Fatalf("thaw echoed token %q, want %q", thawedToken, wantToken)
	}
}

// TestHTTPQuiesceProvider_QuiesceFailure verifies a non-2xx agent response is a
// failed quiesce carrying the captured body.
func TestHTTPQuiesceProvider_QuiesceFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "workload not ready to freeze", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	p := &HTTPQuiesceProvider{BaseURL: srv.URL, Timeout: 5 * time.Second}
	res, err := p.Quiesce(context.Background())
	if !errors.Is(err, ErrQuiesceFailed) {
		t.Fatalf("expected ErrQuiesceFailed, got %v", err)
	}
	if !strings.Contains(res.Output, "workload not ready") {
		t.Fatalf("output %q does not contain agent body", res.Output)
	}
}

// TestHTTPQuiesceProvider_ThawFailure verifies a non-2xx /thaw response is
// ErrThawFailed.
func TestHTTPQuiesceProvider_ThawFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/quiesce" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(quiesceResponse{BarrierToken: "tok"})
			return
		}
		http.Error(w, "thaw refused", http.StatusInternalServerError)
	}))
	defer srv.Close()

	p := &HTTPQuiesceProvider{BaseURL: srv.URL, Timeout: 5 * time.Second}
	qres, err := p.Quiesce(context.Background())
	if err != nil {
		t.Fatalf("quiesce: %v", err)
	}
	if _, err := p.Thaw(context.Background(), qres); !errors.Is(err, ErrThawFailed) {
		t.Fatalf("expected ErrThawFailed, got %v", err)
	}
}

// TestHTTPQuiesceProvider_AuthHeader verifies the bearer token is sent.
func TestHTTPQuiesceProvider_AuthHeader(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(quiesceResponse{BarrierToken: "tok"})
	}))
	defer srv.Close()

	p := &HTTPQuiesceProvider{BaseURL: srv.URL, AuthToken: "s3cret", Timeout: 5 * time.Second}
	if _, err := p.Quiesce(context.Background()); err != nil {
		t.Fatalf("quiesce: %v", err)
	}
	if gotAuth != "Bearer s3cret" {
		t.Fatalf("Authorization = %q, want %q", gotAuth, "Bearer s3cret")
	}
}

// TestHTTPQuiesceProvider_EmptyBaseURL rejects an unconfigured provider.
func TestHTTPQuiesceProvider_EmptyBaseURL(t *testing.T) {
	p := &HTTPQuiesceProvider{}
	if _, err := p.Quiesce(context.Background()); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}
