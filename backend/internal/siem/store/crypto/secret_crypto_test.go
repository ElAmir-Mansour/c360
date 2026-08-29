package crypto

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func newTestSecretCrypto(t *testing.T) (SecretCrypto, DEKManager) {
	t.Helper()
	mgr, err := NewDEKManager(DEKManagerConfig{}, DEKManagerDeps{Transit: &stubTransit{}})
	if err != nil {
		t.Fatalf("NewDEKManager: %v", err)
	}
	sc, err := NewSecretCrypto(mgr)
	if err != nil {
		t.Fatalf("NewSecretCrypto: %v", err)
	}
	return sc, mgr
}

func TestSecretCrypto_RoundTrip(t *testing.T) {
	sc, mgr := newTestSecretCrypto(t)
	defer mgr.Close()

	tenant := uuid.New()
	idx := LLMCredentialIndex(tenant)
	plaintext := []byte("sk-ant-secret-api-key-value-1234567890")

	cipher, dekRef, ver, err := sc.Encrypt(context.Background(), tenant, idx, plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if !strings.HasPrefix(cipher, CiphertextPrefix) {
		t.Errorf("cipher missing %q prefix: %q", CiphertextPrefix, cipher)
	}
	if cipher == string(plaintext) || strings.Contains(cipher, string(plaintext)) {
		t.Errorf("cipher leaks plaintext: %q", cipher)
	}
	if dekRef == "" {
		t.Error("empty dekRef")
	}
	if ver <= 0 {
		t.Errorf("kekVersion = %d, want > 0", ver)
	}

	got, err := sc.Decrypt(context.Background(), tenant, idx, cipher)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Errorf("round-trip mismatch: got %q want %q", got, plaintext)
	}
}

func TestSecretCrypto_PerTenantIsolation(t *testing.T) {
	sc, mgr := newTestSecretCrypto(t)
	defer mgr.Close()

	a := uuid.New()
	b := uuid.New()
	// Different index names -> different DEK rows -> tenant B can never decrypt
	// tenant A's ciphertext.
	idxA := LLMCredentialIndex(a)
	idxB := LLMCredentialIndex(b)
	if idxA == idxB {
		t.Fatal("per-tenant index names collided")
	}

	cipherA, _, _, err := sc.Encrypt(context.Background(), a, idxA, []byte("tenant-A-key"))
	if err != nil {
		t.Fatalf("Encrypt A: %v", err)
	}
	// Decrypting A's cipher under B's (tenant,index) must fail (wrong DEK).
	if _, err := sc.Decrypt(context.Background(), b, idxB, cipherA); err == nil {
		t.Fatal("tenant B decrypted tenant A's ciphertext; isolation broken")
	}
}

func TestSecretCrypto_NilManager(t *testing.T) {
	if _, err := NewSecretCrypto(nil); err == nil {
		t.Fatal("expected error for nil DEK manager")
	}
}

func TestLLMCredentialIndex_PerTenant(t *testing.T) {
	a := uuid.New()
	b := uuid.New()
	if LLMCredentialIndex(a) == LLMCredentialIndex(b) {
		t.Fatal("index names must differ per tenant")
	}
	if !strings.HasSuffix(LLMCredentialIndex(a), a.String()) {
		t.Errorf("index name should carry tenant id: %q", LLMCredentialIndex(a))
	}
}
