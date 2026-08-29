package byok

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"io"
	"testing"
)

// mustKEK returns n random KEKs of 32 bytes for tests.
func mustDEK(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return b
}

// TestSoftwareProvider_WrapUnwrapRoundTrip proves the real AES-256-GCM envelope:
// a wrapped DEK unwraps back to the identical plaintext under the same KEK.
func TestSoftwareProvider_WrapUnwrapRoundTrip(t *testing.T) {
	ctx := context.Background()
	p, _, err := NewSoftwareKeyProviderRandom(1)
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	if p.KeyVersion() != 1 || p.Provider() != ProviderSoftware {
		t.Fatalf("unexpected version/provider: %d/%s", p.KeyVersion(), p.Provider())
	}

	for _, size := range []int{16, 32, 64} {
		dek := mustDEK(t, size)
		wrapped, nonce, werr := p.WrapDEK(ctx, dek)
		if werr != nil {
			t.Fatalf("wrap size=%d: %v", size, werr)
		}
		if len(nonce) != nonceBytes {
			t.Fatalf("nonce length = %d, want %d", len(nonce), nonceBytes)
		}
		if bytes.Equal(wrapped, dek) {
			t.Fatalf("ciphertext equals plaintext — not encrypted")
		}
		// Ciphertext = plaintext + 16-byte GCM tag.
		if len(wrapped) != size+16 {
			t.Fatalf("ciphertext length = %d, want %d", len(wrapped), size+16)
		}
		got, uerr := p.UnwrapDEK(ctx, wrapped, nonce)
		if uerr != nil {
			t.Fatalf("unwrap size=%d: %v", size, uerr)
		}
		if !bytes.Equal(got, dek) {
			t.Fatalf("round-trip mismatch: got %x want %x", got, dek)
		}
	}
}

// TestSoftwareProvider_NonceUnique proves a fresh random nonce per wrap (two
// wraps of the same DEK produce different nonces and different ciphertexts).
func TestSoftwareProvider_NonceUnique(t *testing.T) {
	ctx := context.Background()
	p, _, _ := NewSoftwareKeyProviderRandom(1)
	dek := mustDEK(t, 32)
	w1, n1, _ := p.WrapDEK(ctx, dek)
	w2, n2, _ := p.WrapDEK(ctx, dek)
	if bytes.Equal(n1, n2) {
		t.Fatalf("nonce reused across wraps")
	}
	if bytes.Equal(w1, w2) {
		t.Fatalf("ciphertext identical across wraps (nonce reuse?)")
	}
	// Both still unwrap correctly.
	for _, c := range []struct {
		w, n []byte
	}{{w1, n1}, {w2, n2}} {
		got, err := p.UnwrapDEK(ctx, c.w, c.n)
		if err != nil || !bytes.Equal(got, dek) {
			t.Fatalf("unwrap failed for independent wrap: %v", err)
		}
	}
}

// TestSoftwareProvider_TamperFails proves the GCM auth tag rejects any mutation
// of the ciphertext OR the nonce.
func TestSoftwareProvider_TamperFails(t *testing.T) {
	ctx := context.Background()
	p, _, _ := NewSoftwareKeyProviderRandom(1)
	dek := mustDEK(t, 32)
	wrapped, nonce, _ := p.WrapDEK(ctx, dek)

	t.Run("flip ciphertext byte", func(t *testing.T) {
		tampered := append([]byte(nil), wrapped...)
		tampered[0] ^= 0xFF
		if _, err := p.UnwrapDEK(ctx, tampered, nonce); !errors.Is(err, ErrUnwrap) {
			t.Fatalf("expected ErrUnwrap on tampered ciphertext, got %v", err)
		}
	})
	t.Run("flip tag byte", func(t *testing.T) {
		tampered := append([]byte(nil), wrapped...)
		tampered[len(tampered)-1] ^= 0x01
		if _, err := p.UnwrapDEK(ctx, tampered, nonce); !errors.Is(err, ErrUnwrap) {
			t.Fatalf("expected ErrUnwrap on tampered tag, got %v", err)
		}
	})
	t.Run("flip nonce byte", func(t *testing.T) {
		tampered := append([]byte(nil), nonce...)
		tampered[0] ^= 0xFF
		if _, err := p.UnwrapDEK(ctx, wrapped, tampered); !errors.Is(err, ErrUnwrap) {
			t.Fatalf("expected ErrUnwrap on tampered nonce, got %v", err)
		}
	})
	t.Run("wrong nonce length", func(t *testing.T) {
		if _, err := p.UnwrapDEK(ctx, wrapped, nonce[:nonceBytes-1]); !errors.Is(err, ErrUnwrap) {
			t.Fatalf("expected ErrUnwrap on short nonce, got %v", err)
		}
	})
}

// TestSoftwareProvider_WrongKEKFails proves a DEK wrapped under one KEK does NOT
// unwrap under a different KEK (different version) — sovereignty: the operator
// cannot read the DEK without the exact key.
func TestSoftwareProvider_WrongKEKFails(t *testing.T) {
	ctx := context.Background()
	p1, _, _ := NewSoftwareKeyProviderRandom(1)
	p2, _, _ := NewSoftwareKeyProviderRandom(2) // independent random KEK

	dek := mustDEK(t, 32)
	wrapped, nonce, _ := p1.WrapDEK(ctx, dek)

	if _, err := p2.UnwrapDEK(ctx, wrapped, nonce); !errors.Is(err, ErrUnwrap) {
		t.Fatalf("DEK wrapped under KEK v1 must NOT unwrap under KEK v2, got %v", err)
	}
	// Sanity: it still unwraps under the correct KEK.
	if _, err := p1.UnwrapDEK(ctx, wrapped, nonce); err != nil {
		t.Fatalf("unwrap under correct KEK failed: %v", err)
	}
}

// TestSoftwareProvider_KEKValidation proves enforced AES-256 key length.
func TestSoftwareProvider_KEKValidation(t *testing.T) {
	for _, n := range []int{0, 16, 24, 31, 33} {
		if _, err := NewSoftwareKeyProvider(1, make([]byte, n)); !errors.Is(err, ErrValidation) {
			t.Fatalf("KEK of %d bytes should be rejected with ErrValidation, got %v", n, err)
		}
	}
	if _, err := NewSoftwareKeyProvider(1, make([]byte, KEKBytes)); err != nil {
		t.Fatalf("32-byte KEK should be accepted, got %v", err)
	}
}

// TestSoftwareProvider_Rotate proves Rotate mints a fresh, independent successor
// KEK: the new provider cannot unwrap DEKs wrapped under the old, and the old
// cannot unwrap DEKs wrapped under the new.
func TestSoftwareProvider_Rotate(t *testing.T) {
	ctx := context.Background()
	oldP, _, _ := NewSoftwareKeyProviderRandom(1)
	nextI, err := oldP.Rotate(ctx, 2)
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	newP := nextI.(*SoftwareKeyProvider)
	if newP.KeyVersion() != 2 {
		t.Fatalf("new version = %d, want 2", newP.KeyVersion())
	}
	if bytes.Equal(oldP.KEK(), newP.KEK()) {
		t.Fatalf("rotate produced an identical KEK — not fresh")
	}
	dek := mustDEK(t, 32)
	wOld, nOld, _ := oldP.WrapDEK(ctx, dek)
	if _, e := newP.UnwrapDEK(ctx, wOld, nOld); !errors.Is(e, ErrUnwrap) {
		t.Fatalf("new KEK must not open old ciphertext, got %v", e)
	}

	// Rotate must reject a non-increasing version.
	if _, e := oldP.Rotate(ctx, 1); !errors.Is(e, ErrValidation) {
		t.Fatalf("rotate to non-increasing version should fail, got %v", e)
	}
}
