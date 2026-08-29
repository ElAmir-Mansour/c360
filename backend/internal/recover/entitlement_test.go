package recover

import (
	"context"
	"errors"
	"testing"

	"github.com/clario360/platform/internal/gateway/entitlement"
)

// fakeChecker is an in-memory entitlement.Checker for resolver tests: it
// answers from a per-key decision map and can be made to fail (simulating a
// licensing-service outage).
type fakeChecker struct {
	decisions map[string]entitlement.Decision
	err       error

	lastTenant string
	lastAuth   string
	lastKey    string
}

func (f *fakeChecker) Check(_ context.Context, tenantID, authorization, key string) (entitlement.Decision, error) {
	f.lastTenant = tenantID
	f.lastAuth = authorization
	f.lastKey = key
	if f.err != nil {
		return entitlement.Decision{}, f.err
	}
	return f.decisions[key], nil
}

func TestCheckerResolver_Licensed(t *testing.T) {
	chk := &fakeChecker{decisions: map[string]entitlement.Decision{
		EntitlementITDR: {Allowed: true},
	}}
	r, err := NewCheckerResolver(chk, false)
	if err != nil {
		t.Fatalf("NewCheckerResolver: %v", err)
	}

	active, reason, err := r.Resolve(context.Background(), "tenant-1", "Bearer t", EntitlementITDR)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !active {
		t.Error("licensed key resolved as inactive")
	}
	if reason != "" {
		t.Errorf("reason = %q, want empty for an active entitlement", reason)
	}
	// The token must be forwarded verbatim to the licensing engine so it derives
	// the same tenant — there is exactly one entitlement system.
	if chk.lastAuth != "Bearer t" {
		t.Errorf("forwarded authorization = %q, want %q", chk.lastAuth, "Bearer t")
	}
	if chk.lastKey != EntitlementITDR {
		t.Errorf("checked key = %q, want %q", chk.lastKey, EntitlementITDR)
	}
}

func TestCheckerResolver_NotLicensed(t *testing.T) {
	chk := &fakeChecker{decisions: map[string]entitlement.Decision{
		EntitlementCloudDR: {Allowed: false, Reason: "not included in plan"},
	}}
	r, _ := NewCheckerResolver(chk, false)

	active, reason, err := r.Resolve(context.Background(), "tenant-1", "Bearer t", EntitlementCloudDR)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if active {
		t.Error("unlicensed key resolved as active")
	}
	if reason != "not included in plan" {
		t.Errorf("reason = %q, want %q", reason, "not included in plan")
	}
}

func TestCheckerResolver_FailClosed(t *testing.T) {
	chk := &fakeChecker{err: errors.New("connection refused")}
	r, _ := NewCheckerResolver(chk, false) // production: fail closed

	active, _, err := r.Resolve(context.Background(), "tenant-1", "Bearer t", EntitlementITDR)
	if active {
		t.Error("outage must not resolve as active when failing closed")
	}
	if !errors.Is(err, ErrEntitlementUnavailable) {
		t.Fatalf("err = %v, want ErrEntitlementUnavailable", err)
	}
}

func TestCheckerResolver_FailOpen(t *testing.T) {
	chk := &fakeChecker{err: errors.New("connection refused")}
	r, _ := NewCheckerResolver(chk, true) // dev: fail open

	active, reason, err := r.Resolve(context.Background(), "tenant-1", "Bearer t", EntitlementITDR)
	if err != nil {
		t.Fatalf("Resolve fail-open returned error: %v", err)
	}
	if !active {
		t.Error("fail-open must resolve an outage as active")
	}
	if reason == "" {
		t.Error("fail-open must record a reason explaining the degraded decision")
	}
}

func TestNewCheckerResolver_NilChecker(t *testing.T) {
	if _, err := NewCheckerResolver(nil, false); err == nil {
		t.Fatal("expected error for nil checker")
	}
}
