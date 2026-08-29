package integrations

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
)

// EncKeyEnv is the environment variable holding the base64-encoded 32-byte
// AES-256 key used to seal/open integration credentials at rest.
const EncKeyEnv = "DR_INTEGRATIONS_ENC_KEY"

// keyBytes is the AES-256 key length.
const keyBytes = 32

// nonceBytes is the AES-GCM nonce length: 96 bits, the standard for GCM.
const nonceBytes = 12

// ErrCipher is the base error for credential envelope encryption failures
// (missing/short key, tampered ciphertext). The router never surfaces it to a
// client beyond a 500 — secrets must not leak through error text.
var ErrCipher = errors.New("integrations: credential cipher error")

// Cipher is the credential envelope-encryption seam. The service JSON-marshals a
// Config bundle, Seals it before insert, and Opens it only inside TestConnection
// and ResolveActive. Mirrors the AES-256-GCM AEAD usage in
// internal/dr/byok/software_provider.go.
type Cipher interface {
	// Seal returns the nonce-prefixed AES-256-GCM ciphertext+tag of plaintext.
	Seal(plaintext []byte) (ciphertext []byte, err error)
	// Open reverses Seal. A tampered ciphertext or a wrong key fails the GCM
	// authentication and returns an error wrapping ErrCipher.
	Open(ciphertext []byte) ([]byte, error)
}

// aesCipher is the AES-256-GCM Cipher implementation. Each Seal uses a fresh
// random 96-bit nonce (never reused) which is prefixed to the ciphertext so a
// single BYTEA column round-trips the whole envelope. The GCM authentication tag
// makes any tampering of the ciphertext, or use of the wrong key, fail Open.
type aesCipher struct {
	gcm cipher.AEAD
}

// NewAESCipher constructs an AES-256-GCM Cipher over a 32-byte key. It returns an
// error if the key is not exactly 32 bytes — there is no silent truncation or
// padding.
func NewAESCipher(key []byte) (Cipher, error) {
	if len(key) != keyBytes {
		return nil, fmt.Errorf("%w: key must be %d bytes (AES-256), got %d", ErrCipher, keyBytes, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("%w: constructing AES cipher: %v", ErrCipher, err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("%w: constructing GCM: %v", ErrCipher, err)
	}
	return &aesCipher{gcm: gcm}, nil
}

// Seal GCM-seals plaintext under the key with a fresh random nonce, returning
// nonce || ciphertext+tag.
func (c *aesCipher) Seal(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, nonceBytes)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("%w: generating nonce: %v", ErrCipher, err)
	}
	// Seal appends the ciphertext+tag to the nonce prefix so the whole envelope
	// is one byte slice. No additional authenticated data.
	return c.gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Open splits nonce || ciphertext+tag and GCM-opens it. A short, tampered, or
// wrong-key ciphertext fails authentication and returns an error wrapping
// ErrCipher.
func (c *aesCipher) Open(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) < nonceBytes {
		return nil, fmt.Errorf("%w: ciphertext shorter than nonce", ErrCipher)
	}
	nonce, body := ciphertext[:nonceBytes], ciphertext[nonceBytes:]
	plaintext, err := c.gcm.Open(nil, nonce, body, nil)
	if err != nil {
		// GCM authentication failed: tamper or wrong key. Do not echo details that
		// could aid an attacker beyond the generic cause.
		return nil, fmt.Errorf("%w: open failed", ErrCipher)
	}
	return plaintext, nil
}

// LoadKeyFromEnv reads the base64-encoded 32-byte key from DR_INTEGRATIONS_ENC_KEY.
// It fails CLOSED: an unset or malformed key is an error, never a silently
// generated ephemeral key — that would make every stored credential
// unrecoverable across restarts. Tests use NewAESCipher directly with an
// in-memory key.
func LoadKeyFromEnv() ([]byte, error) {
	raw := os.Getenv(EncKeyEnv)
	if raw == "" {
		return nil, fmt.Errorf("%w: %s is not set", ErrCipher, EncKeyEnv)
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: %s is not valid base64: %v", ErrCipher, EncKeyEnv, err)
	}
	if len(key) != keyBytes {
		return nil, fmt.Errorf("%w: %s must decode to %d bytes, got %d", ErrCipher, EncKeyEnv, keyBytes, len(key))
	}
	return key, nil
}

// NewAESCipherFromEnv builds the production Cipher from DR_INTEGRATIONS_ENC_KEY.
// It is the bridge's entry point; it fails closed when the key is absent.
func NewAESCipherFromEnv() (Cipher, error) {
	key, err := LoadKeyFromEnv()
	if err != nil {
		return nil, err
	}
	return NewAESCipher(key)
}
