package crypto

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestFieldCrypto_NewFieldCrypto_RejectsMissingDeps(t *testing.T) {
	if _, err := NewFieldCrypto(FieldCryptoDeps{}); err == nil {
		t.Error("expected error on missing DEK")
	}
	mgr, _ := NewDEKManager(DEKManagerConfig{}, DEKManagerDeps{Transit: &stubTransit{}})
	defer mgr.Close()
	if _, err := NewFieldCrypto(FieldCryptoDeps{DEK: mgr}); err == nil {
		t.Error("expected error on missing PII")
	}
}

func TestNewDEKManager_RejectsMissingTransit(t *testing.T) {
	if _, err := NewDEKManager(DEKManagerConfig{}, DEKManagerDeps{}); err == nil {
		t.Error("expected error on missing transit")
	}
}

func TestFieldCrypto_DecryptDocument_NoPIINode(t *testing.T) {
	fc, mgr, _ := newTestFieldCrypto(t)
	defer mgr.Close()
	tenant := uuid.New()
	dekRef := DEKRefFromString("siem-tenant-" + tenant.String() + "/idx#1")
	doc := map[string]any{"foo": "bar"}
	out, err := fc.DecryptDocument(context.Background(), tenant, dekRef, doc)
	if err != nil {
		t.Fatal(err)
	}
	if out["foo"] != "bar" {
		t.Errorf("expected passthrough: %v", out)
	}
}

func TestFieldCrypto_DecryptDocument_NoCiphertextPrefix(t *testing.T) {
	// If the encrypted_fields path contains a value that does not start
	// with enc:v1: we skip it (treat as plaintext).
	fc, mgr, _ := newTestFieldCrypto(t)
	defer mgr.Close()
	tenant := uuid.New()
	dekRef := DEKRefFromString("siem-tenant-" + tenant.String() + "/idx#1")
	doc := map[string]any{
		"user": map[string]any{"email": "not-encrypted"},
		"pii":  map[string]any{"encrypted_fields": []string{"user.email"}},
	}
	out, err := fc.DecryptDocument(context.Background(), tenant, dekRef, doc)
	if err != nil {
		t.Fatal(err)
	}
	user := out["user"].(map[string]any)
	if user["email"] != "not-encrypted" {
		t.Errorf("got %v", user["email"])
	}
}

func TestStringSlice(t *testing.T) {
	if got := stringSlice([]string{"a", "b"}); len(got) != 2 || got[0] != "a" {
		t.Errorf("slice-of-string: %v", got)
	}
	if got := stringSlice([]any{"a", 1, "b"}); len(got) != 2 {
		t.Errorf("any-mixed: %v", got)
	}
	if stringSlice(42) != nil {
		t.Error("non-slice should return nil")
	}
}

func TestZeroBytes(t *testing.T) {
	b := []byte{1, 2, 3, 4}
	zeroBytes(b)
	for i, v := range b {
		if v != 0 {
			t.Errorf("byte %d = %d", i, v)
		}
	}
	// Zero on nil should not panic.
	zeroBytes(nil)
}

func TestNewGCM(t *testing.T) {
	if _, err := newGCM([]byte("short")); err == nil {
		t.Error("expected length error")
	}
	good := make([]byte, 32)
	if _, err := newGCM(good); err != nil {
		t.Errorf("unexpected err: %v", err)
	}
}
