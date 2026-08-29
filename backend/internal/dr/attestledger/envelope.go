package attestledger

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"

	"github.com/google/uuid"
)

// KeyProvider is the narrow custody seam for the per-tenant Key Encryption Key
// (KEK) that wraps anchored-checkpoint payloads (BYOK — a tenant KEK layer ABOVE
// the siem DEK). External custody systems (HSM, cloud KMS) implement this
// interface; this package ships a fully real software implementation
// (SoftwareKeyProvider) so the envelope path is exercised end to end without an
// HSM. The provider never exposes the KEK plaintext — it wraps and unwraps a
// caller-supplied data key, the classic envelope-encryption pattern.
type KeyProvider interface {
	// WrapDataKey encrypts a freshly generated data key with the tenant's KEK and
	// returns the opaque wrapped form plus the KEK version it was wrapped under.
	// Rotating the KEK changes the version; old wrapped keys are still unwrappable
	// until rewrapped.
	WrapDataKey(tenantID uuid.UUID, plaintextDataKey []byte) (wrapped []byte, kekVersion int, err error)
	// UnwrapDataKey reverses WrapDataKey for a given KEK version.
	UnwrapDataKey(tenantID uuid.UUID, wrapped []byte, kekVersion int) (plaintextDataKey []byte, err error)
	// CurrentKEKVersion reports the tenant's active KEK version.
	CurrentKEKVersion(tenantID uuid.UUID) (int, error)
}

// Sentinel errors for the envelope layer.
var (
	// ErrKEKVersionUnknown is returned when a wrapped key references a KEK version
	// the provider does not hold.
	ErrKEKVersionUnknown = errors.New("attestledger: unknown KEK version")
	// ErrUnwrap is returned when an authenticated unwrap fails (wrong key,
	// tampered ciphertext).
	ErrUnwrap = errors.New("attestledger: data-key unwrap failed")
)

const dataKeySize = 32 // AES-256 data key

// SealedPayload is the envelope-encrypted form of a checkpoint payload written
// to WORM: a per-payload data key (DEK) encrypts the plaintext with AES-256-GCM,
// and the DEK itself is wrapped by the tenant KEK. Decryption requires the KEK
// (held by the KeyProvider) so the bytes at rest are real ciphertext.
type SealedPayload struct {
	// TenantID identifies the KEK to unwrap with.
	TenantID uuid.UUID `json:"tenant_id"`
	// KEKVersion is the KEK version the WrappedDataKey was wrapped under.
	KEKVersion int `json:"kek_version"`
	// WrappedDataKey is the KEK-encrypted data key (hex).
	WrappedDataKey string `json:"wrapped_data_key"`
	// Ciphertext is AES-256-GCM(dataKey, plaintext) with the nonce prepended (hex).
	Ciphertext string `json:"ciphertext"`
	// PlaintextSHA256 is the hash of the original plaintext, so an auditor can
	// confirm a decrypt round-trips to the expected content.
	PlaintextSHA256 string `json:"plaintext_sha256"`
}

// EnvelopeSeal generates a fresh data key, encrypts plaintext under it with
// AES-256-GCM, wraps the data key with the tenant KEK via the provider, and
// returns the SealedPayload. The data key is zeroed before return. This is the
// real envelope-encryption used to protect a checkpoint before it is sealed to
// WORM.
func EnvelopeSeal(kp KeyProvider, tenantID uuid.UUID, plaintext []byte) (*SealedPayload, error) {
	if kp == nil {
		return nil, errors.New("attestledger: nil key provider")
	}
	dataKey := make([]byte, dataKeySize)
	if _, err := io.ReadFull(rand.Reader, dataKey); err != nil {
		return nil, fmt.Errorf("attestledger: generating data key: %w", err)
	}
	defer zeroBytes(dataKey)

	ciphertext, err := aesGCMSeal(dataKey, plaintext)
	if err != nil {
		return nil, fmt.Errorf("attestledger: encrypting payload: %w", err)
	}
	wrapped, kekVersion, err := kp.WrapDataKey(tenantID, dataKey)
	if err != nil {
		return nil, fmt.Errorf("attestledger: wrapping data key: %w", err)
	}
	sum := sha256.Sum256(plaintext)
	return &SealedPayload{
		TenantID:        tenantID,
		KEKVersion:      kekVersion,
		WrappedDataKey:  hex.EncodeToString(wrapped),
		Ciphertext:      hex.EncodeToString(ciphertext),
		PlaintextSHA256: hex.EncodeToString(sum[:]),
	}, nil
}

// EnvelopeOpen reverses EnvelopeSeal: unwrap the data key with the tenant KEK,
// decrypt the ciphertext, and verify the plaintext hash. It is the round-trip
// proof that the sealed bytes are recoverable only with the KEK.
func EnvelopeOpen(kp KeyProvider, sealed *SealedPayload) ([]byte, error) {
	if kp == nil {
		return nil, errors.New("attestledger: nil key provider")
	}
	if sealed == nil {
		return nil, errors.New("attestledger: nil sealed payload")
	}
	wrapped, err := hex.DecodeString(sealed.WrappedDataKey)
	if err != nil {
		return nil, fmt.Errorf("attestledger: decoding wrapped data key: %w", err)
	}
	ciphertext, err := hex.DecodeString(sealed.Ciphertext)
	if err != nil {
		return nil, fmt.Errorf("attestledger: decoding ciphertext: %w", err)
	}
	dataKey, err := kp.UnwrapDataKey(sealed.TenantID, wrapped, sealed.KEKVersion)
	if err != nil {
		return nil, err
	}
	defer zeroBytes(dataKey)

	plaintext, err := aesGCMOpen(dataKey, ciphertext)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnwrap, err)
	}
	sum := sha256.Sum256(plaintext)
	if hex.EncodeToString(sum[:]) != sealed.PlaintextSHA256 {
		return nil, fmt.Errorf("%w: plaintext hash mismatch after decrypt", ErrUnwrap)
	}
	return plaintext, nil
}

// SoftwareKeyProvider is a fully real, in-process KeyProvider that holds each
// tenant's KEK history in memory and wraps/unwraps data keys with AES-256-GCM.
// It is the tested reference implementation of the custody seam and the BYOK
// path used when no external HSM/KMS is configured. It supports KEK rotation
// (add a new version) and rewrap (re-encrypt a data key under the latest KEK).
type SoftwareKeyProvider struct {
	mu      sync.RWMutex
	tenants map[uuid.UUID]*tenantKEKs
}

type tenantKEKs struct {
	// versions maps a KEK version to its 32-byte key. Append-only: rotation adds
	// a new highest version; old versions are retained so existing wrapped keys
	// stay unwrappable until rewrapped.
	versions map[int][]byte
	current  int
}

// NewSoftwareKeyProvider constructs an empty provider. Tenant KEKs are created
// lazily on first use (or explicitly via SetTenantKEK / RotateKEK).
func NewSoftwareKeyProvider() *SoftwareKeyProvider {
	return &SoftwareKeyProvider{tenants: make(map[uuid.UUID]*tenantKEKs)}
}

// SetTenantKEK installs a tenant's KEK at a known version (used in tests / to
// import a customer-managed key). kek must be 32 bytes.
func (p *SoftwareKeyProvider) SetTenantKEK(tenantID uuid.UUID, version int, kek []byte) error {
	if len(kek) != dataKeySize {
		return fmt.Errorf("attestledger: KEK must be %d bytes, got %d", dataKeySize, len(kek))
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	t := p.tenants[tenantID]
	if t == nil {
		t = &tenantKEKs{versions: make(map[int][]byte)}
		p.tenants[tenantID] = t
	}
	cp := make([]byte, len(kek))
	copy(cp, kek)
	t.versions[version] = cp
	if version > t.current {
		t.current = version
	}
	return nil
}

// ensureTenant returns the tenant's KEK set, generating a random version-1 KEK
// on first use so the provider is self-provisioning.
func (p *SoftwareKeyProvider) ensureTenant(tenantID uuid.UUID) (*tenantKEKs, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if t := p.tenants[tenantID]; t != nil {
		return t, nil
	}
	kek := make([]byte, dataKeySize)
	if _, err := io.ReadFull(rand.Reader, kek); err != nil {
		return nil, fmt.Errorf("attestledger: generating tenant KEK: %w", err)
	}
	t := &tenantKEKs{versions: map[int][]byte{1: kek}, current: 1}
	p.tenants[tenantID] = t
	return t, nil
}

// RotateKEK generates a new random KEK at version current+1 and makes it
// current. Existing wrapped data keys remain unwrappable under their old
// version until RewrapDataKey moves them forward. Returns the new version.
func (p *SoftwareKeyProvider) RotateKEK(tenantID uuid.UUID) (int, error) {
	if _, err := p.ensureTenant(tenantID); err != nil {
		return 0, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	t := p.tenants[tenantID]
	newVersion := t.current + 1
	kek := make([]byte, dataKeySize)
	if _, err := io.ReadFull(rand.Reader, kek); err != nil {
		return 0, fmt.Errorf("attestledger: generating rotated KEK: %w", err)
	}
	t.versions[newVersion] = kek
	t.current = newVersion
	return newVersion, nil
}

// CurrentKEKVersion reports the tenant's active KEK version.
func (p *SoftwareKeyProvider) CurrentKEKVersion(tenantID uuid.UUID) (int, error) {
	t, err := p.ensureTenant(tenantID)
	if err != nil {
		return 0, err
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return t.current, nil
}

// WrapDataKey encrypts plaintextDataKey under the tenant's current KEK. The
// wrapped blob is AES-256-GCM(KEK, dataKey) with the KEK version bound as
// additional authenticated data, so a blob cannot be replayed under a different
// version.
func (p *SoftwareKeyProvider) WrapDataKey(tenantID uuid.UUID, plaintextDataKey []byte) ([]byte, int, error) {
	t, err := p.ensureTenant(tenantID)
	if err != nil {
		return nil, 0, err
	}
	p.mu.RLock()
	version := t.current
	kek := t.versions[version]
	p.mu.RUnlock()

	wrapped, err := aesGCMSealAAD(kek, plaintextDataKey, versionAAD(version))
	if err != nil {
		return nil, 0, fmt.Errorf("attestledger: wrapping data key: %w", err)
	}
	return wrapped, version, nil
}

// UnwrapDataKey decrypts a wrapped data key under the named KEK version.
func (p *SoftwareKeyProvider) UnwrapDataKey(tenantID uuid.UUID, wrapped []byte, kekVersion int) ([]byte, error) {
	t, err := p.ensureTenant(tenantID)
	if err != nil {
		return nil, err
	}
	p.mu.RLock()
	kek, ok := t.versions[kekVersion]
	p.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("%w: tenant %s version %d", ErrKEKVersionUnknown, tenantID, kekVersion)
	}
	dataKey, err := aesGCMOpenAAD(kek, wrapped, versionAAD(kekVersion))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnwrap, err)
	}
	return dataKey, nil
}

// RewrapDataKey re-encrypts a data key that was wrapped under oldVersion to the
// tenant's current KEK version. It is the KEK-rotation rewrap step: unwrap with
// the old version, wrap with the new. Returns the new wrapped blob and version.
func (p *SoftwareKeyProvider) RewrapDataKey(tenantID uuid.UUID, wrapped []byte, oldVersion int) ([]byte, int, error) {
	dataKey, err := p.UnwrapDataKey(tenantID, wrapped, oldVersion)
	if err != nil {
		return nil, 0, err
	}
	defer zeroBytes(dataKey)
	return p.WrapDataKey(tenantID, dataKey)
}

// versionAAD binds a KEK version into the AEAD additional-authenticated-data so a
// wrapped blob is cryptographically tied to its version.
func versionAAD(version int) []byte {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, uint64(version))
	return b
}

// --- AES-256-GCM primitives (real crypto, shared by envelope + payload) ---

func aesGCMSeal(key, plaintext []byte) ([]byte, error) {
	return aesGCMSealAAD(key, plaintext, nil)
}

func aesGCMSealAAD(key, plaintext, aad []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, aad), nil
}

func aesGCMOpen(key, ciphertextWithNonce []byte) ([]byte, error) {
	return aesGCMOpenAAD(key, ciphertextWithNonce, nil)
}

func aesGCMOpenAAD(key, ciphertextWithNonce, aad []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	ns := gcm.NonceSize()
	if len(ciphertextWithNonce) < ns {
		return nil, errors.New("attestledger: ciphertext too short")
	}
	return gcm.Open(nil, ciphertextWithNonce[:ns], ciphertextWithNonce[ns:], aad)
}

func zeroBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

// marshalSealed / unmarshalSealed serialize a SealedPayload to/from the bytes
// written to WORM.
func marshalSealed(s *SealedPayload) ([]byte, error) { return json.Marshal(s) }
func unmarshalSealed(b []byte) (*SealedPayload, error) {
	var s SealedPayload
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	return &s, nil
}
