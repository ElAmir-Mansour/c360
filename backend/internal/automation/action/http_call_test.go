package action

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/clario360/platform/internal/automation/model"
)

// noBackoff makes retries instant for tests.
func noBackoff(int) time.Duration { return 0 }

func TestHTTPCall_Success_AuthBearer(t *testing.T) {
	t.Parallel()

	var gotMethod, gotAuth, gotCT, gotCustom string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		gotCustom = r.Header.Get("X-Custom")
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	exec := NewHTTPCallExecutor(srv.Client(), nil)
	step := actionStep(model.ActionHTTPCall, map[string]any{
		"url":     srv.URL + "/hook",
		"method":  "put",
		"auth":    "bearer",
		"token":   "abc123",
		"headers": map[string]any{"X-Custom": "v1"},
		"body":    map[string]any{"x": 1},
	})

	out, err := exec.Execute(tenantCtx(), step)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if gotMethod != http.MethodPut {
		t.Errorf("method = %q, want PUT", gotMethod)
	}
	if gotAuth != "Bearer abc123" {
		t.Errorf("Authorization = %q, want Bearer abc123", gotAuth)
	}
	if gotCT != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", gotCT)
	}
	if gotCustom != "v1" {
		t.Errorf("X-Custom = %q, want v1", gotCustom)
	}
	if strings.TrimSpace(string(gotBody)) != `{"x":1}` {
		t.Errorf("body = %q, want {\"x\":1}", string(gotBody))
	}
	if out.Data["status_code"] != 200 {
		t.Errorf("status_code = %v, want 200", out.Data["status_code"])
	}
	if out.Data["attempts"] != 1 {
		t.Errorf("attempts = %v, want 1", out.Data["attempts"])
	}
}

func TestHTTPCall_AuthBasic(t *testing.T) {
	t.Parallel()
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	exec := NewHTTPCallExecutor(srv.Client(), nil)
	step := actionStep(model.ActionHTTPCall, map[string]any{
		"url": srv.URL, "method": "GET", "auth": "basic", "username": "u", "password": "p",
	})
	if _, err := exec.Execute(tenantCtx(), step); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("u:p"))
	if gotAuth != want {
		t.Errorf("Authorization = %q, want %q", gotAuth, want)
	}
}

func TestHTTPCall_AuthAPIKey(t *testing.T) {
	t.Parallel()
	var gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("X-Service-Key")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	exec := NewHTTPCallExecutor(srv.Client(), nil)
	step := actionStep(model.ActionHTTPCall, map[string]any{
		"url": srv.URL, "auth": "api_key", "api_key": "secret-k", "api_key_header": "X-Service-Key",
	})
	if _, err := exec.Execute(tenantCtx(), step); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if gotKey != "secret-k" {
		t.Errorf("X-Service-Key = %q, want secret-k", gotKey)
	}
}

func TestHTTPCall_AuthSystem_MintsTokenAndTenantHeader(t *testing.T) {
	t.Parallel()
	var gotAuth, gotTenant string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotTenant = r.Header.Get("X-Tenant-ID")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	minter := newFakeMinter("minted-system-tok")
	exec := NewHTTPCallExecutor(srv.Client(), minter)
	step := actionStep(model.ActionHTTPCall, map[string]any{"url": srv.URL, "auth": "system"})
	if _, err := exec.Execute(tenantCtx(), step); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if gotAuth != "Bearer minted-system-tok" {
		t.Errorf("Authorization = %q, want Bearer minted-system-tok", gotAuth)
	}
	if gotTenant != testTenant {
		t.Errorf("X-Tenant-ID = %q, want %q", gotTenant, testTenant)
	}
	if minter.lastTenant() != testTenant {
		t.Errorf("minted for %q, want %q", minter.lastTenant(), testTenant)
	}
}

func TestHTTPCall_AuthSystem_NoMinter(t *testing.T) {
	t.Parallel()
	exec := NewHTTPCallExecutor(http.DefaultClient, nil)
	step := actionStep(model.ActionHTTPCall, map[string]any{"url": "http://svc", "auth": "system"})
	_, err := exec.Execute(tenantCtx(), step)
	if err == nil || !strings.Contains(err.Error(), "token minter") {
		t.Fatalf("want missing-minter error, got %v", err)
	}
}

func TestHTTPCall_RetryThenSucceedOn5xx(t *testing.T) {
	t.Parallel()
	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := atomic.AddInt32(&attempts, 1)
		if n < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`done`))
	}))
	defer srv.Close()

	exec := NewHTTPCallExecutor(srv.Client(), nil)
	exec.backoff = noBackoff
	step := actionStep(model.ActionHTTPCall, map[string]any{"url": srv.URL, "method": "GET", "max_attempts": 3})

	out, err := exec.Execute(tenantCtx(), step)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if atomic.LoadInt32(&attempts) != 3 {
		t.Errorf("server hit %d times, want 3", attempts)
	}
	if out.Data["attempts"] != 3 {
		t.Errorf("recorded attempts = %v, want 3", out.Data["attempts"])
	}
}

func TestHTTPCall_ExhaustRetriesOn5xx(t *testing.T) {
	t.Parallel()
	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&attempts, 1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	exec := NewHTTPCallExecutor(srv.Client(), nil)
	exec.backoff = noBackoff
	step := actionStep(model.ActionHTTPCall, map[string]any{"url": srv.URL, "max_attempts": 2})

	_, err := exec.Execute(tenantCtx(), step)
	if err == nil || !IsRetryable(err) {
		t.Fatalf("want retryable error after exhaustion, got %v", err)
	}
	if atomic.LoadInt32(&attempts) != 2 {
		t.Errorf("server hit %d times, want 2 (max_attempts)", attempts)
	}
}

func TestHTTPCall_NoRetryOn4xx(t *testing.T) {
	t.Parallel()
	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&attempts, 1)
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`forbidden`))
	}))
	defer srv.Close()

	exec := NewHTTPCallExecutor(srv.Client(), nil)
	exec.backoff = noBackoff
	step := actionStep(model.ActionHTTPCall, map[string]any{"url": srv.URL, "max_attempts": 4})

	_, err := exec.Execute(tenantCtx(), step)
	if err == nil {
		t.Fatal("expected error on 403")
	}
	if IsRetryable(err) {
		t.Errorf("403 must NOT be retryable, got %v", err)
	}
	if atomic.LoadInt32(&attempts) != 1 {
		t.Errorf("server hit %d times, want 1 (no retry on 4xx)", attempts)
	}
}

func TestHTTPCall_MissingURL(t *testing.T) {
	t.Parallel()
	exec := NewHTTPCallExecutor(http.DefaultClient, nil)
	_, err := exec.Execute(tenantCtx(), actionStep(model.ActionHTTPCall, map[string]any{"method": "GET"}))
	if err == nil || !strings.Contains(err.Error(), "url") {
		t.Fatalf("want url error, got %v", err)
	}
}

func TestHTTPCall_BadAuthMode(t *testing.T) {
	t.Parallel()
	exec := NewHTTPCallExecutor(http.DefaultClient, nil)
	_, err := exec.Execute(tenantCtx(), actionStep(model.ActionHTTPCall, map[string]any{"url": "http://x", "auth": "oauth9"}))
	if err == nil || !strings.Contains(err.Error(), "auth") {
		t.Fatalf("want auth-mode error, got %v", err)
	}
}
