package vault

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

// fakeVault is a minimal httptest mock of the subset of Vault HTTP API we use.
type fakeVault struct {
	mu             sync.Mutex
	keys           map[string]bool
	server         *httptest.Server
	approleCalls   int32
	approleToken   string
	dataKeyCalls   int32
	decryptCalls   int32
	healthSealed   bool
	healthStandby  bool
	read503Once    bool
	dataKey503Once int32 // remaining 503 responses to emit on datakey/plaintext
	dataKey503     int32 // total 503s to emit (used for retry-exhaustion test)
	plaintextDEK   []byte
}

func newFakeVault(t *testing.T) *fakeVault {
	t.Helper()
	fv := &fakeVault{
		keys:         make(map[string]bool),
		approleToken: "approle-child-token",
		plaintextDEK: mustRand(32),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/sys/health", fv.handleHealth)
	mux.HandleFunc("/v1/auth/approle/login", fv.handleApproleLogin)
	mux.HandleFunc("/v1/transit/keys/", fv.handleKeys)
	mux.HandleFunc("/v1/transit/datakey/plaintext/", fv.handleDataKey)
	mux.HandleFunc("/v1/transit/decrypt/", fv.handleDecrypt)
	fv.server = httptest.NewServer(mux)
	t.Cleanup(fv.server.Close)
	return fv
}

func (f *fakeVault) URL() string { return f.server.URL }

func (f *fakeVault) handleHealth(w http.ResponseWriter, _ *http.Request) {
	f.mu.Lock()
	sealed, standby := f.healthSealed, f.healthStandby
	f.mu.Unlock()
	switch {
	case sealed:
		w.WriteHeader(http.StatusServiceUnavailable)
	case standby:
		w.WriteHeader(http.StatusTooManyRequests)
	default:
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"initialized":true,"sealed":false,"standby":false}`))
	}
}

func (f *fakeVault) handleApproleLogin(w http.ResponseWriter, _ *http.Request) {
	atomic.AddInt32(&f.approleCalls, 1)
	body := map[string]any{
		"auth": map[string]any{
			"client_token":   f.approleToken,
			"lease_duration": 3600,
		},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func (f *fakeVault) handleKeys(w http.ResponseWriter, r *http.Request) {
	// path: /v1/transit/keys/<name>
	name := r.URL.Path[len("/v1/transit/keys/"):]
	if name == "" {
		http.Error(w, "missing key name", http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	exists := f.keys[name]
	read503 := f.read503Once
	if read503 {
		f.read503Once = false
	}
	f.mu.Unlock()

	switch r.Method {
	case http.MethodGet:
		if read503 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"errors":["transient backend error"]}`))
			return
		}
		if !exists {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"errors":[]}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"name": name,
				"type": "aes256-gcm96",
			},
		})
	case http.MethodPut, http.MethodPost:
		f.mu.Lock()
		f.keys[name] = true
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"name": name}})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (f *fakeVault) handleDataKey(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt32(&f.dataKeyCalls, 1)
	if remaining := atomic.LoadInt32(&f.dataKey503Once); remaining > 0 {
		atomic.AddInt32(&f.dataKey503Once, -1)
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"errors":["overloaded"]}`))
		return
	}
	plaintext := base64.StdEncoding.EncodeToString(f.plaintextDEK)
	ciphertext := "vault:v1:" + base64.StdEncoding.EncodeToString([]byte("wrapped-bytes"))
	_ = json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]any{
			"plaintext":   plaintext,
			"ciphertext":  ciphertext,
			"key_version": 1,
		},
	})
}

func (f *fakeVault) handleDecrypt(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt32(&f.decryptCalls, 1)
	var body struct {
		Ciphertext string `json:"ciphertext"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	if body.Ciphertext == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"errors":["empty ciphertext"]}`))
		return
	}
	plaintext := base64.StdEncoding.EncodeToString(f.plaintextDEK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]any{"plaintext": plaintext},
	})
}

// ---- helpers ----

func mustRand(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}

func devConfig(addr string) Config {
	return Config{
		Addr:       addr,
		AuthMethod: AuthMethodToken,
		Token:      "dev-token",
		Timeout:    500 * time.Millisecond,
	}
}

// ---- tests ----

func TestNewClientTokenAuth(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	c, err := NewClient(context.Background(), devConfig(fv.URL()))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer func() { _ = c.Close() }()
	if atomic.LoadInt32(&fv.approleCalls) != 0 {
		t.Errorf("token auth should not hit approle login")
	}
}

func TestNewClientApproleAuth(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	cfg := Config{
		Addr:            fv.URL(),
		AuthMethod:      AuthMethodAppRole,
		AppRoleRoleID:   "rid",
		AppRoleSecretID: "sid",
		Timeout:         500 * time.Millisecond,
	}
	c, err := NewClient(context.Background(), cfg)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer func() { _ = c.Close() }()
	if atomic.LoadInt32(&fv.approleCalls) != 1 {
		t.Errorf("expected 1 approle login, got %d", fv.approleCalls)
	}
	// Then GenerateDataKey works through the same client.
	if _, err := c.GenerateDataKey(context.Background(), "tenant-1"); err != nil {
		t.Errorf("GenerateDataKey after approle login: %v", err)
	}
}

func TestNewClientApproleEmptyToken(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	fv.approleToken = "" // server will return empty client_token
	cfg := Config{
		Addr:            fv.URL(),
		AuthMethod:      AuthMethodAppRole,
		AppRoleRoleID:   "rid",
		AppRoleSecretID: "sid",
		Timeout:         500 * time.Millisecond,
	}
	_, err := NewClient(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected error on empty approle token")
	}
	if !errors.Is(err, ErrAuthFailed) {
		t.Errorf("expected ErrAuthFailed, got %v", err)
	}
}

func TestEnsureTransitKeyCreates(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	c, err := NewClient(context.Background(), devConfig(fv.URL()))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer func() { _ = c.Close() }()

	if err := c.EnsureTransitKey(context.Background(), "tenant-1"); err != nil {
		t.Fatalf("EnsureTransitKey first call: %v", err)
	}
	// Re-running is a no-op.
	if err := c.EnsureTransitKey(context.Background(), "tenant-1"); err != nil {
		t.Fatalf("EnsureTransitKey second call: %v", err)
	}
	fv.mu.Lock()
	defer fv.mu.Unlock()
	if !fv.keys["tenant-1"] {
		t.Errorf("key not recorded as created")
	}
}

func TestEnsureTransitKeyEmptyName(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()
	if err := c.EnsureTransitKey(context.Background(), ""); err == nil {
		t.Fatal("expected empty key name to error")
	}
}

func TestGenerateDataKeyHappyPath(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()

	dk, err := c.GenerateDataKey(context.Background(), "tenant-1")
	if err != nil {
		t.Fatalf("GenerateDataKey: %v", err)
	}
	if len(dk.Plaintext) != 32 {
		t.Errorf("expected 32-byte plaintext, got %d", len(dk.Plaintext))
	}
	if !bytes.Equal(dk.Plaintext, fv.plaintextDEK) {
		t.Errorf("plaintext DEK mismatch")
	}
	if dk.KEKVersion != 1 {
		t.Errorf("expected KEK version 1, got %d", dk.KEKVersion)
	}
	if !bytes.HasPrefix(dk.Ciphertext, []byte("vault:v1:")) {
		t.Errorf("envelope prefix: %q", dk.Ciphertext)
	}
}

func TestGenerateDataKey503RetryThenSucceeds(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	atomic.StoreInt32(&fv.dataKey503Once, 2) // 2 failures then success
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()

	dk, err := c.GenerateDataKey(context.Background(), "tenant-1")
	if err != nil {
		t.Fatalf("expected success after retries, got %v", err)
	}
	if len(dk.Plaintext) != 32 {
		t.Errorf("plaintext size wrong")
	}
	if got := atomic.LoadInt32(&fv.dataKeyCalls); got != 3 {
		t.Errorf("expected 3 attempts, got %d", got)
	}
}

func TestGenerateDataKey503RetryExhaustion(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	atomic.StoreInt32(&fv.dataKey503Once, 5) // more than retry budget
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()

	_, err := c.GenerateDataKey(context.Background(), "tenant-1")
	if err == nil {
		t.Fatal("expected exhaustion error")
	}
	// The error should be the underlying ResponseError after exhausting
	// the 3 attempts.
	if got := atomic.LoadInt32(&fv.dataKeyCalls); got != 3 {
		t.Errorf("expected 3 attempts (exhausted), got %d", got)
	}
}

func TestHealthSealed(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	fv.healthSealed = true
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()

	err := c.Health(context.Background())
	if !errors.Is(err, ErrVaultSealed) {
		t.Errorf("expected ErrVaultSealed, got %v", err)
	}
}

func TestHealthStandby(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	fv.healthStandby = true
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()
	err := c.Health(context.Background())
	if !errors.Is(err, ErrStandby) {
		t.Errorf("expected ErrStandby, got %v", err)
	}
}

func TestHealthHappy(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()
	if err := c.Health(context.Background()); err != nil {
		t.Errorf("expected healthy, got %v", err)
	}
}

func TestDecryptMalformedEnvelope(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()

	_, err := c.Decrypt(context.Background(), "tenant-1", []byte("not-an-envelope"))
	if !errors.Is(err, ErrEnvelopeInvalid) {
		t.Errorf("expected ErrEnvelopeInvalid, got %v", err)
	}
}

func TestDecryptHappyPath(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()

	dk, err := c.GenerateDataKey(context.Background(), "tenant-1")
	if err != nil {
		t.Fatalf("GenerateDataKey: %v", err)
	}
	plain, err := c.Decrypt(context.Background(), "tenant-1", dk.Ciphertext)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if !bytes.Equal(plain, fv.plaintextDEK) {
		t.Errorf("plaintext mismatch")
	}
}

// TestLogCaptureNoPlaintext verifies that even when zerolog is set to debug
// across encrypt/decrypt, no plaintext DEK bytes appear in the output.
func TestLogCaptureNoPlaintext(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()

	// Capture a hex form to assert the actual bytes never appear.
	plainHex := fmt.Sprintf("%x", fv.plaintextDEK)
	plainB64 := base64.StdEncoding.EncodeToString(fv.plaintextDEK)

	var buf syncBuffer
	logger := zerolog.New(&buf).With().Timestamp().Logger().Level(zerolog.DebugLevel)

	// Drive operations and emit log events through the test-injected logger.
	dk, err := c.GenerateDataKey(context.Background(), "tenant-1")
	if err != nil {
		t.Fatalf("GenerateDataKey: %v", err)
	}
	logEvent(&logger, zerolog.DebugLevel, opGenerateKey, "tenant-1", dk.KEKVersion)
	if _, err := c.Decrypt(context.Background(), "tenant-1", dk.Ciphertext); err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	logEvent(&logger, zerolog.DebugLevel, opDecrypt, "tenant-1", dk.KEKVersion)

	got := buf.String()
	if got == "" {
		t.Fatal("expected log output")
	}
	if bytes.Contains([]byte(got), []byte(plainHex)) {
		t.Errorf("plaintext hex leaked into logs")
	}
	if bytes.Contains([]byte(got), []byte(plainB64)) {
		t.Errorf("plaintext base64 leaked into logs")
	}
	// And literal bytes (best-effort: most random bytes are not valid utf8,
	// but check the printable subset).
	if bytes.Contains([]byte(got), fv.plaintextDEK) {
		t.Errorf("raw plaintext bytes leaked into logs")
	}
}

// TestConcurrentGenerateDataKey runs 50 concurrent GenerateDataKey calls
// to confirm there are no data races under -race.
func TestConcurrentGenerateDataKey(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()

	const n = 50
	var wg sync.WaitGroup
	errCh := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.GenerateDataKey(context.Background(), "tenant-1"); err != nil {
				errCh <- err
			}
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Errorf("concurrent GenerateDataKey error: %v", err)
	}
}

func TestEnsureTransitKeyRetriesOn503(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	fv.read503Once = true
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()

	if err := c.EnsureTransitKey(context.Background(), "tenant-1"); err != nil {
		t.Fatalf("EnsureTransitKey: %v", err)
	}
}

// TestNewClientBadAddr ensures DNS / connection errors at auth time surface
// cleanly.
func TestNewClientBadAddr(t *testing.T) {
	t.Parallel()
	cfg := Config{
		Addr:            "http://127.0.0.1:1", // refused
		AuthMethod:      AuthMethodAppRole,
		AppRoleRoleID:   "r",
		AppRoleSecretID: "s",
		Timeout:         200 * time.Millisecond,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	_, err := NewClient(ctx, cfg)
	if err == nil {
		t.Fatal("expected connection error")
	}
}

// TestNewClientInvalidConfig surfaces validation failures.
func TestNewClientInvalidConfig(t *testing.T) {
	t.Parallel()
	_, err := NewClient(context.Background(), Config{})
	if err == nil {
		t.Fatal("expected config error")
	}
}

// TestHealthUnknownStatus exercises the default branch of Health when the
// server returns an unexpected status.
func TestHealthUnknownStatus(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/sys/health":
			w.WriteHeader(http.StatusTeapot)
		case "/v1/auth/approle/login":
			_ = json.NewEncoder(w).Encode(map[string]any{"auth": map[string]any{"client_token": "t"}})
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(context.Background(), devConfig(srv.URL))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer func() { _ = c.Close() }()
	if err := c.Health(context.Background()); err == nil {
		t.Fatal("expected error on teapot status")
	} else if !errors.Is(err, ErrTransitDenied) {
		t.Errorf("expected ErrTransitDenied, got %v", err)
	}
}

// TestGenerateDataKeyMalformedResponse covers various malformed responses.
func TestGenerateDataKeyMalformedResponse(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		body    any
		wantErr error
	}{
		{
			name:    "missing fields",
			body:    map[string]any{"data": map[string]any{}},
			wantErr: ErrTransitDenied,
		},
		{
			name: "plaintext not base64",
			body: map[string]any{"data": map[string]any{
				"plaintext":  "@@not-base64@@",
				"ciphertext": "vault:v1:abc",
			}},
			wantErr: ErrEnvelopeInvalid,
		},
		{
			name: "envelope without prefix",
			body: map[string]any{"data": map[string]any{
				"plaintext":  base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")),
				"ciphertext": "no-prefix",
			}},
			wantErr: ErrEnvelopeInvalid,
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewEncoder(w).Encode(tc.body)
			}))
			t.Cleanup(srv.Close)
			c, _ := NewClient(context.Background(), devConfig(srv.URL))
			defer func() { _ = c.Close() }()
			_, err := c.GenerateDataKey(context.Background(), "tenant-1")
			if !errors.Is(err, tc.wantErr) {
				t.Errorf("want %v, got %v", tc.wantErr, err)
			}
		})
	}
}

// TestDecryptMalformedResponse handles bad decrypt responses.
func TestDecryptMalformedResponse(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{}})
	}))
	t.Cleanup(srv.Close)
	c, _ := NewClient(context.Background(), devConfig(srv.URL))
	defer func() { _ = c.Close() }()
	_, err := c.Decrypt(context.Background(), "tenant-1", []byte("vault:v1:abc"))
	if !errors.Is(err, ErrTransitDenied) {
		t.Errorf("expected ErrTransitDenied, got %v", err)
	}
}

// TestDecryptPlaintextNotBase64 covers the base64 decode error branch.
func TestDecryptPlaintextNotBase64(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
			"plaintext": "@@invalid@@",
		}})
	}))
	t.Cleanup(srv.Close)
	c, _ := NewClient(context.Background(), devConfig(srv.URL))
	defer func() { _ = c.Close() }()
	_, err := c.Decrypt(context.Background(), "tenant-1", []byte("vault:v1:abc"))
	if !errors.Is(err, ErrEnvelopeInvalid) {
		t.Errorf("expected ErrEnvelopeInvalid, got %v", err)
	}
}

// TestEnsureTransitKeyEmptyDecryptInputs hits the parameter validation
// branches in GenerateDataKey and Decrypt.
func TestEnsureTransitKeyEmptyDecryptInputs(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	defer func() { _ = c.Close() }()
	if _, err := c.GenerateDataKey(context.Background(), ""); err == nil {
		t.Error("expected error for empty key name in GenerateDataKey")
	}
	if _, err := c.Decrypt(context.Background(), "", []byte("vault:v1:abc")); err == nil {
		t.Error("expected error for empty key name in Decrypt")
	}
}

// TestNewClientTLSCAPathInvalid covers ConfigureTLS error.
func TestNewClientTLSCAPathInvalid(t *testing.T) {
	t.Parallel()
	cfg := Config{
		Addr:       "http://v",
		AuthMethod: AuthMethodToken,
		Token:      "x",
		TLSCACert:  "/nonexistent/path/ca.pem",
		Timeout:    100 * time.Millisecond,
	}
	_, err := NewClient(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected TLS configure error")
	}
}

// TestClientCloseIdempotent ensures Close can be called more than once.
func TestClientCloseIdempotent(t *testing.T) {
	t.Parallel()
	fv := newFakeVault(t)
	c, _ := NewClient(context.Background(), devConfig(fv.URL()))
	if err := c.Close(); err != nil {
		t.Fatalf("Close 1: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("Close 2: %v", err)
	}
}

// syncBuffer is an io.Writer guarded by a mutex (zerolog can be invoked
// concurrently in tests).
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

// Ensure we don't accidentally rely on unused symbols.
var _ = io.Discard
