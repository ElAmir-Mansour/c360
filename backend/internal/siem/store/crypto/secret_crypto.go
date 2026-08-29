package crypto

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

// llmCredentialIndexPrefix is the logical-purpose prefix for the per-tenant DEK
// that protects an LLM API key. The FULL index name is per-tenant
// ("llm-credential-<tenantID>") so every tenant gets its own row in
// siem.index_metadata. That table keys envelopes by index_name (PRIMARY KEY), so
// a shared constant would cause tenant B's envelope to overwrite tenant A's --
// the per-tenant suffix prevents that collision and guarantees crypto isolation.
const llmCredentialIndexPrefix = "llm-credential-"

// LLMCredentialIndex returns the per-tenant DEK index name used to encrypt that
// tenant's LLM API key. Callers MUST pass this exact value to Encrypt/Decrypt.
func LLMCredentialIndex(tenantID uuid.UUID) string {
	return llmCredentialIndexPrefix + tenantID.String()
}

// SecretCrypto encrypts/decrypts a single opaque secret (e.g. an LLM API key)
// using the same per-(tenant, index) DEK + AES-GCM envelope as FieldCrypto. It
// exists because FieldCrypto operates on a PII-registry-keyed Document, which is
// awkward for one standalone secret. SecretCrypto reuses the audited newGCM /
// encryptValue / decryptValue primitives so there is exactly one AES-GCM
// implementation in the codebase and the on-disk format stays "enc:v1:...".
type SecretCrypto interface {
	// Encrypt seals plaintext under the tenant's DEK for indexName, returning the
	// "enc:v1:" ciphertext, the DEKRef that locates the envelope, and the KEK
	// version. The DEK is owned by the manager and is NOT zeroed here; the caller
	// owns and should zero the plaintext slice.
	Encrypt(ctx context.Context, tenantID uuid.UUID, indexName string, plaintext []byte) (cipher string, dekRef storetypes.DEKRef, kekVersion int, err error)
	// Decrypt opens an "enc:v1:" ciphertext under the tenant's DEK for indexName.
	// The returned plaintext is owned by the CALLER, which must zero it after use.
	Decrypt(ctx context.Context, tenantID uuid.UUID, indexName, cipher string) (plaintext []byte, err error)
}

type secretCrypto struct {
	dek DEKManager
}

// NewSecretCrypto builds a SecretCrypto backed by the given DEKManager.
func NewSecretCrypto(dek DEKManager) (SecretCrypto, error) {
	if dek == nil {
		return nil, fmt.Errorf("crypto: SecretCrypto requires DEK manager")
	}
	return &secretCrypto{dek: dek}, nil
}

func (s *secretCrypto) Encrypt(ctx context.Context, tenantID uuid.UUID, indexName string, plaintext []byte) (string, storetypes.DEKRef, int, error) {
	if indexName == "" {
		return "", "", 0, fmt.Errorf("crypto: indexName required")
	}
	dek, kekVersion, err := s.dek.Get(ctx, tenantID, indexName)
	if err != nil {
		return "", "", 0, err
	}
	gcm, err := newGCM(dek)
	if err != nil {
		return "", "", 0, err
	}
	cipher, err := encryptValue(gcm, plaintext)
	if err != nil {
		return "", "", 0, err
	}
	dekRef := storetypes.NewDEKRef(tenantID, indexName, kekVersion)
	return cipher, dekRef, kekVersion, nil
}

func (s *secretCrypto) Decrypt(ctx context.Context, tenantID uuid.UUID, indexName, cipher string) ([]byte, error) {
	if indexName == "" {
		return nil, fmt.Errorf("crypto: indexName required")
	}
	dek, _, err := s.dek.Get(ctx, tenantID, indexName)
	if err != nil {
		return nil, err
	}
	gcm, err := newGCM(dek)
	if err != nil {
		return nil, err
	}
	return decryptValue(gcm, cipher)
}
