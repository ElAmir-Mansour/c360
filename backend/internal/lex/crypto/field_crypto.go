// Package crypto provides application-level, field-level encryption at rest for
// sensitive lex (Watheeq) contract fields. It implements the same AES-256-GCM +
// "enc:v1:" ciphertext-prefix envelope approach used by the SIEM field crypto
// (internal/siem/store/crypto), but operates on individual string fields rather
// than whole JSON documents, which is the shape lex contract storage needs.
//
// The design is a KeyProvider seam (mirroring the byok honest-seam style):
//   - SoftwareKeyProvider is the bundled, FULLY REAL provider that custodies a
//     real 32-byte AES-256 key in process memory. It is used by tests and the
//     default software-custody mode.
//   - ExternalKeyProvider is an honest seam for a Vault/KMS-backed deployment:
//     it delegates Key() to an injected resolver so an operator can source the
//     data key from external custody without changing call sites. It is NOT a
//     fake -- it performs the same real AES-256-GCM with whatever key the
//     resolver returns.
//
// Backward compatibility: Decrypt treats any value WITHOUT the "enc:v1:" prefix
// as legacy plaintext and returns it unchanged, so reading rows written before
// encryption was enabled keeps working.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

const (
	// CiphertextPrefix marks an encrypted field value. Values lacking this
	// prefix are treated as legacy plaintext on read.
	CiphertextPrefix = "enc:v1:"
	// gcmNonceSize is the 96-bit (12-byte) nonce size used by AES-GCM.
	gcmNonceSize = 12
	// KeyBytes is the required key length: 32 bytes = AES-256.
	KeyBytes = 32
)

var (
	// ErrInvalidKey is returned when a key is not exactly 32 bytes.
	ErrInvalidKey = errors.New("lex/crypto: key must be 32 bytes (AES-256)")
	// ErrInvalidCiphertext is returned when a ciphertext is malformed.
	ErrInvalidCiphertext = errors.New("lex/crypto: invalid ciphertext")
	// ErrDecryptFailed is returned when GCM authentication fails (tamper, wrong key).
	ErrDecryptFailed = errors.New("lex/crypto: decrypt failed")
)

// KeyProvider supplies the AES-256 data key used to encrypt/decrypt fields. The
// software provider holds a real key in memory; the external provider delegates
// to a resolver so the key can be sourced from Vault/KMS out-of-band.
type KeyProvider interface {
	// Key returns the 32-byte AES-256 key. Implementations must return a copy or
	// a stable slice the caller will not mutate.
	Key() ([]byte, error)
	// Provider returns a short label identifying the custody backend.
	Provider() string
}

// SoftwareKeyProvider is the bundled, fully real provider that custodies a
// 32-byte AES-256 key in process memory. Used by tests and software-custody.
type SoftwareKeyProvider struct {
	key []byte
}

// NewSoftwareKeyProvider constructs a software provider over the supplied
// 32-byte key. It returns ErrInvalidKey if the key is not exactly 32 bytes --
// there is no silent truncation or padding.
func NewSoftwareKeyProvider(key []byte) (*SoftwareKeyProvider, error) {
	if len(key) != KeyBytes {
		return nil, fmt.Errorf("%w: got %d bytes", ErrInvalidKey, len(key))
	}
	keyCopy := make([]byte, KeyBytes)
	copy(keyCopy, key)
	return &SoftwareKeyProvider{key: keyCopy}, nil
}

// NewSoftwareKeyProviderRandom mints a fresh random 32-byte key and returns a
// provider over it. The software-custody enrollment helper (and a convenience
// for tests).
func NewSoftwareKeyProviderRandom() (*SoftwareKeyProvider, error) {
	key := make([]byte, KeyBytes)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("lex/crypto: generating key: %w", err)
	}
	return NewSoftwareKeyProvider(key)
}

// Key implements KeyProvider, returning a copy of the in-memory key.
func (p *SoftwareKeyProvider) Key() ([]byte, error) {
	out := make([]byte, len(p.key))
	copy(out, p.key)
	return out, nil
}

// Provider implements KeyProvider.
func (p *SoftwareKeyProvider) Provider() string { return "software" }

var _ KeyProvider = (*SoftwareKeyProvider)(nil)

// ExternalKeyProvider is an honest seam for a Vault/KMS-backed deployment. It
// delegates key material resolution to an injected function so an operator can
// source the data key from external custody. It is real, not a fake: the actual
// AES-256-GCM is performed over whatever key Resolve returns.
type ExternalKeyProvider struct {
	name    string
	resolve func() ([]byte, error)
}

// NewExternalKeyProvider builds an external provider. name is a custody label
// (e.g. "vault", "aws-kms"); resolve fetches the 32-byte data key.
func NewExternalKeyProvider(name string, resolve func() ([]byte, error)) (*ExternalKeyProvider, error) {
	if resolve == nil {
		return nil, errors.New("lex/crypto: external key provider requires a resolver")
	}
	if strings.TrimSpace(name) == "" {
		name = "external"
	}
	return &ExternalKeyProvider{name: name, resolve: resolve}, nil
}

// Key implements KeyProvider by delegating to the resolver and validating length.
func (p *ExternalKeyProvider) Key() ([]byte, error) {
	key, err := p.resolve()
	if err != nil {
		return nil, fmt.Errorf("lex/crypto: external key resolve: %w", err)
	}
	if len(key) != KeyBytes {
		return nil, fmt.Errorf("%w: external resolver returned %d bytes", ErrInvalidKey, len(key))
	}
	return key, nil
}

// Provider implements KeyProvider.
func (p *ExternalKeyProvider) Provider() string { return p.name }

var _ KeyProvider = (*ExternalKeyProvider)(nil)

// FieldCrypto encrypts and decrypts individual string field values using
// AES-256-GCM with a per-value random nonce, producing "enc:v1:<base64>" output.
type FieldCrypto struct {
	provider KeyProvider
	// previous is an ordered list (newest-first) of SUPERSEDED key providers tried
	// ONLY as a decrypt fallback when the current provider fails to open a
	// ciphertext. It gives key rotation a read path — rows sealed under an old key
	// stay readable until re-encrypted under the current key (F50). Encrypt never
	// consults it; new writes always seal under `provider`.
	previous []KeyProvider
}

// NewFieldCrypto builds a FieldCrypto over the supplied key provider.
func NewFieldCrypto(provider KeyProvider) (*FieldCrypto, error) {
	if provider == nil {
		return nil, errors.New("lex/crypto: FieldCrypto requires a key provider")
	}
	return &FieldCrypto{provider: provider}, nil
}

// WithPreviousKeys registers superseded key providers as DECRYPT-ONLY fallbacks,
// enabling key rotation without a bulk re-encrypt: Decrypt tries the current key
// first, then each previous provider in order. Encrypt NEVER uses these, so a row
// is transparently upgraded to the current key the next time it is written. nil
// entries are ignored. Returns the receiver for chaining.
func (c *FieldCrypto) WithPreviousKeys(providers ...KeyProvider) *FieldCrypto {
	for _, p := range providers {
		if p != nil {
			c.previous = append(c.previous, p)
		}
	}
	return c
}

// Provider returns the custody label of the underlying key provider.
func (c *FieldCrypto) Provider() string {
	if c == nil || c.provider == nil {
		return "none"
	}
	return c.provider.Provider()
}

func (c *FieldCrypto) gcm() (cipher.AEAD, error) {
	return gcmFor(c.provider)
}

// gcmFor builds an AES-256-GCM AEAD from a single key provider. Split out from
// gcm() so Decrypt can try the current provider and each previous-key fallback.
func gcmFor(provider KeyProvider) (cipher.AEAD, error) {
	key, err := provider.Key()
	if err != nil {
		return nil, err
	}
	if len(key) != KeyBytes {
		return nil, fmt.Errorf("%w: got %d bytes", ErrInvalidKey, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// openWith attempts to open a nonce||ciphertext with a single provider. A GCM
// authentication failure (wrong key / tamper) is wrapped as ErrDecryptFailed so
// Decrypt can distinguish it from a provider key-resolution error and decide
// whether to try the next fallback provider.
func openWith(provider KeyProvider, nonce, ct []byte) ([]byte, error) {
	gcm, err := gcmFor(provider)
	if err != nil {
		return nil, err
	}
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDecryptFailed, err)
	}
	return pt, nil
}

// IsEncrypted reports whether a stored value carries the encryption prefix.
func IsEncrypted(value string) bool {
	return strings.HasPrefix(value, CiphertextPrefix)
}

// Encrypt encrypts plaintext, returning "enc:v1:<base64(nonce||ciphertext||tag)>".
// An empty plaintext is returned unchanged (nothing sensitive to protect, and it
// keeps NOT NULL DEFAULT ” columns clean). A value already carrying the prefix
// is returned unchanged so re-encryption is idempotent.
func (c *FieldCrypto) Encrypt(plaintext string) (string, error) {
	if plaintext == "" || IsEncrypted(plaintext) {
		return plaintext, nil
	}
	gcm, err := c.gcm()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcmNonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("lex/crypto: random nonce: %w", err)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	out := make([]byte, 0, len(nonce)+len(sealed))
	out = append(out, nonce...)
	out = append(out, sealed...)
	return CiphertextPrefix + base64.RawURLEncoding.EncodeToString(out), nil
}

// Decrypt decrypts a value produced by Encrypt. Values WITHOUT the "enc:v1:"
// prefix are treated as legacy plaintext and returned unchanged (backward
// compatibility with pre-encryption rows).
func (c *FieldCrypto) Decrypt(value string) (string, error) {
	if !IsEncrypted(value) {
		// Legacy plaintext (or empty) -- return as-is.
		return value, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(value[len(CiphertextPrefix):])
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidCiphertext, err)
	}
	if len(raw) < gcmNonceSize+1 {
		return "", fmt.Errorf("%w: short", ErrInvalidCiphertext)
	}
	nonce := raw[:gcmNonceSize]
	ct := raw[gcmNonceSize:]

	// Try the current key first, then any registered previous keys (rotation
	// fallback). Only an authentication failure (wrong key) falls through to the
	// next provider; a provider-level key-resolution error is returned immediately.
	pt, err := openWith(c.provider, nonce, ct)
	if err == nil {
		return string(pt), nil
	}
	if !errors.Is(err, ErrDecryptFailed) {
		return "", err
	}
	for _, prev := range c.previous {
		if prev == nil {
			continue
		}
		if fallbackPT, ferr := openWith(prev, nonce, ct); ferr == nil {
			return string(fallbackPT), nil
		}
	}
	return "", err
}

// EncryptPtr encrypts a *string: nil is returned unchanged; otherwise the
// pointed-to value is encrypted and a new pointer is returned. Useful for
// nullable counterparty PII columns.
func (c *FieldCrypto) EncryptPtr(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	enc, err := c.Encrypt(*value)
	if err != nil {
		return nil, err
	}
	return &enc, nil
}

// DecryptPtr decrypts a *string, leaving nil and legacy plaintext untouched.
func (c *FieldCrypto) DecryptPtr(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	dec, err := c.Decrypt(*value)
	if err != nil {
		return nil, err
	}
	return &dec, nil
}
