package repository

import (
	"strings"
	"testing"

	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/pkg/crypto"
)

func newKey(t *testing.T) []byte {
	t.Helper()
	k, err := crypto.GenerateSalt(32)
	if err != nil {
		t.Fatalf("gen key: %v", err)
	}
	return k
}

// TestIdPSecret_EncryptDecryptRoundTrip verifies client_secret is encrypted at
// rest (prefixed envelope) and decrypts back to the original plaintext.
func TestIdPSecret_EncryptDecryptRoundTrip(t *testing.T) {
	key := newKey(t)
	r := &idpConnectionRepo{secretKey: key}

	const plain = "super-secret-client-value"
	enc, err := r.encryptSecret(plain)
	if err != nil {
		t.Fatalf("encryptSecret: %v", err)
	}
	if !strings.HasPrefix(enc, idpSecretPrefix) {
		t.Fatalf("expected encrypted value to carry the %q envelope prefix, got %q", idpSecretPrefix, enc)
	}
	if strings.Contains(enc, plain) {
		t.Fatalf("ciphertext must not contain the plaintext secret")
	}
	if got := r.decryptSecret(enc); got != plain {
		t.Fatalf("decrypt round-trip mismatch: got %q want %q", got, plain)
	}
}

// TestIdPSecret_EncryptIdempotent: an already-encrypted value is returned
// unchanged (so re-saving a redacted/round-tripped row does not double-encrypt).
func TestIdPSecret_EncryptIdempotent(t *testing.T) {
	key := newKey(t)
	r := &idpConnectionRepo{secretKey: key}

	enc, err := r.encryptSecret("value")
	if err != nil {
		t.Fatalf("encryptSecret: %v", err)
	}
	enc2, err := r.encryptSecret(enc)
	if err != nil {
		t.Fatalf("encryptSecret(2): %v", err)
	}
	if enc2 != enc {
		t.Fatalf("encrypting an already-encrypted value must be a no-op")
	}
}

// TestIdPSecret_LegacyPlaintextPassthrough: without the envelope prefix, a stored
// value is treated as legacy plaintext on read (backward compatibility).
func TestIdPSecret_LegacyPlaintextPassthrough(t *testing.T) {
	key := newKey(t)
	r := &idpConnectionRepo{secretKey: key}
	if got := r.decryptSecret("legacy-plaintext"); got != "legacy-plaintext" {
		t.Fatalf("legacy plaintext should pass through, got %q", got)
	}
	// Empty stays empty.
	if got := r.decryptSecret(""); got != "" {
		t.Fatalf("empty secret should stay empty, got %q", got)
	}
}

// TestIdPSecret_NoKeyMode: with no key wired the repo operates in plaintext mode
// (encrypt is a passthrough) AND refuses to leak ciphertext it cannot decrypt.
func TestIdPSecret_NoKeyMode(t *testing.T) {
	r := &idpConnectionRepo{} // no key

	enc, err := r.encryptSecret("value")
	if err != nil {
		t.Fatalf("encryptSecret (no key): %v", err)
	}
	if enc != "value" {
		t.Fatalf("no-key mode must store plaintext, got %q", enc)
	}

	// An encrypted-at-rest value encountered without a key must NOT be returned as
	// ciphertext (it would otherwise leak into a token exchange) — return empty.
	if got := r.decryptSecret(idpSecretPrefix + "deadbeef"); got != "" {
		t.Fatalf("encrypted value with no key must decrypt to empty, got %q", got)
	}
}

// TestIdPSecret_WrongKeyFailsClosed: a value encrypted with key A cannot be
// decrypted with key B; the repo returns empty rather than garbage/ciphertext.
func TestIdPSecret_WrongKeyFailsClosed(t *testing.T) {
	keyA := newKey(t)
	keyB := newKey(t)
	encRepo := &idpConnectionRepo{secretKey: keyA}
	enc, err := encRepo.encryptSecret("value")
	if err != nil {
		t.Fatalf("encryptSecret: %v", err)
	}

	decRepo := &idpConnectionRepo{secretKey: keyB}
	if got := decRepo.decryptSecret(enc); got != "" {
		t.Fatalf("decrypt with the wrong key must fail closed (empty), got %q", got)
	}
}

// TestRedactSecret blanks the secret on the API surface copy.
func TestRedactSecret(t *testing.T) {
	c := &model.IdPConnection{Provider: "okta", ClientSecret: "should-not-leak"}
	out := RedactSecret(c)
	if out.ClientSecret != "" {
		t.Fatalf("RedactSecret must blank client_secret, got %q", out.ClientSecret)
	}
	if out != c {
		t.Fatalf("RedactSecret should return the same pointer")
	}
	// nil-safe.
	if RedactSecret(nil) != nil {
		t.Fatalf("RedactSecret(nil) must be nil-safe")
	}
}

// TestNewIdPConnectionRepositoryWithKey_RejectsBadKeyLength: a non-32-byte key is
// ignored (falls back to plaintext) rather than producing a broken cipher.
func TestNewIdPConnectionRepositoryWithKey_RejectsBadKeyLength(t *testing.T) {
	r := NewIdPConnectionRepositoryWithKey(nil, []byte("too-short")).(*idpConnectionRepo)
	if r.secretKey != nil {
		t.Fatalf("a short key must be ignored (plaintext fallback)")
	}
	full := NewIdPConnectionRepositoryWithKey(nil, newKey(t)).(*idpConnectionRepo)
	if len(full.secretKey) != crypto32 {
		t.Fatalf("a 32-byte key must be retained")
	}
}
