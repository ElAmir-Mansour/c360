package byok

import (
	"context"

	"github.com/google/uuid"
)

// KeyProvider is the narrow custody boundary: it wraps and unwraps DEKs under a
// tenant KEK that it (and only it) can drive, exposes the KEK version it
// represents, and can Rotate to mint a successor version. Concrete
// implementations:
//
//   - SoftwareKeyProvider — fully real AES-256-GCM envelope encryption with a
//     real 32-byte KEK and a random 96-bit nonce per wrap (software_provider.go).
//   - HSMKeyProvider / KMSKeyProvider — declare the off-box custody path behind
//     this same interface, delegating wrap/unwrap to a remote HSM/cloud-KMS HTTP
//     endpoint so the KEK never leaves the tenant's custody (kms_provider.go).
//
// The provider holds NO database state and is unaware of tenants beyond the KEK
// it custodies; the Service composes providers with the store to realize the
// per-tenant KEK registry, the wrapped-DEK records, and rotation/rewrap.
type KeyProvider interface {
	// KeyVersion returns the KEK version this provider instance represents. The
	// Service pairs a provider with its dr_tenant_kek version so a WrappedDEK can
	// be matched to the provider that produced it.
	KeyVersion() int

	// Provider returns the custody-backend kind (ProviderSoftware|HSM|KMS).
	Provider() string

	// WrapDEK envelope-encrypts a DEK plaintext under the KEK, returning the
	// ciphertext+tag and the nonce that must be presented to UnwrapDEK. The DEK
	// plaintext is never persisted by BYOK — only the returned ciphertext+nonce.
	WrapDEK(ctx context.Context, dek []byte) (wrapped, nonce []byte, err error)

	// UnwrapDEK envelope-decrypts a previously wrapped DEK. A tampered ciphertext,
	// a corrupt nonce, or a ciphertext produced under a different KEK fails the
	// authenticated-decryption check and returns ErrUnwrap.
	UnwrapDEK(ctx context.Context, wrapped, nonce []byte) (dek []byte, err error)

	// Rotate returns a successor KeyProvider representing newVersion, custodying a
	// fresh KEK of the same kind. The current provider remains valid (it still
	// unwraps DEKs wrapped under the old version) until rotation retires it; the
	// successor wraps newly rewrapped DEKs. For software this mints a new random
	// 32-byte KEK; for hsm/kms it points at the next remote key version.
	Rotate(ctx context.Context, newVersion int) (KeyProvider, error)
}

// DEKSource is the interface BYOK uses to obtain DEK plaintext to wrap. It is a
// deliberately narrow projection of internal/siem/store/crypto.DEKManager so this
// package integrates with the platform DEK source WITHOUT importing or modifying
// it: the integration phase passes an adapter whose Get delegates to
// DEKManager.Get(ctx, tenantID, dekID). BYOK only ever sees the DEK plaintext
// transiently to (re)wrap it; it persists only the wrapped form.
type DEKSource interface {
	// GetDEK returns the DEK plaintext identified by (tenantID, dekID). The
	// returned slice is treated as read-only by BYOK and zeroed after wrapping.
	GetDEK(ctx context.Context, tenantID uuid.UUID, dekID string) ([]byte, error)
}
