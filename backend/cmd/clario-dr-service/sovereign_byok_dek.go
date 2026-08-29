package main

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/byok"
	siemcrypto "github.com/clario360/platform/internal/siem/store/crypto"
)

// byokDEKGate is the narrow part of byok.Service that the WORM encryption path
// needs. WrapDEK is idempotent and ensures a tenant DEK is recorded under the
// active tenant KEK; UnwrapDEK is the actual custody gate before WORM can encrypt
// or decrypt recovery bytes.
type byokDEKGate interface {
	WrapDEK(ctx context.Context, tenantID uuid.UUID, dekID string) (*byok.WrappedDEK, error)
	UnwrapDEK(ctx context.Context, tenantID uuid.UUID, dekID string) ([]byte, error)
}

// sovereignWORMDEKProvider is the DEK provider passed to internal/dr/worm.
// Before BYOK is attached it delegates to the raw per-tenant DEK manager. After
// BYOK is attached, tenants with an active KEK must unwrap the DEK through their
// custody provider before any WORM seal/read can proceed; tenants not enrolled in
// BYOK keep the legacy raw-DEK path so rollout is opt-in and non-disruptive.
type sovereignWORMDEKProvider struct {
	raw siemcrypto.DEKManager

	mu   sync.RWMutex
	gate byokDEKGate

	disposableMu   sync.Mutex
	disposableDEKs map[string]struct{}
}

func newSovereignWORMDEKProvider(raw siemcrypto.DEKManager) *sovereignWORMDEKProvider {
	return &sovereignWORMDEKProvider{
		raw:            raw,
		disposableDEKs: make(map[string]struct{}),
	}
}

// AttachBYOK hot-plugs the BYOK custody service into the already-constructed
// WORM DEK provider. This lets main build WORM first, then construct BYOK over
// the same raw DEK source, without introducing an initialization cycle.
func (p *sovereignWORMDEKProvider) AttachBYOK(gate byokDEKGate) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.gate = gate
}

func (p *sovereignWORMDEKProvider) Get(ctx context.Context, tenantID uuid.UUID, name string) ([]byte, int, error) {
	if p == nil || p.raw == nil {
		return nil, 0, errors.New("dr byok: nil WORM DEK provider")
	}
	p.mu.RLock()
	gate := p.gate
	p.mu.RUnlock()
	if gate == nil {
		return p.raw.Get(ctx, tenantID, name)
	}

	wrapped, err := gate.WrapDEK(ctx, tenantID, name)
	if errors.Is(err, byok.ErrNotEnrolled) {
		return p.raw.Get(ctx, tenantID, name)
	}
	if err != nil {
		return nil, 0, fmt.Errorf("dr byok: ensure wrapped DEK %q: %w", name, err)
	}
	if wrapped == nil {
		return nil, 0, fmt.Errorf("dr byok: ensure wrapped DEK %q: empty custody record", name)
	}
	dek, err := gate.UnwrapDEK(ctx, tenantID, name)
	if err != nil {
		return nil, 0, fmt.Errorf("dr byok: unwrap DEK %q: %w", name, err)
	}
	p.trackDisposable(dek)
	return dek, wrapped.KEKVersion, nil
}

// ReleaseDEK is called by worm.Client immediately after it copies the returned
// DEK into its short-lived AES key buffer. Raw DEKManager slices are cache-owned
// and must not be zeroed; BYOK-unwrapped slices are caller-owned and are tracked
// here so they can be zeroed without touching the raw cache.
func (p *sovereignWORMDEKProvider) ReleaseDEK(dek []byte) {
	key := disposableDEKKey(dek)
	if key == "" {
		return
	}
	p.disposableMu.Lock()
	_, ok := p.disposableDEKs[key]
	if ok {
		delete(p.disposableDEKs, key)
	}
	p.disposableMu.Unlock()
	if ok {
		for i := range dek {
			dek[i] = 0
		}
	}
}

func (p *sovereignWORMDEKProvider) trackDisposable(dek []byte) {
	key := disposableDEKKey(dek)
	if key == "" {
		return
	}
	p.disposableMu.Lock()
	p.disposableDEKs[key] = struct{}{}
	p.disposableMu.Unlock()
}

func disposableDEKKey(dek []byte) string {
	if len(dek) == 0 {
		return ""
	}
	return fmt.Sprintf("%p/%d", &dek[0], len(dek))
}
