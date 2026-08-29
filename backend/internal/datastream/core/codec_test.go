package core

import (
	"bytes"
	"crypto/rand"
	"testing"
)

func newTestKey(t *testing.T) []byte {
	t.Helper()
	k := make([]byte, AESKeySize256)
	if _, err := rand.Read(k); err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return k
}

func TestPayloadCodec_RoundTrip(t *testing.T) {
	t.Parallel()

	key := newTestKey(t)
	codec, err := NewPayloadCodec(key)
	if err != nil {
		t.Fatalf("NewPayloadCodec: %v", err)
	}

	cases := [][]byte{
		{},
		[]byte("small"),
		bytes.Repeat([]byte("AAAA"), 50_000), // highly compressible
	}

	for _, raw := range cases {
		wire, err := codec.Encode(raw)
		if err != nil {
			t.Fatalf("Encode: %v", err)
		}
		got, err := codec.Decode(wire)
		if err != nil {
			t.Fatalf("Decode: %v", err)
		}
		if !bytes.Equal(normPayload(got), normPayload(raw)) {
			t.Fatalf("round-trip mismatch: got %d bytes, want %d", len(got), len(raw))
		}
	}
}

func TestPayloadCodec_WrongKeyFails(t *testing.T) {
	t.Parallel()

	enc, err := NewPayloadCodec(newTestKey(t))
	if err != nil {
		t.Fatal(err)
	}
	dec, err := NewPayloadCodec(newTestKey(t)) // different key
	if err != nil {
		t.Fatal(err)
	}

	wire, err := enc.Encode([]byte("secret recovery data"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dec.Decode(wire); err == nil {
		t.Fatal("expected Decode with wrong key to fail, got nil error")
	}
}

func TestPayloadCodec_TamperedCiphertextFails(t *testing.T) {
	t.Parallel()

	key := newTestKey(t)
	codec, err := NewPayloadCodec(key)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := codec.Encode([]byte("integrity-protected"))
	if err != nil {
		t.Fatal(err)
	}
	// Flip a bit in the ciphertext body (past the nonce).
	tampered := append([]byte(nil), wire...)
	tampered[len(tampered)-1] ^= 0x01
	if _, err := codec.Decode(tampered); err == nil {
		t.Fatal("expected GCM authentication failure on tampered ciphertext")
	}
}

func TestNewPayloadCodec_BadKeyLength(t *testing.T) {
	t.Parallel()
	for _, n := range []int{0, 16, 24, 31, 33} {
		if _, err := NewPayloadCodec(make([]byte, n)); err == nil {
			t.Errorf("key length %d: expected error, got nil", n)
		}
	}
}
