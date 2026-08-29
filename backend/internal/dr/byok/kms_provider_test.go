package byok

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeCustodian is a REAL in-test HSM/KMS endpoint: it custodies a 32-byte KEK
// and performs genuine AES-256-GCM wrap/unwrap, exactly as a remote custodian
// would. It exercises the RemoteKeyProvider's HTTP request/response codec against
// a server that actually encrypts — so this is not a mock-only test, the crypto
// on the far side is real. The KEK never crosses the wire.
type fakeCustodian struct {
	gcm cipher.AEAD
}

func newFakeCustodian(t *testing.T) *fakeCustodian {
	t.Helper()
	kek := make([]byte, KEKBytes)
	if _, err := io.ReadFull(rand.Reader, kek); err != nil {
		t.Fatalf("kek: %v", err)
	}
	block, _ := aes.NewCipher(kek)
	gcm, _ := cipher.NewGCM(block)
	return &fakeCustodian{gcm: gcm}
}

func (c *fakeCustodian) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/wrap", func(w http.ResponseWriter, r *http.Request) {
		var req remoteWrapRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		pt, err := base64.StdEncoding.DecodeString(req.Plaintext)
		if err != nil || len(pt) == 0 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		nonce := make([]byte, c.gcm.NonceSize())
		_, _ = io.ReadFull(rand.Reader, nonce)
		ct := c.gcm.Seal(nil, nonce, pt, nil)
		_ = json.NewEncoder(w).Encode(remoteWrapResponse{
			Ciphertext: base64.StdEncoding.EncodeToString(ct),
			Nonce:      base64.StdEncoding.EncodeToString(nonce),
		})
	})
	mux.HandleFunc("/unwrap", func(w http.ResponseWriter, r *http.Request) {
		var req remoteUnwrapRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		ct, _ := base64.StdEncoding.DecodeString(req.Ciphertext)
		nonce, _ := base64.StdEncoding.DecodeString(req.Nonce)
		pt, err := c.gcm.Open(nil, nonce, ct, nil)
		if err != nil {
			// The custodian rejects a tampered/foreign ciphertext, exactly as the
			// GCM tag enforces locally in the software provider.
			http.Error(w, "authentication failed", http.StatusForbidden)
			return
		}
		_ = json.NewEncoder(w).Encode(remoteUnwrapResponse{
			Plaintext: base64.StdEncoding.EncodeToString(pt),
		})
	})
	return mux
}

func TestRemoteKeyProvider_RoundTrip(t *testing.T) {
	ctx := context.Background()
	custodian := newFakeCustodian(t)
	srv := httptest.NewServer(custodian.handler())
	defer srv.Close()

	p, err := NewRemoteKeyProvider(RemoteKeyProviderConfig{
		Kind:    ProviderKMS,
		BaseURL: srv.URL,
		KeyRef:  "arn:kms:tenant/key",
		Version: 1,
		Client:  srv.Client(),
	})
	if err != nil {
		t.Fatalf("new remote provider: %v", err)
	}
	if p.Provider() != ProviderKMS || p.KeyVersion() != 1 {
		t.Fatalf("unexpected provider/version: %s/%d", p.Provider(), p.KeyVersion())
	}

	dek := mustDEK(t, 32)
	wrapped, nonce, werr := p.WrapDEK(ctx, dek)
	if werr != nil {
		t.Fatalf("wrap: %v", werr)
	}
	if bytes.Equal(wrapped, dek) {
		t.Fatalf("remote ciphertext equals plaintext")
	}
	got, uerr := p.UnwrapDEK(ctx, wrapped, nonce)
	if uerr != nil {
		t.Fatalf("unwrap: %v", uerr)
	}
	if !bytes.Equal(got, dek) {
		t.Fatalf("remote round-trip mismatch")
	}
}

func TestRemoteKeyProvider_TamperRejectedAsUnwrapError(t *testing.T) {
	ctx := context.Background()
	custodian := newFakeCustodian(t)
	srv := httptest.NewServer(custodian.handler())
	defer srv.Close()

	p, _ := NewRemoteKeyProvider(RemoteKeyProviderConfig{
		Kind: ProviderHSM, BaseURL: srv.URL, KeyRef: "k", Version: 1, Client: srv.Client(),
	})
	dek := mustDEK(t, 32)
	wrapped, nonce, _ := p.WrapDEK(ctx, dek)
	wrapped[0] ^= 0xFF // tamper

	if _, err := p.UnwrapDEK(ctx, wrapped, nonce); !errors.Is(err, ErrUnwrap) {
		t.Fatalf("remote tamper rejection should surface as ErrUnwrap, got %v", err)
	}
}

func TestRemoteKeyProvider_Validation(t *testing.T) {
	cases := []RemoteKeyProviderConfig{
		{Kind: "bogus", BaseURL: "http://x", KeyRef: "k"},
		{Kind: ProviderKMS, BaseURL: "", KeyRef: "k"},
		{Kind: ProviderKMS, BaseURL: "http://x", KeyRef: ""},
	}
	for i, c := range cases {
		if _, err := NewRemoteKeyProvider(c); !errors.Is(err, ErrValidation) {
			t.Fatalf("case %d should fail validation, got %v", i, err)
		}
	}
}

func TestRemoteKeyProvider_Rotate(t *testing.T) {
	p, _ := NewRemoteKeyProvider(RemoteKeyProviderConfig{
		Kind: ProviderKMS, BaseURL: "http://x", KeyRef: "k", Version: 3,
	})
	next, err := p.Rotate(context.Background(), 4)
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if next.KeyVersion() != 4 || next.Provider() != ProviderKMS {
		t.Fatalf("unexpected successor: v%d %s", next.KeyVersion(), next.Provider())
	}
	if _, err := p.Rotate(context.Background(), 3); !errors.Is(err, ErrValidation) {
		t.Fatalf("non-increasing rotate should fail, got %v", err)
	}
}
