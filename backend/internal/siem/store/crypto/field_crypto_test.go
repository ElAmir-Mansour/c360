package crypto

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

// DEKRefFromString is a tiny test helper that converts a plain string
// into the canonical storetypes.DEKRef alias used by parseDEKRef.
func DEKRefFromString(s string) storetypes.DEKRef { return storetypes.DEKRef(s) }

func newTestFieldCrypto(t *testing.T) (FieldCrypto, DEKManager, PIIRegistry) {
	t.Helper()
	pii, err := NewPIIRegistry()
	if err != nil {
		t.Fatalf("NewPIIRegistry: %v", err)
	}
	tr := &stubTransit{}
	mgr, err := NewDEKManager(DEKManagerConfig{}, DEKManagerDeps{Transit: tr, PII: pii})
	if err != nil {
		t.Fatal(err)
	}
	fc, err := NewFieldCrypto(FieldCryptoDeps{DEK: mgr, PII: pii})
	if err != nil {
		t.Fatal(err)
	}
	return fc, mgr, pii
}

func TestFieldCrypto_RoundTrip(t *testing.T) {
	fc, mgr, _ := newTestFieldCrypto(t)
	defer mgr.Close()
	tenant := uuid.New()
	doc := map[string]any{
		"@timestamp": "2026-05-14T00:00:00Z",
		"tenant_id":  tenant.String(),
		"user": map[string]any{
			"email":     "alice@example.com",
			"full_name": "Alice Example",
			"id_number": "12345678901",
		},
		"host": map[string]any{"name": "h1"},
	}
	encDoc, dekRef, err := fc.EncryptDocument(context.Background(), tenant, "siem-idx", doc)
	if err != nil {
		t.Fatalf("EncryptDocument: %v", err)
	}
	if dekRef == "" {
		t.Fatal("empty dekRef")
	}
	// PII fields ciphertext should have the enc:v1: prefix.
	user := encDoc["user"].(map[string]any)
	if email, ok := user["email"].(string); !ok || !strings.HasPrefix(email, CiphertextPrefix) {
		t.Errorf("email not encrypted: %v", user["email"])
	}
	pii := encDoc["pii"].(map[string]any)
	encFields, ok := pii["encrypted_fields"].([]string)
	if !ok || len(encFields) < 3 {
		t.Fatalf("encrypted_fields wrong: %v", pii["encrypted_fields"])
	}

	dec, err := fc.DecryptDocument(context.Background(), tenant, dekRef, encDoc)
	if err != nil {
		t.Fatalf("DecryptDocument: %v", err)
	}
	user2 := dec["user"].(map[string]any)
	if user2["email"] != "alice@example.com" {
		t.Errorf("email mismatch: %v", user2["email"])
	}
	if user2["full_name"] != "Alice Example" {
		t.Errorf("full_name mismatch: %v", user2["full_name"])
	}
}

func TestFieldCrypto_TamperedCiphertext(t *testing.T) {
	fc, mgr, _ := newTestFieldCrypto(t)
	defer mgr.Close()
	tenant := uuid.New()
	doc := map[string]any{
		"user": map[string]any{"email": "alice@example.com"},
	}
	encDoc, dekRef, err := fc.EncryptDocument(context.Background(), tenant, "idx", doc)
	if err != nil {
		t.Fatal(err)
	}
	user := encDoc["user"].(map[string]any)
	ct := user["email"].(string)
	// Flip a byte in the base64 segment.
	tampered := ct[:len(CiphertextPrefix)] + flipByte(ct[len(CiphertextPrefix):])
	user["email"] = tampered

	_, err = fc.DecryptDocument(context.Background(), tenant, dekRef, encDoc)
	if err == nil {
		t.Fatal("expected decrypt failure")
	}
	if !errors.Is(err, ErrDecryptFailed) && !errors.Is(err, ErrInvalidCiphertext) {
		t.Errorf("err = %v, want ErrDecryptFailed or ErrInvalidCiphertext", err)
	}
}

func TestFieldCrypto_NoPII_NoOp(t *testing.T) {
	fc, mgr, _ := newTestFieldCrypto(t)
	defer mgr.Close()
	tenant := uuid.New()
	doc := map[string]any{
		"@timestamp": "2026-05-14T00:00:00Z",
		"host":       map[string]any{"name": "h1"},
	}
	encDoc, dekRef, err := fc.EncryptDocument(context.Background(), tenant, "idx", doc)
	if err != nil {
		t.Fatal(err)
	}
	if dekRef == "" {
		t.Error("dekRef empty (should still be set even with no PII)")
	}
	if _, has := encDoc["pii"]; has {
		// pii subtree should NOT be created if nothing was encrypted.
		t.Errorf("pii subtree appeared when no PII present: %v", encDoc["pii"])
	}
}

func TestFieldCrypto_VaultOutage(t *testing.T) {
	pii, _ := NewPIIRegistry()
	tr := &stubTransit{ensureErr: errors.New("sealed")}
	mgr, _ := NewDEKManager(DEKManagerConfig{}, DEKManagerDeps{Transit: tr, PII: pii})
	defer mgr.Close()
	fc, _ := NewFieldCrypto(FieldCryptoDeps{DEK: mgr, PII: pii})

	_, _, err := fc.EncryptDocument(context.Background(), uuid.New(), "idx", map[string]any{
		"user": map[string]any{"email": "x@example.com"},
	})
	if err == nil {
		t.Fatal("expected error on Vault outage")
	}
	if !errors.Is(err, ErrDEKUnavailable) {
		t.Errorf("err not ErrDEKUnavailable: %v", err)
	}
}

func TestParseDEKRef(t *testing.T) {
	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	ref := "siem-tenant-" + tenant.String() + "/siem-foo-2026.05.14#3"
	idx, ver, err := parseDEKRef(DEKRefFromString(ref))
	if err != nil {
		t.Fatal(err)
	}
	if idx != "siem-foo-2026.05.14" {
		t.Errorf("idx = %q", idx)
	}
	if ver != 3 {
		t.Errorf("ver = %d", ver)
	}

	bad := []string{
		"no-slash#1",
		"siem-tenant-x/idx#",
		"siem-tenant-x/idx#abc",
		"siem-tenant-x/#1",
		"#1",
	}
	for _, b := range bad {
		if _, _, err := parseDEKRef(DEKRefFromString(b)); err == nil {
			t.Errorf("parseDEKRef(%q) accepted; expected error", b)
		}
	}
}

// flipByte returns s with its first byte XOR'd with 0x01. base64url
// alphabet permits enough re-decoding that the result either fails the
// AEAD or fails decoding — both are acceptable for the tamper test.
func flipByte(s string) string {
	if s == "" {
		return s
	}
	first := s[0]
	if first == 'A' {
		first = 'B'
	} else {
		first = 'A'
	}
	return string(first) + s[1:]
}
