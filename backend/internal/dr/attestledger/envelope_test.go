package attestledger

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"testing"

	"github.com/google/uuid"
)

func TestSoftwareKeyProvider_WrapUnwrapRoundTrip(t *testing.T) {
	t.Parallel()
	kp := NewSoftwareKeyProvider()
	tenant := uuid.New()

	dataKey := make([]byte, dataKeySize)
	if _, err := io.ReadFull(rand.Reader, dataKey); err != nil {
		t.Fatal(err)
	}
	wrapped, version, err := kp.WrapDataKey(tenant, dataKey)
	if err != nil {
		t.Fatalf("WrapDataKey: %v", err)
	}
	if version != 1 {
		t.Fatalf("first KEK version = %d, want 1", version)
	}
	// The wrapped blob must NOT contain the plaintext data key.
	if bytes.Contains(wrapped, dataKey) {
		t.Fatal("wrapped blob leaks the plaintext data key")
	}
	got, err := kp.UnwrapDataKey(tenant, wrapped, version)
	if err != nil {
		t.Fatalf("UnwrapDataKey: %v", err)
	}
	if !bytes.Equal(got, dataKey) {
		t.Fatal("unwrapped data key != original")
	}
}

func TestSoftwareKeyProvider_TamperedWrappedKeyFails(t *testing.T) {
	t.Parallel()
	kp := NewSoftwareKeyProvider()
	tenant := uuid.New()
	dataKey := bytes.Repeat([]byte{7}, dataKeySize)
	wrapped, version, err := kp.WrapDataKey(tenant, dataKey)
	if err != nil {
		t.Fatal(err)
	}
	wrapped[len(wrapped)-1] ^= 0xFF // flip a ciphertext bit
	if _, err := kp.UnwrapDataKey(tenant, wrapped, version); !errors.Is(err, ErrUnwrap) {
		t.Fatalf("tampered unwrap error = %v, want ErrUnwrap", err)
	}
}

func TestSoftwareKeyProvider_UnknownVersion(t *testing.T) {
	t.Parallel()
	kp := NewSoftwareKeyProvider()
	tenant := uuid.New()
	dataKey := bytes.Repeat([]byte{1}, dataKeySize)
	wrapped, _, err := kp.WrapDataKey(tenant, dataKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := kp.UnwrapDataKey(tenant, wrapped, 99); !errors.Is(err, ErrKEKVersionUnknown) {
		t.Fatalf("unwrap with unknown version error = %v, want ErrKEKVersionUnknown", err)
	}
}

func TestSoftwareKeyProvider_RotationAndRewrap(t *testing.T) {
	t.Parallel()
	kp := NewSoftwareKeyProvider()
	tenant := uuid.New()
	dataKey := bytes.Repeat([]byte{9}, dataKeySize)

	wrappedV1, v1, err := kp.WrapDataKey(tenant, dataKey)
	if err != nil {
		t.Fatal(err)
	}
	// Rotate the KEK.
	v2, err := kp.RotateKEK(tenant)
	if err != nil {
		t.Fatalf("RotateKEK: %v", err)
	}
	if v2 != v1+1 {
		t.Fatalf("rotated version = %d, want %d", v2, v1+1)
	}
	if cur, _ := kp.CurrentKEKVersion(tenant); cur != v2 {
		t.Fatalf("current version = %d, want %d", cur, v2)
	}
	// Old wrapped key still unwraps under v1 (no data loss across rotation).
	if got, err := kp.UnwrapDataKey(tenant, wrappedV1, v1); err != nil || !bytes.Equal(got, dataKey) {
		t.Fatalf("old wrapped key not unwrappable after rotation: err=%v", err)
	}
	// Rewrap moves it to v2; the new blob unwraps under v2 and yields the same key.
	rewrapped, newVersion, err := kp.RewrapDataKey(tenant, wrappedV1, v1)
	if err != nil {
		t.Fatalf("RewrapDataKey: %v", err)
	}
	if newVersion != v2 {
		t.Fatalf("rewrapped version = %d, want %d", newVersion, v2)
	}
	got, err := kp.UnwrapDataKey(tenant, rewrapped, newVersion)
	if err != nil || !bytes.Equal(got, dataKey) {
		t.Fatalf("rewrapped key wrong: err=%v", err)
	}
}

func TestEnvelopeSealOpen_RoundTrip(t *testing.T) {
	t.Parallel()
	kp := NewSoftwareKeyProvider()
	tenant := uuid.New()
	plaintext := []byte(`{"merkle_root":"abc","from_seq":1,"to_seq":42}`)

	sealed, err := EnvelopeSeal(kp, tenant, plaintext)
	if err != nil {
		t.Fatalf("EnvelopeSeal: %v", err)
	}
	// The ciphertext at rest must not contain the plaintext.
	ct, _ := hex.DecodeString(sealed.Ciphertext)
	if bytes.Contains(ct, plaintext) {
		t.Fatal("sealed ciphertext leaks plaintext")
	}
	out, err := EnvelopeOpen(kp, sealed)
	if err != nil {
		t.Fatalf("EnvelopeOpen: %v", err)
	}
	if !bytes.Equal(out, plaintext) {
		t.Fatal("envelope round-trip mismatch")
	}
}

func TestEnvelopeOpen_TamperedCiphertextFails(t *testing.T) {
	t.Parallel()
	kp := NewSoftwareKeyProvider()
	tenant := uuid.New()
	sealed, err := EnvelopeSeal(kp, tenant, []byte("secret-checkpoint"))
	if err != nil {
		t.Fatal(err)
	}
	// Flip a byte in the hex ciphertext.
	ct, _ := hex.DecodeString(sealed.Ciphertext)
	ct[len(ct)-1] ^= 0x01
	sealed.Ciphertext = hex.EncodeToString(ct)
	if _, err := EnvelopeOpen(kp, sealed); !errors.Is(err, ErrUnwrap) {
		t.Fatalf("tampered envelope error = %v, want ErrUnwrap", err)
	}
}

func TestEnvelopeOpen_WrongTenantKEKFails(t *testing.T) {
	t.Parallel()
	kp := NewSoftwareKeyProvider()
	tenantA := uuid.New()
	tenantB := uuid.New()
	sealed, err := EnvelopeSeal(kp, tenantA, []byte("tenant-A-data"))
	if err != nil {
		t.Fatal(err)
	}
	// Repoint the sealed payload at tenant B (whose KEK is different) — unwrap
	// must fail, proving the bytes are only recoverable with tenant A's KEK.
	sealed.TenantID = tenantB
	if _, err := EnvelopeOpen(kp, sealed); err == nil {
		t.Fatal("envelope opened under the wrong tenant KEK")
	}
}

func TestEnvelopeSeal_MarshalRoundTrip(t *testing.T) {
	t.Parallel()
	kp := NewSoftwareKeyProvider()
	tenant := uuid.New()
	plaintext := []byte("checkpoint-payload-bytes")
	sealed, err := EnvelopeSeal(kp, tenant, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := marshalSealed(sealed)
	if err != nil {
		t.Fatal(err)
	}
	back, err := unmarshalSealed(raw)
	if err != nil {
		t.Fatal(err)
	}
	out, err := EnvelopeOpen(kp, back)
	if err != nil || !bytes.Equal(out, plaintext) {
		t.Fatalf("marshal round-trip envelope failed: err=%v", err)
	}
}

func TestSetTenantKEK_RejectsWrongSize(t *testing.T) {
	t.Parallel()
	kp := NewSoftwareKeyProvider()
	if err := kp.SetTenantKEK(uuid.New(), 1, []byte("short")); err == nil {
		t.Fatal("expected error for non-32-byte KEK")
	}
}
