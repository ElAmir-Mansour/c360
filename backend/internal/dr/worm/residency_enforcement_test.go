package worm

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/sovereignty"
)

// staticResolver is an in-memory TenantRegionResolver for the data-plane
// residency tests: it maps a tenant UUID to its bound residency region.
type staticResolver struct {
	regions map[string]string
	err     error
}

func (s staticResolver) TenantRegion(_ context.Context, tenantID string) (string, error) {
	if s.err != nil {
		return "", s.err
	}
	return s.regions[tenantID], nil
}

// trippedDEKProvider fails if Get is ever called, proving the residency guard
// short-circuits a rejected Seal/Get BEFORE any DEK fetch / crypto / network I/O.
type trippedDEKProvider struct{ t *testing.T }

func (p trippedDEKProvider) Get(context.Context, uuid.UUID, string) ([]byte, int, error) {
	p.t.Fatalf("DEK provider was called; residency guard must reject the operation BEFORE any DEK fetch")
	return nil, 0, errors.New("unreachable")
}

// newGuardedClient builds a WORM client bound to targetRegion with the given
// resolver attached, but WITHOUT dialing MinIO — the residency guard runs before
// any api call on the reject path, so a real endpoint is never contacted. We use
// a syntactically valid endpoint so New succeeds.
func newGuardedClient(t *testing.T, targetRegion string, resolver TenantRegionResolver, dek DEKProvider) *Client {
	t.Helper()
	c, err := New(Config{
		Endpoint: "127.0.0.1:9000",
		Bucket:   "dr-recovery-points",
		Region:   targetRegion,
	}, dek, zerolog.Nop())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c.WithRegionResolver(resolver)
}

// TestSeal_CrossRegionWriteRejectedByDataPlaneGuard is the core Wave 1 security
// assertion: a recovery-point WRITE for a tenant bound to one region, against a
// WORM bucket in a DIFFERENT region, is REFUSED by the DATA-PLANE guard — not the
// control-plane 403 — before any byte is read, encrypted, or sent to the store.
func TestSeal_CrossRegionWriteRejectedByDataPlaneGuard(t *testing.T) {
	tenantID := uuid.New()
	resolver := staticResolver{regions: map[string]string{
		tenantID.String(): "me-central-1", // tenant bound to KSA
	}}
	// Bucket physically in eu-west-1 — a disallowed target for this tenant.
	c := newGuardedClient(t, "eu-west-1", resolver, trippedDEKProvider{t: t})

	_, err := c.Seal(context.Background(), bytes.NewReader([]byte("regulated recovery bytes")), SealOptions{
		TenantID: tenantID,
		StreamID: "stream-1",
	})
	if err == nil {
		t.Fatal("cross-region Seal must be REJECTED by the data-plane residency guard")
	}
	var rv *sovereignty.RegionViolationError
	if !errors.As(err, &rv) {
		t.Fatalf("error = %v (%T), want a *sovereignty.RegionViolationError", err, err)
	}
	if rv.TenantRegion != "me-central-1" || rv.TargetRegion != "eu-west-1" {
		t.Fatalf("violation = %+v, want tenant=me-central-1 target=eu-west-1", rv)
	}
	if !strings.Contains(err.Error(), "seal") {
		t.Errorf("error %q should identify the seal operation", err.Error())
	}
}

// TestGet_CrossRegionRestoreRejectedByDataPlaneGuard proves the RESTORE/READ path
// is guarded too: a Get for a tenant whose data may not reside in the bucket's
// region is refused before any object is downloaded/decrypted.
func TestGet_CrossRegionRestoreRejectedByDataPlaneGuard(t *testing.T) {
	tenantID := uuid.New()
	resolver := staticResolver{regions: map[string]string{
		tenantID.String(): "me-central-1",
	}}
	c := newGuardedClient(t, "eu-west-1", resolver, trippedDEKProvider{t: t})

	_, err := c.Get(context.Background(), tenantID, "stream-1", "some/object/key.chunk")
	if err == nil {
		t.Fatal("cross-region Get (restore) must be REJECTED by the data-plane residency guard")
	}
	var rv *sovereignty.RegionViolationError
	if !errors.As(err, &rv) {
		t.Fatalf("error = %v (%T), want a *sovereignty.RegionViolationError", err, err)
	}
	if !strings.Contains(err.Error(), "get") {
		t.Errorf("error %q should identify the get operation", err.Error())
	}
}

// TestSeal_ResolverErrorFailsClosed proves that a residency LOOKUP failure (e.g.
// tenant-not-found or DB outage) fails CLOSED: the write is refused, never
// silently permitted.
func TestSeal_ResolverErrorFailsClosed(t *testing.T) {
	tenantID := uuid.New()
	resolver := staticResolver{err: errors.New("db unreachable")}
	c := newGuardedClient(t, "me-central-1", resolver, trippedDEKProvider{t: t})

	_, err := c.Seal(context.Background(), bytes.NewReader([]byte("bytes")), SealOptions{
		TenantID: tenantID,
		StreamID: "stream-1",
	})
	if err == nil {
		t.Fatal("Seal must FAIL CLOSED when the tenant residency region cannot be resolved")
	}
	if !strings.Contains(err.Error(), "residency check failed to resolve") {
		t.Errorf("error %q should report a fail-closed residency resolve failure", err.Error())
	}
	// It must NOT be a region-violation (that is a different, resolved outcome).
	var rv *sovereignty.RegionViolationError
	if errors.As(err, &rv) {
		t.Errorf("resolve failure must not surface as a RegionViolationError")
	}
}

// TestSeal_UnrestrictedTenantPassesGuard proves a tenant with NO residency
// binding (empty region) is allowed through the guard — matching the
// control-plane middleware exactly and preserving behavior. (The guard passes and
// hands off to the DEK fetch, which we let error to stop before any network I/O.)
func TestSeal_UnrestrictedTenantPassesGuard(t *testing.T) {
	tenantID := uuid.New()
	resolver := staticResolver{regions: map[string]string{}} // tenant -> "" (unrestricted)
	dekCalled := false
	dek := funcDEKProvider(func() { dekCalled = true })
	c := newGuardedClient(t, "eu-west-1", resolver, dek)

	// The guard must ALLOW (empty tenant region). Seal then proceeds to the DEK
	// fetch; funcDEKProvider returns an error so we never touch MinIO. The point
	// is that we got PAST the residency guard.
	_, err := c.Seal(context.Background(), bytes.NewReader([]byte("bytes")), SealOptions{
		TenantID: tenantID,
		StreamID: "stream-1",
	})
	if !dekCalled {
		t.Fatal("unrestricted tenant must pass the residency guard and reach the DEK fetch")
	}
	// Any error here is the DEK stub, not a residency violation.
	var rv *sovereignty.RegionViolationError
	if errors.As(err, &rv) {
		t.Fatal("unrestricted tenant must not trigger a RegionViolationError")
	}
}

// TestSeal_SameRegionPassesGuard proves an in-region write passes the guard.
func TestSeal_SameRegionPassesGuard(t *testing.T) {
	tenantID := uuid.New()
	resolver := staticResolver{regions: map[string]string{
		tenantID.String(): "me-central-1",
	}}
	dekCalled := false
	dek := funcDEKProvider(func() { dekCalled = true })
	c := newGuardedClient(t, "me-central-1", resolver, dek) // bucket == tenant region

	_, _ = c.Seal(context.Background(), bytes.NewReader([]byte("bytes")), SealOptions{
		TenantID: tenantID,
		StreamID: "stream-1",
	})
	if !dekCalled {
		t.Fatal("same-region write must pass the residency guard and reach the DEK fetch")
	}
}

// TestSeal_NoResolverPreservesBehavior proves that without a resolver attached
// (the default, non-sovereign deployment) the guard is inert: no residency check
// happens and Seal proceeds straight to the DEK fetch.
func TestSeal_NoResolverPreservesBehavior(t *testing.T) {
	tenantID := uuid.New()
	dekCalled := false
	dek := funcDEKProvider(func() { dekCalled = true })
	c, err := New(Config{
		Endpoint: "127.0.0.1:9000",
		Bucket:   "dr-recovery-points",
		Region:   "eu-west-1",
	}, dek, zerolog.Nop())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if c.ResidencyEnforced() {
		t.Fatal("a client with no resolver must report ResidencyEnforced() == false")
	}

	_, _ = c.Seal(context.Background(), bytes.NewReader([]byte("bytes")), SealOptions{
		TenantID: tenantID,
		StreamID: "stream-1",
	})
	if !dekCalled {
		t.Fatal("with no resolver, Seal must proceed unchanged to the DEK fetch")
	}
}

// TestRegionResolverFromLoader_SatisfiesInterface proves the sovereignty adapter
// over the residency loader structurally satisfies the WORM resolver interface
// and shares the exact same tenant-region source as the control plane.
func TestRegionResolverFromLoader_SatisfiesInterface(t *testing.T) {
	tenantID := uuid.New()
	loader := staticRegionLoader{tenantID.String(): "me-central-1"}
	var r TenantRegionResolver = sovereignty.NewRegionResolverFromLoader(loader)
	got, err := r.TenantRegion(context.Background(), tenantID.String())
	if err != nil {
		t.Fatalf("TenantRegion: %v", err)
	}
	if got != "me-central-1" {
		t.Fatalf("region = %q, want me-central-1", got)
	}
}

// funcDEKProvider is a DEKProvider whose Get records a call then returns an error
// so tests can prove the residency guard was PASSED (Get reached) without any
// MinIO I/O.
type funcDEKProvider func()

func (f funcDEKProvider) Get(context.Context, uuid.UUID, string) ([]byte, int, error) {
	f()
	return nil, 0, errors.New("dek stub: stop before network I/O")
}

// staticRegionLoader satisfies residency.RegionLoader for the adapter test.
type staticRegionLoader map[string]string

func (m staticRegionLoader) TenantRegion(_ context.Context, tenantID string) (string, error) {
	return m[tenantID], nil
}
