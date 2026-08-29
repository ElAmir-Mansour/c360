package recover

import (
	"testing"

	"github.com/clario360/platform/internal/license/model"
)

// TestRegistry_Shape asserts the capability registry maps the three named
// sub-solutions onto the real, wired dr/* services with stable slugs and the
// canonical entitlement keys.
func TestRegistry_Shape(t *testing.T) {
	subs := Registry()
	if len(subs) != 3 {
		t.Fatalf("registry sub-solutions = %d, want 3", len(subs))
	}

	want := map[string]struct {
		key   string
		label string
	}{
		SubSolutionITDR:          {EntitlementITDR, "IT Disaster Recovery"},
		SubSolutionCloudDR:       {EntitlementCloudDR, "Cloud Disaster Recovery"},
		SubSolutionCyberRecovery: {EntitlementCyberRecovery, "Cyber Recovery"},
	}

	seen := map[string]bool{}
	for _, ss := range subs {
		exp, ok := want[ss.ID]
		if !ok {
			t.Errorf("unexpected sub-solution %q", ss.ID)
			continue
		}
		seen[ss.ID] = true
		if ss.EntitlementKey != exp.key {
			t.Errorf("%s entitlement key = %q, want %q", ss.ID, ss.EntitlementKey, exp.key)
		}
		if ss.Label != exp.label {
			t.Errorf("%s label = %q, want %q", ss.ID, ss.Label, exp.label)
		}
		if ss.ValueProp == "" {
			t.Errorf("%s missing value prop", ss.ID)
		}
		if len(ss.Capabilities) == 0 {
			t.Errorf("%s composes no capabilities", ss.ID)
		}
		for _, c := range ss.Capabilities {
			if c.ID == "" || c.Label == "" || c.Service == "" {
				t.Errorf("%s capability incomplete: %+v", ss.ID, c)
			}
		}
		// On a fresh view (no tenant resolution) entitlement state is unset.
		if ss.Entitlement != nil {
			t.Errorf("%s registry copy must not carry entitlement state", ss.ID)
		}
	}
	for id := range want {
		if !seen[id] {
			t.Errorf("missing sub-solution %q", id)
		}
	}
}

// TestRegistry_CapabilitiesAreRealServices asserts every capability names a
// dr/* package under the platform module path (composed, not aspirational).
func TestRegistry_CapabilitiesAreRealServices(t *testing.T) {
	const prefix = "github.com/clario360/platform/internal/dr/"
	for _, ss := range Registry() {
		for _, c := range ss.Capabilities {
			if len(c.Service) <= len(prefix) || c.Service[:len(prefix)] != prefix {
				t.Errorf("%s capability %q service %q is not a dr/* package", ss.ID, c.ID, c.Service)
			}
		}
	}
}

// TestRegistry_ReturnsIndependentCopies asserts the registry is immutable: a
// caller decorating one returned view cannot mutate package-level data or a
// subsequent caller's view.
func TestRegistry_ReturnsIndependentCopies(t *testing.T) {
	first := Registry()
	first[0].Label = "MUTATED"
	first[0].Capabilities[0].Label = "MUTATED"

	second := Registry()
	if second[0].Label == "MUTATED" {
		t.Error("mutating a returned view leaked into a later Registry() call (sub-solution)")
	}
	if second[0].Capabilities[0].Label == "MUTATED" {
		t.Error("mutating a returned view leaked into a later Registry() call (capability)")
	}
}

// TestEntitlementKeys_RegisteredInLicensingModel asserts the three Recover keys
// are present in the canonical licensing-engine key registry — proving the
// product reuses the existing entitlement system rather than a private list.
func TestEntitlementKeys_RegisteredInLicensingModel(t *testing.T) {
	registered := map[string]bool{}
	for _, k := range model.EntitlementKeys {
		registered[k.Key] = true
	}
	for _, key := range []string{EntitlementITDR, EntitlementCloudDR, EntitlementCyberRecovery} {
		if !registered[key] {
			t.Errorf("entitlement key %q not registered in license model.EntitlementKeys", key)
		}
	}
}

// TestSubSolutionIDs asserts the slug helper matches the registry order.
func TestSubSolutionIDs(t *testing.T) {
	ids := SubSolutionIDs()
	want := []string{SubSolutionITDR, SubSolutionCloudDR, SubSolutionCyberRecovery}
	if len(ids) != len(want) {
		t.Fatalf("ids = %v, want %v", ids, want)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Errorf("ids[%d] = %q, want %q", i, ids[i], want[i])
		}
	}
}
