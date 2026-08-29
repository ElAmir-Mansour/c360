package entitlement

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// recordingInvalidator records every Invalidate* call so the handler's routing
// (invalidate_all vs single-key) is observable without Redis.
type recordingInvalidator struct {
	tenantInvalidations []string
	keyInvalidations    [][2]string // {tenant, key}
}

func (r *recordingInvalidator) InvalidateTenant(_ context.Context, tenantID string) error {
	r.tenantInvalidations = append(r.tenantInvalidations, tenantID)
	return nil
}

func (r *recordingInvalidator) InvalidateKey(_ context.Context, tenantID, key string) error {
	r.keyInvalidations = append(r.keyInvalidations, [2]string{tenantID, key})
	return nil
}

func changedEvent(t *testing.T, tenantID string, payload changedPayload) *events.Event {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return &events.Event{
		Type:     entitlementsChangedType,
		TenantID: tenantID,
		Data:     data,
	}
}

func newTestConsumer(inv Invalidator) *CacheBustConsumer {
	// consumer is nil: handle() never touches it, and Start/Stop are not
	// exercised here (kafka is out of unit-test scope).
	return &CacheBustConsumer{invalidator: inv, logger: zerolog.Nop()}
}

func TestCacheBustConsumer_InvalidateAll(t *testing.T) {
	inv := &recordingInvalidator{}
	c := newTestConsumer(inv)

	err := c.handle(context.Background(), changedEvent(t, "tenant-1", changedPayload{InvalidateAll: true}))
	if err != nil {
		t.Fatalf("handle() error = %v", err)
	}

	if len(inv.tenantInvalidations) != 1 || inv.tenantInvalidations[0] != "tenant-1" {
		t.Fatalf("tenantInvalidations = %v, want [tenant-1]", inv.tenantInvalidations)
	}
	if len(inv.keyInvalidations) != 0 {
		t.Fatalf("keyInvalidations = %v, want none on invalidate_all", inv.keyInvalidations)
	}
}

func TestCacheBustConsumer_SingleKey(t *testing.T) {
	inv := &recordingInvalidator{}
	c := newTestConsumer(inv)

	err := c.handle(context.Background(), changedEvent(t, "tenant-1", changedPayload{EntitlementKey: "app.watheeq"}))
	if err != nil {
		t.Fatalf("handle() error = %v", err)
	}

	if len(inv.keyInvalidations) != 1 {
		t.Fatalf("keyInvalidations = %v, want exactly one", inv.keyInvalidations)
	}
	if inv.keyInvalidations[0] != [2]string{"tenant-1", "app.watheeq"} {
		t.Fatalf("keyInvalidations[0] = %v, want {tenant-1, app.watheeq}", inv.keyInvalidations[0])
	}
	if len(inv.tenantInvalidations) != 0 {
		t.Fatalf("tenantInvalidations = %v, want none on single-key event", inv.tenantInvalidations)
	}
}

func TestCacheBustConsumer_IgnoresOtherEventTypes(t *testing.T) {
	inv := &recordingInvalidator{}
	c := newTestConsumer(inv)

	other := changedEvent(t, "tenant-1", changedPayload{InvalidateAll: true})
	other.Type = "com.clario360.license.assigned"

	if err := c.handle(context.Background(), other); err != nil {
		t.Fatalf("handle() error = %v", err)
	}
	if len(inv.tenantInvalidations) != 0 || len(inv.keyInvalidations) != 0 {
		t.Fatalf("non-entitlements_changed event must not bust the cache; got tenant=%v key=%v",
			inv.tenantInvalidations, inv.keyInvalidations)
	}
}

func TestCacheBustConsumer_SkipsMissingTenantAndMalformed(t *testing.T) {
	inv := &recordingInvalidator{}
	c := newTestConsumer(inv)

	// Missing tenant.
	noTenant := changedEvent(t, "", changedPayload{InvalidateAll: true})
	if err := c.handle(context.Background(), noTenant); err != nil {
		t.Fatalf("handle(noTenant) error = %v", err)
	}

	// Malformed payload (not an error: committed, TTL backstops).
	bad := &events.Event{Type: entitlementsChangedType, TenantID: "tenant-1", Data: json.RawMessage(`{"invalidate_all":`)}
	if err := c.handle(context.Background(), bad); err != nil {
		t.Fatalf("handle(malformed) error = %v", err)
	}

	// Neither invalidate_all nor a key: nothing to do.
	empty := changedEvent(t, "tenant-1", changedPayload{})
	if err := c.handle(context.Background(), empty); err != nil {
		t.Fatalf("handle(empty) error = %v", err)
	}

	if len(inv.tenantInvalidations) != 0 || len(inv.keyInvalidations) != 0 {
		t.Fatalf("expected no invalidations; got tenant=%v key=%v", inv.tenantInvalidations, inv.keyInvalidations)
	}
}
