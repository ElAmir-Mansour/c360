package credential

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/store/crypto"
)

// captureEmitter records emitted events so tests can assert no key/cipher leaks.
type captureEmitter struct {
	mu     sync.Mutex
	events []struct {
		Type    string
		Payload map[string]any
	}
}

func (c *captureEmitter) Emit(_ context.Context, eventType string, payload map[string]any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, struct {
		Type    string
		Payload map[string]any
	}{eventType, payload})
	return nil
}

// fakeTransit is a deterministic, per-keyName Transit for tests -- NO Vault.
// It derives a stable 32-byte DEK from the keyName (so each tenant's transit key
// yields its own DEK) and round-trips the envelope back to that DEK. This proves
// crypto isolation: tenant A's DEK and tenant B's DEK differ.
type fakeTransit struct{}

func deriveDEK(keyName string) []byte {
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = keyName[(i+len(keyName))%len(keyName)] ^ byte(i*7+1)
	}
	return dek
}

func (fakeTransit) EnsureKey(_ context.Context, _ string) error { return nil }
func (fakeTransit) Generate(_ context.Context, keyName string) ([]byte, []byte, int, error) {
	return deriveDEK(keyName), []byte("env:" + keyName), 1, nil
}
func (fakeTransit) Decrypt(_ context.Context, keyName string, _ []byte) ([]byte, error) {
	return deriveDEK(keyName), nil
}

func newTestService(t *testing.T) (*Service, *fakeStore, *captureEmitter) {
	t.Helper()
	mgr, err := crypto.NewDEKManager(crypto.DEKManagerConfig{}, crypto.DEKManagerDeps{Transit: fakeTransit{}})
	if err != nil {
		t.Fatalf("NewDEKManager: %v", err)
	}
	t.Cleanup(func() { _ = mgr.Close() })
	sc, err := crypto.NewSecretCrypto(mgr)
	if err != nil {
		t.Fatalf("NewSecretCrypto: %v", err)
	}
	store := newFakeStore()
	emit := &captureEmitter{}
	svc, err := NewService(store, sc, emit)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, store, emit
}

func TestService_SetStoreResolveRoundTrip(t *testing.T) {
	svc, store, _ := newTestService(t)
	ctx := context.Background()
	tenant := uuid.New()
	key := "sk-ant-roundtrip-key-1234567890abcdef"

	status, err := svc.Set(ctx, tenant, "anthropic", "claude-opus-4-8", []byte(key))
	if err != nil {
		t.Fatalf("Set: %v", err)
	}
	if !status.Configured || !status.Enabled {
		t.Fatalf("status not configured/enabled: %+v", status)
	}
	// Persisted ciphertext must be encrypted, never plaintext.
	rec, found, _ := store.Get(ctx, tenant)
	if !found {
		t.Fatal("row not persisted")
	}
	if !strings.HasPrefix(rec.APIKeyCipher, crypto.CiphertextPrefix) {
		t.Errorf("stored value not encrypted: %q", rec.APIKeyCipher)
	}
	if strings.Contains(rec.APIKeyCipher, key) {
		t.Error("stored ciphertext leaks plaintext key")
	}

	resolved, err := svc.ResolveCredential(ctx, tenant)
	if err != nil {
		t.Fatalf("ResolveCredential: %v", err)
	}
	if resolved == nil {
		t.Fatal("resolved nil")
	}
	if !bytes.Equal(resolved.APIKey, []byte(key)) {
		t.Errorf("decrypted key mismatch: %q", resolved.APIKey)
	}
	if resolved.Provider != "anthropic" || resolved.Model != "claude-opus-4-8" {
		t.Errorf("provider/model mismatch: %+v", resolved)
	}
}

func TestService_PerTenantResolutionAndIsolation(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()
	a := uuid.New()
	b := uuid.New()
	keyA := "sk-ant-tenant-A-key-1234567890abcd"
	keyB := "sk-ant-tenant-B-key-0987654321zyxw"

	if _, err := svc.Set(ctx, a, "anthropic", "", []byte(keyA)); err != nil {
		t.Fatalf("Set A: %v", err)
	}
	if _, err := svc.Set(ctx, b, "anthropic", "", []byte(keyB)); err != nil {
		t.Fatalf("Set B: %v", err)
	}

	ra, err := svc.ResolveCredential(ctx, a)
	if err != nil || ra == nil {
		t.Fatalf("Resolve A: %v", err)
	}
	rb, err := svc.ResolveCredential(ctx, b)
	if err != nil || rb == nil {
		t.Fatalf("Resolve B: %v", err)
	}
	if !bytes.Equal(ra.APIKey, []byte(keyA)) {
		t.Errorf("tenant A got wrong key: %q", ra.APIKey)
	}
	if !bytes.Equal(rb.APIKey, []byte(keyB)) {
		t.Errorf("tenant B got wrong key: %q", rb.APIKey)
	}
	if bytes.Equal(ra.APIKey, rb.APIKey) {
		t.Error("tenants resolved to the same key; isolation broken")
	}
}

func TestService_ResolveFailClosedWhenUnset(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()
	tenant := uuid.New()

	resolved, err := svc.ResolveCredential(ctx, tenant)
	if err != nil {
		t.Fatalf("ResolveCredential: %v", err)
	}
	if resolved != nil {
		t.Fatal("expected nil resolved credential for unconfigured tenant")
	}
	// GetStatus reports not configured (and never a key).
	status, err := svc.GetStatus(ctx, tenant)
	if err != nil {
		t.Fatalf("GetStatus: %v", err)
	}
	if status.Configured {
		t.Errorf("status should be unconfigured: %+v", status)
	}
}

func TestService_RotateChangesResolvedKey(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()
	tenant := uuid.New()
	key1 := "sk-ant-first-key-1234567890abcdefgh"
	key2 := "sk-ant-second-key-zyxwvutsrqpon1234"

	first, err := svc.Set(ctx, tenant, "anthropic", "claude-opus-4-8", []byte(key1))
	if err != nil {
		t.Fatalf("Set: %v", err)
	}
	r1, _ := svc.ResolveCredential(ctx, tenant)
	if !bytes.Equal(r1.APIKey, []byte(key1)) {
		t.Fatalf("pre-rotation key mismatch: %q", r1.APIKey)
	}

	rotated, err := svc.Rotate(ctx, tenant, []byte(key2))
	if err != nil {
		t.Fatalf("Rotate: %v", err)
	}
	if rotated.Version <= first.Version {
		t.Errorf("rotation did not bump version: %d -> %d", first.Version, rotated.Version)
	}
	// Provider/model preserved across rotation.
	if rotated.Provider != "anthropic" || rotated.Model != "claude-opus-4-8" {
		t.Errorf("rotation lost provider/model: %+v", rotated)
	}
	r2, _ := svc.ResolveCredential(ctx, tenant)
	if !bytes.Equal(r2.APIKey, []byte(key2)) {
		t.Errorf("post-rotation key not updated: %q", r2.APIKey)
	}
}

func TestService_RotateRequiresExisting(t *testing.T) {
	svc, _, _ := newTestService(t)
	_, err := svc.Rotate(context.Background(), uuid.New(), []byte("sk-ant-no-existing-row-1234567890"))
	if !errors.Is(err, ErrNotConfigured) {
		t.Errorf("expected ErrNotConfigured, got %v", err)
	}
}

func TestService_DisabledFallsThrough(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()
	tenant := uuid.New()
	if _, err := svc.Set(ctx, tenant, "anthropic", "", []byte("sk-ant-disable-me-1234567890abcd")); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if _, err := svc.SetEnabled(ctx, tenant, false); err != nil {
		t.Fatalf("SetEnabled: %v", err)
	}
	resolved, err := svc.ResolveCredential(ctx, tenant)
	if err != nil {
		t.Fatalf("ResolveCredential: %v", err)
	}
	if resolved != nil {
		t.Fatal("disabled credential should resolve to nil (fall through)")
	}
}

func TestService_DeleteIsIdempotentAndClears(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()
	tenant := uuid.New()
	if _, err := svc.Set(ctx, tenant, "anthropic", "", []byte("sk-ant-delete-me-1234567890abcd")); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if err := svc.Delete(ctx, tenant); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	resolved, _ := svc.ResolveCredential(ctx, tenant)
	if resolved != nil {
		t.Fatal("resolve after delete should be nil")
	}
	// Deleting again is not an error.
	if err := svc.Delete(ctx, tenant); err != nil {
		t.Errorf("second Delete errored: %v", err)
	}
}

func TestService_EventsNeverCarryKey(t *testing.T) {
	svc, _, emit := newTestService(t)
	ctx := context.Background()
	tenant := uuid.New()
	secret := "sk-ant-do-not-leak-me-1234567890ab"

	if _, err := svc.Set(ctx, tenant, "anthropic", "claude-opus-4-8", []byte(secret)); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if _, err := svc.Rotate(ctx, tenant, []byte("sk-ant-rotated-secret-0987654321")); err != nil {
		t.Fatalf("Rotate: %v", err)
	}
	emit.mu.Lock()
	defer emit.mu.Unlock()
	if len(emit.events) < 2 {
		t.Fatalf("expected >=2 events, got %d", len(emit.events))
	}
	for _, e := range emit.events {
		for k, v := range e.Payload {
			if k == "api_key" || k == "cipher" || k == "api_key_cipher" {
				t.Errorf("event %q payload has forbidden key %q", e.Type, k)
			}
			if s, ok := v.(string); ok {
				if strings.Contains(s, secret) || strings.HasPrefix(s, crypto.CiphertextPrefix) {
					t.Errorf("event %q payload value leaks secret/cipher: %q=%q", e.Type, k, s)
				}
			}
		}
	}
}

func TestService_Validation(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()
	tenant := uuid.New()
	cases := []struct {
		name     string
		provider string
		key      string
		wantErr  error
	}{
		{"bad provider", "gemini", "sk-ant-valid-key-1234567890abcd", ErrUnsupportedProvider},
		{"empty key", "anthropic", "   ", ErrEmptyKey},
		{"short key", "anthropic", "sk-ant-x", ErrInvalidKeyFormat},
		{"wrong prefix", "anthropic", "wrong-prefix-key-1234567890abcd", ErrInvalidKeyFormat},
		{"openai ok", "openai", "sk-openai-key-1234567890abcdef", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.Set(ctx, tenant, tc.provider, "", []byte(tc.key))
			if tc.wantErr == nil {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if !errors.Is(err, tc.wantErr) {
				t.Errorf("got %v, want %v", err, tc.wantErr)
			}
		})
	}
}

func TestService_NilDeps(t *testing.T) {
	if _, err := NewService(nil, nil, nil); err == nil {
		t.Fatal("expected error for nil store")
	}
	store := newFakeStore()
	if _, err := NewService(store, nil, nil); err == nil {
		t.Fatal("expected error for nil crypto")
	}
}
