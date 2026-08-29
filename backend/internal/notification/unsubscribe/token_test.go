package unsubscribe

import (
	"strings"
	"testing"
)

const testSecret = "unit-test-unsubscribe-secret-0123456789"

func TestSignVerify_RoundTrip(t *testing.T) {
	tok, err := Sign(testSecret, "tenant-1", "user-1", "alert.created")
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if !strings.Contains(tok, ".") {
		t.Fatalf("token missing separator: %q", tok)
	}

	claims, err := Verify(testSecret, tok)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.TenantID != "tenant-1" || claims.UserID != "user-1" || claims.Type != "alert.created" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
	if claims.IssuedAt == 0 {
		t.Error("expected non-zero IssuedAt")
	}
}

func TestVerify_RejectsTamperedSignature(t *testing.T) {
	tok, err := Sign(testSecret, "tenant-1", "user-1", "alert.created")
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	// Flip the last character of the signature.
	tampered := tok[:len(tok)-1]
	if tok[len(tok)-1] == 'A' {
		tampered += "B"
	} else {
		tampered += "A"
	}
	if _, err := Verify(testSecret, tampered); err == nil {
		t.Fatal("expected verification to fail on a tampered signature")
	}
}

func TestVerify_RejectsWrongSecret(t *testing.T) {
	tok, err := Sign(testSecret, "tenant-1", "user-1", "alert.created")
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if _, err := Verify("a-different-secret-value-000000000000", tok); err == nil {
		t.Fatal("expected verification to fail under a different secret")
	}
}

func TestVerify_RejectsMalformed(t *testing.T) {
	for _, tok := range []string{"", "no-separator", ".", "abc.", ".def", "not-base64!!.sig"} {
		if _, err := Verify(testSecret, tok); err == nil {
			t.Fatalf("expected error for malformed token %q", tok)
		}
	}
}

func TestSign_RequiresSecretAndIdentity(t *testing.T) {
	if _, err := Sign("", "t", "u", "alert.created"); err == nil {
		t.Error("expected error when secret is empty")
	}
	if _, err := Sign(testSecret, "", "u", "alert.created"); err == nil {
		t.Error("expected error when tenant is empty")
	}
	if _, err := Sign(testSecret, "t", "", "alert.created"); err == nil {
		t.Error("expected error when user is empty")
	}
}
