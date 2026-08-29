package crypto

import (
	"context"
	"fmt"

	"github.com/clario360/platform/internal/vault"
)

// Transit is the thin adapter over internal/vault.Client used by DEKManager.
// It exists so the DEK manager can be unit-tested with a fake transit, and
// so the contract test can rest assured that no code under internal/siem/store
// reaches vault/api directly.
type Transit interface {
	// EnsureKey idempotently creates the Vault Transit KEK for a tenant.
	EnsureKey(ctx context.Context, keyName string) error
	// Generate returns a freshly-generated 32-byte plaintext DEK plus the
	// Vault-wrapped envelope to persist.
	Generate(ctx context.Context, keyName string) (plaintext []byte, envelope []byte, kekVersion int, err error)
	// Decrypt unwraps a previously stored envelope back to the plaintext DEK.
	Decrypt(ctx context.Context, keyName string, envelope []byte) ([]byte, error)
}

// vaultTransit wraps an internal/vault.Client.
type vaultTransit struct {
	vc vault.Client
}

// NewTransit returns a Transit backed by the provided vault client. The
// returned Transit is safe for concurrent use.
func NewTransit(vc vault.Client) Transit {
	return &vaultTransit{vc: vc}
}

func (t *vaultTransit) EnsureKey(ctx context.Context, keyName string) error {
	if t.vc == nil {
		return fmt.Errorf("%w: vault client nil", ErrDEKUnavailable)
	}
	if err := t.vc.EnsureTransitKey(ctx, keyName); err != nil {
		return fmt.Errorf("%w: %v", ErrDEKUnavailable, err)
	}
	return nil
}

func (t *vaultTransit) Generate(ctx context.Context, keyName string) ([]byte, []byte, int, error) {
	if t.vc == nil {
		return nil, nil, 0, fmt.Errorf("%w: vault client nil", ErrDEKUnavailable)
	}
	dk, err := t.vc.GenerateDataKey(ctx, keyName)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("%w: %v", ErrDEKUnavailable, err)
	}
	if len(dk.Plaintext) != 32 {
		return nil, nil, 0, fmt.Errorf("%w: got %d bytes", ErrInvalidDEK, len(dk.Plaintext))
	}
	return dk.Plaintext, dk.Ciphertext, dk.KEKVersion, nil
}

func (t *vaultTransit) Decrypt(ctx context.Context, keyName string, envelope []byte) ([]byte, error) {
	if t.vc == nil {
		return nil, fmt.Errorf("%w: vault client nil", ErrDEKUnavailable)
	}
	pt, err := t.vc.Decrypt(ctx, keyName, envelope)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDEKUnavailable, err)
	}
	if len(pt) != 32 {
		return nil, fmt.Errorf("%w: got %d bytes", ErrInvalidDEK, len(pt))
	}
	return pt, nil
}
