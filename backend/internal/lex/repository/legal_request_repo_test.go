package repository

import (
	"strings"
	"testing"
)

func TestLegalRequestSearchPredicateCoversInboxContract(t *testing.T) {
	predicate := legalRequestSearchPredicate(7)

	for _, column := range []string{
		"lr.request_number",
		"lr.requester_name",
		"lr.title->>'ar'",
		"lr.title->>'en'",
		"lr.description",
	} {
		if !strings.Contains(predicate, column) {
			t.Errorf("search predicate missing %s: %s", column, predicate)
		}
	}
	if strings.Contains(predicate, "$1") {
		t.Fatalf("search predicate reused tenant placeholder $1: %s", predicate)
	}
	if got := strings.Count(predicate, "$7"); got != 5 {
		t.Fatalf("search placeholder count = %d, want 5 branches sharing $7: %s", got, predicate)
	}
}
