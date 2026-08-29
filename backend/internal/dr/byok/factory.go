package byok

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
)

// MemoryProviderFactory is a fully-real ProviderFactory for the software custody
// mode. It mints real random 32-byte KEKs and holds them in process memory keyed
// by an opaque reference, returning real SoftwareKeyProviders that perform
// AES-256-GCM envelope encryption. It is what a deployment uses when the operator
// keystore IS the process (e.g. a single sovereign appliance) and is the
// implementation the unit tests exercise end to end.
//
// A production operator would back this with a sealed keystore (Vault transit,
// an OS keyring, a sealed file) instead of a map; the Service depends only on the
// ProviderFactory interface, so swapping the backend changes nothing above it.
//
// It is safe for concurrent use.
type MemoryProviderFactory struct {
	mu   sync.Mutex
	keks map[string][]byte // reference -> 32-byte KEK
}

// NewMemoryProviderFactory constructs an empty in-memory software keystore.
func NewMemoryProviderFactory() *MemoryProviderFactory {
	return &MemoryProviderFactory{keks: make(map[string][]byte)}
}

// Provider implements ProviderFactory. For provider=software it mints (newKEK) or
// loads (by ref) a real KEK and returns a SoftwareKeyProvider. For hsm/kms it
// returns an error here because this factory is the software keystore; a
// deployment wiring HSM/KMS supplies a different ProviderFactory that returns a
// RemoteKeyProvider. Keeping this factory software-only makes the test surface
// fully real (no remote dependency) while the interface still admits remote
// custody.
func (f *MemoryProviderFactory) Provider(_ context.Context, tenantID uuid.UUID, provider, ref string, version int, newKEK bool) (KeyProvider, string, error) {
	if provider != ProviderSoftware {
		return nil, "", fmt.Errorf("%w: MemoryProviderFactory custodies software KEKs only, got %q", ErrValidation, provider)
	}

	if newKEK {
		kp, kek, err := NewSoftwareKeyProviderRandom(version)
		if err != nil {
			return nil, "", err
		}
		newRef := fmt.Sprintf("mem:%s:v%d:%s", tenantID, version, uuid.NewString())
		f.mu.Lock()
		f.keks[newRef] = kek
		f.mu.Unlock()
		return kp, newRef, nil
	}

	f.mu.Lock()
	kek, ok := f.keks[ref]
	f.mu.Unlock()
	if !ok {
		return nil, "", fmt.Errorf("%w: no software KEK for reference %q", ErrNotFound, ref)
	}
	kp, err := NewSoftwareKeyProvider(version, kek)
	if err != nil {
		return nil, "", err
	}
	return kp, ref, nil
}

var _ ProviderFactory = (*MemoryProviderFactory)(nil)
