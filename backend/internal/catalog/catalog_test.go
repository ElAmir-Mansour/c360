package catalog

import (
	"sort"
	"testing"
)

func TestEntitlementKeysForSuites_AliasesAndDedup(t *testing.T) {
	got := EntitlementKeysForSuites([]string{"cyber", "lex", "visus", "lex", "bogus"})
	want := []string{"suite.cyber", "app.watheeq", "app.bosalah"} // lex->watheeq, visus->bosalah, dup+bogus dropped
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("at %d got %q want %q (%v)", i, got[i], want[i], got)
		}
	}
}

func TestUnselectedEntitlementKeys_RevokesTheRest(t *testing.T) {
	// Select cyber + lex; everything else in the self-serve set must be revoked.
	unsel := UnselectedEntitlementKeys([]string{"cyber", "lex"})
	got := append([]string(nil), unsel...)
	sort.Strings(got)
	want := []string{"app.acta", "app.bosalah", "migrate.cloud_migration", "respond.major_incident", "suite.data", "suite.datastream", "suite.siem"}
	sort.Strings(want)
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("at %d got %q want %q", i, got[i], want[i])
		}
	}
}

func TestSelfServeKeys_NoSeatKey(t *testing.T) {
	for _, k := range SelfServeEntitlementKeys() {
		if k == KeySeatsUsers {
			t.Fatalf("self-serve keys must not include the seat meter %q", KeySeatsUsers)
		}
	}
	if !IsSelfServeSuite("siem") || !IsSelfServeSuite("datastream") || !IsSelfServeSuite("respond") || !IsSelfServeSuite("migrate") {
		t.Fatal("siem, datastream, respond, and migrate must be self-serve selectable")
	}
}
