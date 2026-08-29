package crypto

import (
	"errors"
	"strings"
	"testing"
)

func newTestCrypto(t *testing.T) *FieldCrypto {
	t.Helper()
	provider, err := NewSoftwareKeyProviderRandom()
	if err != nil {
		t.Fatalf("NewSoftwareKeyProviderRandom() error = %v", err)
	}
	fc, err := NewFieldCrypto(provider)
	if err != nil {
		t.Fatalf("NewFieldCrypto() error = %v", err)
	}
	return fc
}

func TestFieldCrypto_RoundTrip(t *testing.T) {
	fc := newTestCrypto(t)
	cases := []string{
		"This contract body contains sensitive terms and conditions.",
		"Counterparty: ACME Holdings, contact jane@acme.example",
		"شروط العقد السرية والمبالغ المالية", // Arabic text round-trips
		"X",
	}
	for _, plaintext := range cases {
		ciphertext, err := fc.Encrypt(plaintext)
		if err != nil {
			t.Fatalf("Encrypt(%q) error = %v", plaintext, err)
		}
		if !IsEncrypted(ciphertext) {
			t.Fatalf("Encrypt(%q) = %q, missing %q prefix", plaintext, ciphertext, CiphertextPrefix)
		}
		if len(plaintext) >= 4 && strings.Contains(ciphertext, plaintext) {
			t.Fatalf("ciphertext leaks plaintext: %q contains %q", ciphertext, plaintext)
		}
		got, err := fc.Decrypt(ciphertext)
		if err != nil {
			t.Fatalf("Decrypt() error = %v", err)
		}
		if got != plaintext {
			t.Fatalf("round trip = %q, want %q", got, plaintext)
		}
	}
}

func TestFieldCrypto_EmptyAndIdempotent(t *testing.T) {
	fc := newTestCrypto(t)
	if got, err := fc.Encrypt(""); err != nil || got != "" {
		t.Fatalf("Encrypt(\"\") = %q, %v; want empty", got, err)
	}
	// Encrypting an already-encrypted value is a no-op.
	once, err := fc.Encrypt("secret value")
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}
	twice, err := fc.Encrypt(once)
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}
	if once != twice {
		t.Fatalf("re-encryption not idempotent: %q != %q", once, twice)
	}
}

func TestFieldCrypto_LegacyPlaintextReadStillWorks(t *testing.T) {
	fc := newTestCrypto(t)
	legacy := "legacy plaintext contract body written before encryption"
	got, err := fc.Decrypt(legacy)
	if err != nil {
		t.Fatalf("Decrypt(legacy) error = %v", err)
	}
	if got != legacy {
		t.Fatalf("Decrypt(legacy) = %q, want unchanged %q", got, legacy)
	}
}

func TestFieldCrypto_NonceIsRandomized(t *testing.T) {
	fc := newTestCrypto(t)
	a, err := fc.Encrypt("same plaintext")
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}
	b, err := fc.Encrypt("same plaintext")
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}
	if a == b {
		t.Fatal("two encryptions of the same plaintext produced identical ciphertext (nonce reuse)")
	}
}

func TestFieldCrypto_WrongKeyFailsAuthentication(t *testing.T) {
	fc1 := newTestCrypto(t)
	fc2 := newTestCrypto(t)
	ciphertext, err := fc1.Encrypt("secret")
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}
	if _, err := fc2.Decrypt(ciphertext); !errors.Is(err, ErrDecryptFailed) {
		t.Fatalf("Decrypt() with wrong key error = %v, want ErrDecryptFailed", err)
	}
}

func TestFieldCrypto_PtrHelpers(t *testing.T) {
	fc := newTestCrypto(t)
	if got, err := fc.EncryptPtr(nil); err != nil || got != nil {
		t.Fatalf("EncryptPtr(nil) = %v, %v; want nil", got, err)
	}
	in := "contact: 0500000000"
	enc, err := fc.EncryptPtr(&in)
	if err != nil {
		t.Fatalf("EncryptPtr() error = %v", err)
	}
	if enc == nil || !IsEncrypted(*enc) {
		t.Fatalf("EncryptPtr() = %v, want encrypted", enc)
	}
	dec, err := fc.DecryptPtr(enc)
	if err != nil {
		t.Fatalf("DecryptPtr() error = %v", err)
	}
	if dec == nil || *dec != in {
		t.Fatalf("DecryptPtr() = %v, want %q", dec, in)
	}
}

func TestSoftwareKeyProvider_RejectsWrongLength(t *testing.T) {
	if _, err := NewSoftwareKeyProvider([]byte("too short")); !errors.Is(err, ErrInvalidKey) {
		t.Fatalf("NewSoftwareKeyProvider(short) error = %v, want ErrInvalidKey", err)
	}
}

func TestExternalKeyProvider_HonestSeam(t *testing.T) {
	// External provider is a real AES path over an externally-resolved key.
	key := make([]byte, KeyBytes)
	for i := range key {
		key[i] = byte(i + 1)
	}
	provider, err := NewExternalKeyProvider("vault", func() ([]byte, error) {
		return key, nil
	})
	if err != nil {
		t.Fatalf("NewExternalKeyProvider() error = %v", err)
	}
	if provider.Provider() != "vault" {
		t.Fatalf("Provider() = %q, want vault", provider.Provider())
	}
	fc, err := NewFieldCrypto(provider)
	if err != nil {
		t.Fatalf("NewFieldCrypto() error = %v", err)
	}
	ciphertext, err := fc.Encrypt("externally keyed secret")
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}
	got, err := fc.Decrypt(ciphertext)
	if err != nil {
		t.Fatalf("Decrypt() error = %v", err)
	}
	if got != "externally keyed secret" {
		t.Fatalf("round trip = %q", got)
	}
}

func TestExternalKeyProvider_ResolverErrorPropagates(t *testing.T) {
	provider, err := NewExternalKeyProvider("vault", func() ([]byte, error) {
		return nil, errors.New("vault unreachable")
	})
	if err != nil {
		t.Fatalf("NewExternalKeyProvider() error = %v", err)
	}
	fc, err := NewFieldCrypto(provider)
	if err != nil {
		t.Fatalf("NewFieldCrypto() error = %v", err)
	}
	if _, err := fc.Encrypt("secret"); err == nil {
		t.Fatal("Encrypt() error = nil, want resolver error to propagate")
	}
}
