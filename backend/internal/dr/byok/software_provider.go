package byok

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
	"io"
)

// KEKBytes is the byte length of a software KEK: 32 bytes = AES-256.
const KEKBytes = 32

// nonceBytes is the AES-GCM nonce length: 96 bits, the standard for GCM.
const nonceBytes = 12

// SoftwareKeyProvider is the bundled, FULLY REAL KeyProvider. It custodies a
// real 32-byte KEK and performs AES-256-GCM envelope encryption of DEKs:
//
//	WrapDEK(dek)        = GCM.Seal(nonce, dek)  with a fresh random 96-bit nonce
//	UnwrapDEK(ct, nonce)= GCM.Open(nonce, ct)
//
// The KEK is the GCM key; each wrap uses a fresh random nonce from crypto/rand
// (never reused), and the GCM authentication tag makes any tampering of the
// ciphertext or use of the wrong KEK fail UnwrapDEK with ErrUnwrap. This is the
// one fully-real, fully-tested implementation behind the KeyProvider boundary;
// the HSM/KMS providers delegate the same operation to remote custody.
//
// In a real deployment the operator does NOT hold this KEK at rest in plaintext;
// it is sourced from the operator-side keystore referenced by dr_tenant_kek.
// Reference at process start. For tests and the software custody mode the KEK is
// held in process memory only.
type SoftwareKeyProvider struct {
	version int
	kek     []byte
	gcm     cipher.AEAD
}

// NewSoftwareKeyProvider constructs a software provider for keyVersion over the
// supplied 32-byte KEK. It returns an error if the KEK is not exactly 32 bytes
// (AES-256) — there is no silent truncation or padding.
func NewSoftwareKeyProvider(keyVersion int, kek []byte) (*SoftwareKeyProvider, error) {
	if len(kek) != KEKBytes {
		return nil, fmt.Errorf("%w: KEK must be %d bytes (AES-256), got %d", ErrValidation, KEKBytes, len(kek))
	}
	block, err := aes.NewCipher(kek)
	if err != nil {
		return nil, fmt.Errorf("byok: constructing AES cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("byok: constructing GCM: %w", err)
	}
	// Copy the KEK so callers cannot mutate it under us, and so Rotate can derive
	// a successor without aliasing.
	keyCopy := make([]byte, KEKBytes)
	copy(keyCopy, kek)
	return &SoftwareKeyProvider{version: keyVersion, kek: keyCopy, gcm: gcm}, nil
}

// GenerateSoftwareKEK returns a fresh cryptographically-random 32-byte KEK from
// crypto/rand. Used to mint a tenant's first KEK and rotation successors.
func GenerateSoftwareKEK() ([]byte, error) {
	kek := make([]byte, KEKBytes)
	if _, err := io.ReadFull(rand.Reader, kek); err != nil {
		return nil, fmt.Errorf("byok: generating KEK: %w", err)
	}
	return kek, nil
}

// NewSoftwareKeyProviderRandom mints a fresh random KEK and returns a provider
// for keyVersion over it, plus the raw KEK bytes (so the operator keystore can
// persist them out-of-band). It is the software-custody enrollment helper.
func NewSoftwareKeyProviderRandom(keyVersion int) (*SoftwareKeyProvider, []byte, error) {
	kek, err := GenerateSoftwareKEK()
	if err != nil {
		return nil, nil, err
	}
	p, err := NewSoftwareKeyProvider(keyVersion, kek)
	if err != nil {
		return nil, nil, err
	}
	return p, kek, nil
}

// KeyVersion implements KeyProvider.
func (p *SoftwareKeyProvider) KeyVersion() int { return p.version }

// Provider implements KeyProvider.
func (p *SoftwareKeyProvider) Provider() string { return ProviderSoftware }

// WrapDEK GCM-seals dek under the KEK with a fresh random 96-bit nonce. It
// returns the ciphertext+tag and the nonce; both must be persisted to later
// unwrap. The DEK plaintext is not retained.
func (p *SoftwareKeyProvider) WrapDEK(_ context.Context, dek []byte) ([]byte, []byte, error) {
	if len(dek) == 0 {
		return nil, nil, fmt.Errorf("%w: DEK is empty", ErrValidation)
	}
	nonce := make([]byte, nonceBytes)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, fmt.Errorf("byok: generating nonce: %w", err)
	}
	// Seal with no additional data; binding to the KEK version is enforced at the
	// store level (a WrappedDEK row carries kek_version) and structurally by GCM
	// (a different KEK cannot open it).
	wrapped := p.gcm.Seal(nil, nonce, dek, nil)
	return wrapped, nonce, nil
}

// UnwrapDEK GCM-opens wrapped under the KEK with the supplied nonce. A tampered
// ciphertext, a wrong-length/corrupt nonce, or a ciphertext produced under a
// different KEK fails the GCM authentication and returns ErrUnwrap.
func (p *SoftwareKeyProvider) UnwrapDEK(_ context.Context, wrapped, nonce []byte) ([]byte, error) {
	if len(nonce) != nonceBytes {
		return nil, fmt.Errorf("%w: nonce must be %d bytes, got %d", ErrUnwrap, nonceBytes, len(nonce))
	}
	if len(wrapped) == 0 {
		return nil, fmt.Errorf("%w: empty ciphertext", ErrUnwrap)
	}
	dek, err := p.gcm.Open(nil, nonce, wrapped, nil)
	if err != nil {
		// GCM authentication failed: tamper, wrong nonce, or wrong KEK version.
		return nil, fmt.Errorf("%w: %v", ErrUnwrap, err)
	}
	return dek, nil
}

// Rotate mints a fresh random successor KEK and returns a SoftwareKeyProvider for
// newVersion. The receiver is unchanged and still unwraps DEKs wrapped under the
// old version until rotation retires it.
func (p *SoftwareKeyProvider) Rotate(_ context.Context, newVersion int) (KeyProvider, error) {
	if newVersion <= p.version {
		return nil, fmt.Errorf("%w: new version %d must exceed current %d", ErrValidation, newVersion, p.version)
	}
	next, _, err := NewSoftwareKeyProviderRandom(newVersion)
	if err != nil {
		return nil, err
	}
	return next, nil
}

// KEK returns a copy of the raw KEK bytes. Used only by the software-custody
// keystore adapter to persist/reload the key out-of-band; it is never logged or
// returned over the API.
func (p *SoftwareKeyProvider) KEK() []byte {
	out := make([]byte, len(p.kek))
	copy(out, p.kek)
	return out
}

var _ KeyProvider = (*SoftwareKeyProvider)(nil)
