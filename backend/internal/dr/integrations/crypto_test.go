package integrations

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"testing"
)

func testKey(t *testing.T) []byte {
	t.Helper()
	key := make([]byte, keyBytes)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		t.Fatalf("generating test key: %v", err)
	}
	return key
}

func TestNewAESCipher_RejectsWrongKeyLength(t *testing.T) {
	t.Parallel()
	for _, n := range []int{0, 16, 31, 33, 64} {
		if _, err := NewAESCipher(make([]byte, n)); !errors.Is(err, ErrCipher) {
			t.Fatalf("key len %d: err = %v, want ErrCipher", n, err)
		}
	}
}

func TestAESCipher_SealOpenRoundTrip(t *testing.T) {
	t.Parallel()
	c, err := NewAESCipher(testKey(t))
	if err != nil {
		t.Fatalf("NewAESCipher: %v", err)
	}
	plaintext := []byte(`{"endpoint":"https://array","token":"s3cr3t"}`)
	sealed, err := c.Seal(plaintext)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if bytes.Contains(sealed, []byte("s3cr3t")) {
		t.Fatalf("ciphertext leaks plaintext secret")
	}
	if len(sealed) <= nonceBytes {
		t.Fatalf("sealed payload too short: %d bytes", len(sealed))
	}
	opened, err := c.Open(sealed)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if !bytes.Equal(opened, plaintext) {
		t.Fatalf("round-trip mismatch: got %q, want %q", opened, plaintext)
	}
}

func TestAESCipher_SealUsesFreshNonce(t *testing.T) {
	t.Parallel()
	c, err := NewAESCipher(testKey(t))
	if err != nil {
		t.Fatalf("NewAESCipher: %v", err)
	}
	a, _ := c.Seal([]byte("same"))
	b, _ := c.Seal([]byte("same"))
	if bytes.Equal(a, b) {
		t.Fatalf("two seals of identical plaintext are byte-equal (nonce reuse)")
	}
}

func TestAESCipher_OpenTamperDetected(t *testing.T) {
	t.Parallel()
	c, err := NewAESCipher(testKey(t))
	if err != nil {
		t.Fatalf("NewAESCipher: %v", err)
	}
	sealed, err := c.Seal([]byte("integrity-protected"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	// Flip a bit in the ciphertext body (past the nonce prefix).
	tampered := append([]byte(nil), sealed...)
	tampered[len(tampered)-1] ^= 0x01
	if _, err := c.Open(tampered); !errors.Is(err, ErrCipher) {
		t.Fatalf("tampered ciphertext opened or wrong error: %v", err)
	}
}

func TestAESCipher_OpenWrongKeyFails(t *testing.T) {
	t.Parallel()
	c1, _ := NewAESCipher(testKey(t))
	c2, _ := NewAESCipher(testKey(t))
	sealed, err := c1.Seal([]byte("wrong-key-test"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if _, err := c2.Open(sealed); !errors.Is(err, ErrCipher) {
		t.Fatalf("opening under a different key did not fail: %v", err)
	}
}

func TestAESCipher_OpenRejectsShortInput(t *testing.T) {
	t.Parallel()
	c, _ := NewAESCipher(testKey(t))
	if _, err := c.Open([]byte{0x00, 0x01}); !errors.Is(err, ErrCipher) {
		t.Fatalf("short ciphertext err = %v, want ErrCipher", err)
	}
}

func TestLoadKeyFromEnv(t *testing.T) {
	t.Run("unset fails closed", func(t *testing.T) {
		t.Setenv(EncKeyEnv, "")
		if _, err := LoadKeyFromEnv(); !errors.Is(err, ErrCipher) {
			t.Fatalf("err = %v, want ErrCipher", err)
		}
	})
	t.Run("non-base64 fails", func(t *testing.T) {
		t.Setenv(EncKeyEnv, "!!!not base64!!!")
		if _, err := LoadKeyFromEnv(); !errors.Is(err, ErrCipher) {
			t.Fatalf("err = %v, want ErrCipher", err)
		}
	})
	t.Run("wrong length fails", func(t *testing.T) {
		t.Setenv(EncKeyEnv, base64.StdEncoding.EncodeToString(make([]byte, 16)))
		if _, err := LoadKeyFromEnv(); !errors.Is(err, ErrCipher) {
			t.Fatalf("err = %v, want ErrCipher", err)
		}
	})
	t.Run("valid 32-byte key loads and builds a cipher", func(t *testing.T) {
		key := testKey(t)
		t.Setenv(EncKeyEnv, base64.StdEncoding.EncodeToString(key))
		got, err := LoadKeyFromEnv()
		if err != nil {
			t.Fatalf("LoadKeyFromEnv: %v", err)
		}
		if !bytes.Equal(got, key) {
			t.Fatalf("loaded key mismatch")
		}
		if _, err := NewAESCipherFromEnv(); err != nil {
			t.Fatalf("NewAESCipherFromEnv: %v", err)
		}
	})
}
