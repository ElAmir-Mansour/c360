package repository

import "testing"

func TestUseLibraryKeywordPredicateSkipsQueryForSemanticMode(t *testing.T) {
	tests := []struct {
		name     string
		query    string
		semantic bool
		want     bool
	}{
		{name: "keyword query", query: "privacy duties", want: true},
		{name: "semantic query", query: "privacy duties", semantic: true, want: false},
		{name: "blank query", query: "  ", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := useLibraryKeywordPredicate(tt.query, tt.semantic); got != tt.want {
				t.Fatalf("useLibraryKeywordPredicate(%q, %t) = %t, want %t", tt.query, tt.semantic, got, tt.want)
			}
		})
	}
}
