package respond

import (
	"context"
	"errors"
	"testing"

	"github.com/clario360/platform/internal/gateway/entitlement"
)

type fakeEntitlementChecker struct {
	decision entitlement.Decision
	err      error

	lastTenant string
	lastAuth   string
	lastKey    string
}

func (f *fakeEntitlementChecker) Check(_ context.Context, tenantID, authorization, key string) (entitlement.Decision, error) {
	f.lastTenant = tenantID
	f.lastAuth = authorization
	f.lastKey = key
	return f.decision, f.err
}

func TestCheckerResolverDelegatesToLicensing(t *testing.T) {
	checker := &fakeEntitlementChecker{decision: entitlement.Decision{Allowed: true}}
	resolver, err := NewCheckerResolver(checker, false)
	if err != nil {
		t.Fatalf("NewCheckerResolver: %v", err)
	}

	active, reason, err := resolver.Resolve(context.Background(), "tenant-1", "Bearer token", EntitlementMajorIncident)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !active || reason != "" {
		t.Fatalf("Resolve = active:%t reason:%q, want active with empty reason", active, reason)
	}
	if checker.lastTenant != "tenant-1" || checker.lastAuth != "Bearer token" || checker.lastKey != EntitlementMajorIncident {
		t.Fatalf("checker call = tenant:%q auth:%q key:%q", checker.lastTenant, checker.lastAuth, checker.lastKey)
	}
}

func TestCheckerResolverDenialAndOutage(t *testing.T) {
	denied, _ := NewCheckerResolver(&fakeEntitlementChecker{
		decision: entitlement.Decision{Allowed: false, Reason: "not included in plan"},
	}, false)
	active, reason, err := denied.Resolve(context.Background(), "tenant-1", "Bearer token", EntitlementMajorIncident)
	if err != nil {
		t.Fatalf("denied Resolve returned error: %v", err)
	}
	if active || reason != "not included in plan" {
		t.Fatalf("denied Resolve = active:%t reason:%q", active, reason)
	}

	failClosed, _ := NewCheckerResolver(&fakeEntitlementChecker{err: errors.New("connection refused")}, false)
	if active, _, err := failClosed.Resolve(context.Background(), "tenant-1", "Bearer token", EntitlementMajorIncident); active || !errors.Is(err, ErrEntitlementUnavailable) {
		t.Fatalf("fail-closed Resolve = active:%t err:%v, want ErrEntitlementUnavailable", active, err)
	}

	failOpen, _ := NewCheckerResolver(&fakeEntitlementChecker{err: errors.New("connection refused")}, true)
	if active, reason, err := failOpen.Resolve(context.Background(), "tenant-1", "Bearer token", EntitlementMajorIncident); !active || reason == "" || err != nil {
		t.Fatalf("fail-open Resolve = active:%t reason:%q err:%v", active, reason, err)
	}
}
