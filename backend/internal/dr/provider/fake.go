package provider

import (
	"context"
	"fmt"
	"sync"
)

// FakeAdapter is a deterministic conformance adapter for tests and local
// contract checks. It is never regulated-compatible.
type FakeAdapter struct {
	mu        sync.Mutex
	created   map[string]string
	tornDown  map[string]bool
	require   []string
	validated Config
}

func NewFakeAdapter(requiredConfig ...string) *FakeAdapter {
	return &FakeAdapter{
		created:  map[string]string{},
		tornDown: map[string]bool{},
		require:  append([]string(nil), requiredConfig...),
	}
}

func (a *FakeAdapter) Capabilities() Capabilities {
	return Capabilities{
		Kind:                KindFake,
		DisplayName:         "Provider conformance fake",
		Live:                false,
		SDKBacked:           false,
		SupportsEnsure:      true,
		SupportsTeardown:    true,
		SupportsDrill:       true,
		SupportsIdempotency: true,
		RegulatedCompatible: false,
		RequiredConfig:      append([]string(nil), a.require...),
	}
}

func (a *FakeAdapter) Validate(cfg Config) error {
	if err := missingRequired(cfg, a.require...); err != nil {
		return err
	}
	a.validated = cfg
	return nil
}

func (a *FakeAdapter) Ensure(_ context.Context, req EnsureRequest) (EnsureResult, error) {
	if req.IdempotencyKey == "" {
		return EnsureResult{}, fmt.Errorf("%w: idempotency key is required", ErrNotConfigured)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if existing := a.created[req.IdempotencyKey]; existing != "" {
		return EnsureResult{ExternalID: existing, Already: true}, nil
	}
	externalID := "fake-" + req.SiteID + "-" + req.StreamID
	a.created[req.IdempotencyKey] = externalID
	a.tornDown[externalID] = false
	return EnsureResult{ExternalID: externalID}, nil
}

func (a *FakeAdapter) Teardown(_ context.Context, req TeardownRequest) error {
	if req.ExternalID == "" {
		return fmt.Errorf("%w: external id is required", ErrNotConfigured)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.tornDown[req.ExternalID]; !ok {
		return fmt.Errorf("fake provider: unknown external id %q", req.ExternalID)
	}
	a.tornDown[req.ExternalID] = true
	return nil
}

func (a *FakeAdapter) TornDown(externalID string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.tornDown[externalID]
}
