package main

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/integrations"
	"github.com/clario360/platform/internal/dr/storageoffload"
)

// fakeResolver is an integrations.Resolver that records which tenants it was
// asked to resolve and returns a per-tenant Config, so the resolver-backed array
// client's tenant isolation and caching can be asserted without a database.
type fakeResolver struct {
	mu       sync.Mutex
	calls    []uuid.UUID
	byTenant map[uuid.UUID]integrations.Config
}

func (f *fakeResolver) ResolveActive(_ context.Context, tenantID uuid.UUID, vendor string) (integrations.Integration, integrations.Config, error) {
	f.mu.Lock()
	f.calls = append(f.calls, tenantID)
	f.mu.Unlock()
	cfg, ok := f.byTenant[tenantID]
	if !ok {
		return integrations.Integration{}, integrations.Config{}, integrations.ErrNotFound
	}
	return integrations.Integration{TenantID: tenantID, Vendor: vendor}, cfg, nil
}

// TestResolverArrayClient_FailsClosedWithoutTenant proves the array client never
// falls back to another tenant's credentials: a call with no tenant in ctx errors
// rather than reusing a previously-resolved client.
func TestResolverArrayClient_FailsClosedWithoutTenant(t *testing.T) {
	t.Parallel()
	rc := newResolverArrayClient(&fakeResolver{}, storageoffload.ProviderNetAppONTAP)
	if _, err := rc.clientFor(context.Background()); err == nil {
		t.Fatal("clientFor with no tenant must fail closed, got nil error")
	}
}

// TestResolverArrayClient_PerTenantResolutionAndCache proves each tenant resolves
// its OWN array client (no cross-tenant reuse) and that the client is cached per
// tenant so repeated calls do not re-resolve+re-decrypt.
func TestResolverArrayClient_PerTenantResolutionAndCache(t *testing.T) {
	t.Parallel()
	tenantA, tenantB := uuid.New(), uuid.New()
	res := &fakeResolver{byTenant: map[uuid.UUID]integrations.Config{
		tenantA: {Endpoint: "https://array-a.example", Username: "ua", Token: "ta"},
		tenantB: {Endpoint: "https://array-b.example", Username: "ub", Token: "tb"},
	}}
	rc := newResolverArrayClient(res, storageoffload.ProviderNetAppONTAP)

	ctxA := auth.WithTenantID(context.Background(), tenantA.String())
	a1, err := rc.clientFor(ctxA)
	if err != nil {
		t.Fatalf("tenant A resolve: %v", err)
	}
	a2, err := rc.clientFor(ctxA)
	if err != nil {
		t.Fatalf("tenant A cached resolve: %v", err)
	}
	if a1 != a2 {
		t.Fatal("tenant A client was not cached (re-resolved on second call)")
	}

	ctxB := auth.WithTenantID(context.Background(), tenantB.String())
	b1, err := rc.clientFor(ctxB)
	if err != nil {
		t.Fatalf("tenant B resolve: %v", err)
	}
	if b1 == a1 {
		t.Fatal("tenant B received tenant A's cached client — cross-tenant credential reuse")
	}

	// A resolved once (second call served from cache), B resolved once.
	if len(res.calls) != 2 {
		t.Fatalf("resolver called %d times, want 2 (A once + B once; A's 2nd call cached)", len(res.calls))
	}
}

// TestResolverArrayClient_NoActiveIntegration surfaces a clear ErrNotFound when
// the tenant has no active integration for the vendor.
func TestResolverArrayClient_NoActiveIntegration(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	rc := newResolverArrayClient(
		&fakeResolver{byTenant: map[uuid.UUID]integrations.Config{}},
		storageoffload.ProviderNetAppONTAP,
	)
	ctx := auth.WithTenantID(context.Background(), tenant.String())
	if _, err := rc.clientFor(ctx); !errors.Is(err, integrations.ErrNotFound) {
		t.Fatalf("err = %v, want wrapped ErrNotFound", err)
	}
}
