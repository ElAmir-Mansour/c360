package agent

import (
	"errors"
	"sync"
)

// IdentityProvider returns the current enrolled mTLS identity. Runtime uses it
// at connection time so a renewed certificate can be used without restarting
// the process.
type IdentityProvider interface {
	Identity() (*Identity, error)
}

// MutableIdentityProvider is a concurrency-safe, hot-swappable identity holder.
type MutableIdentityProvider struct {
	mu sync.RWMutex
	id *Identity
}

// NewMutableIdentityProvider constructs a provider with an initial identity.
func NewMutableIdentityProvider(id *Identity) (*MutableIdentityProvider, error) {
	if id == nil {
		return nil, errors.New("agent: identity provider requires an identity")
	}
	return &MutableIdentityProvider{id: id}, nil
}

// Identity returns the latest identity.
func (p *MutableIdentityProvider) Identity() (*Identity, error) {
	if p == nil {
		return nil, errors.New("agent: identity provider is nil")
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.id == nil {
		return nil, errors.New("agent: identity provider has no identity")
	}
	return p.id, nil
}

// Update publishes a renewed identity for future transport handshakes.
func (p *MutableIdentityProvider) Update(id *Identity) error {
	if p == nil {
		return errors.New("agent: identity provider is nil")
	}
	if id == nil {
		return errors.New("agent: cannot update identity provider with nil identity")
	}
	p.mu.Lock()
	p.id = id
	p.mu.Unlock()
	return nil
}
