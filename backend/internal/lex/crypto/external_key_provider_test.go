package crypto

import (
	"crypto/rand"
	"encoding/base64"
	"io"
	"os"
	"path/filepath"
	"testing"
)

// TestExternalKeyProvider_FileBackedRoundTrip proves WTQ-SEC-04 external custody:
// a 32-byte AES key sourced from a mounted file (the KMS/secret-store injection
// pattern) drives real AES-256-GCM round-trips, identical to software custody.
func TestExternalKeyProvider_FileBackedRoundTrip(t *testing.T) {
	key := make([]byte, KeyBytes)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		t.Fatalf("gen key: %v", err)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "field.key")
	if err := os.WriteFile(path, []byte(base64.StdEncoding.EncodeToString(key)+"\n"), 0o600); err != nil {
		t.Fatalf("write key file: %v", err)
	}

	resolve := func() ([]byte, error) {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		return base64.StdEncoding.DecodeString(string(trimSpace(raw)))
	}
	provider, err := NewExternalKeyProvider("external-file", resolve)
	if err != nil {
		t.Fatalf("NewExternalKeyProvider: %v", err)
	}
	if provider.Provider() != "external-file" {
		t.Fatalf("provider label = %q", provider.Provider())
	}

	fc, err := NewFieldCrypto(provider)
	if err != nil {
		t.Fatalf("NewFieldCrypto: %v", err)
	}
	const plain = "Counterparty: Falcon Retail Holdings; Bank IBAN SA0380000000608010167519"
	enc, err := fc.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if !IsEncrypted(enc) || enc == plain {
		t.Fatalf("ciphertext not enc:v1 or unencrypted: %q", enc)
	}
	dec, err := fc.Decrypt(enc)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if dec != plain {
		t.Fatalf("round-trip mismatch: %q != %q", dec, plain)
	}
}

// TestExternalKeyProvider_RejectsWrongLength proves the seam fails closed on a
// malformed externally-custodied key rather than silently truncating.
func TestExternalKeyProvider_RejectsWrongLength(t *testing.T) {
	provider, err := NewExternalKeyProvider("external-file", func() ([]byte, error) {
		return []byte("too-short"), nil
	})
	if err != nil {
		t.Fatalf("NewExternalKeyProvider: %v", err)
	}
	if _, err := provider.Key(); err == nil {
		t.Fatal("expected ErrInvalidKey for a non-32-byte external key")
	}
}

func trimSpace(b []byte) []byte {
	for len(b) > 0 && (b[len(b)-1] == '\n' || b[len(b)-1] == '\r' || b[len(b)-1] == ' ' || b[len(b)-1] == '\t') {
		b = b[:len(b)-1]
	}
	return b
}
