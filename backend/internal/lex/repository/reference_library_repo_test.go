package repository

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

func newRefLibMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

// TestBuildReferenceLibraryListWhere proves the pure filter/pagination SQL builder
// emits the correct predicates and positional args for every browse filter combo
// — the exact behaviour the List query depends on — WITHOUT a database.
func TestBuildReferenceLibraryListWhere(t *testing.T) {
	tests := []struct {
		name           string
		filters        model.ReferenceLibraryListFilters
		wantContains   []string
		wantNotContain []string
		wantArgs       []any
		wantNextArg    int
	}{
		{
			name:           "no filters — base predicate only",
			filters:        model.ReferenceLibraryListFilters{},
			wantContains:   []string{"d.deleted_at IS NULL", "d.published = true"},
			wantNotContain: []string{"plainto_tsquery", "d.category =", "d.doc_type =", "ANY(d.tags)"},
			wantArgs:       []any{},
			wantNextArg:    1,
		},
		{
			name:         "search only — FTS + ILIKE on $1",
			filters:      model.ReferenceLibraryListFilters{Search: "  تحكيم  "},
			wantContains: []string{"plainto_tsquery('simple', $1)", "d.title_ar ILIKE '%' || $1 || '%'"},
			wantArgs:     []any{"تحكيم"},
			wantNextArg:  2,
		},
		{
			name:         "category + doc_type — sequential positional args",
			filters:      model.ReferenceLibraryListFilters{Category: "research", DocType: "system"},
			wantContains: []string{"d.category = $1", "d.doc_type = $2"},
			wantArgs:     []any{"research", "system"},
			wantNextArg:  3,
		},
		{
			name:         "all filters — search $1, category $2, doc_type $3, tag $4",
			filters:      model.ReferenceLibraryListFilters{Search: "law", Category: "systems-regulations", DocType: "regulation", Tag: "عقاري"},
			wantContains: []string{"plainto_tsquery('simple', $1)", "d.category = $2", "d.doc_type = $3", "$4 = ANY(d.tags)"},
			wantArgs:     []any{"law", "systems-regulations", "regulation", "عقاري"},
			wantNextArg:  5,
		},
		{
			name:           "blank filters are ignored (trimmed to empty)",
			filters:        model.ReferenceLibraryListFilters{Search: "   ", Category: "  ", Tag: ""},
			wantNotContain: []string{"plainto_tsquery", "d.category =", "ANY(d.tags)"},
			wantArgs:       []any{},
			wantNextArg:    1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			where, args, nextArg := buildReferenceLibraryListWhere(tt.filters)
			for _, want := range tt.wantContains {
				if !strings.Contains(where, want) {
					t.Errorf("where %q missing %q", where, want)
				}
			}
			for _, notWant := range tt.wantNotContain {
				if strings.Contains(where, notWant) {
					t.Errorf("where %q unexpectedly contains %q", where, notWant)
				}
			}
			if nextArg != tt.wantNextArg {
				t.Errorf("nextArg = %d, want %d", nextArg, tt.wantNextArg)
			}
			if len(args) != len(tt.wantArgs) {
				t.Fatalf("args = %v, want %v", args, tt.wantArgs)
			}
			for i := range args {
				if args[i] != tt.wantArgs[i] {
					t.Errorf("args[%d] = %v, want %v", i, args[i], tt.wantArgs[i])
				}
			}
		})
	}
}

func TestBuildReferenceLibraryAuditWhere(t *testing.T) {
	docID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	tests := []struct {
		name         string
		filters      ReferenceLibraryAuditFilters
		wantWhere    string
		wantArgCount int
	}{
		{name: "empty", filters: ReferenceLibraryAuditFilters{}, wantWhere: "TRUE", wantArgCount: 0},
		{name: "document only", filters: ReferenceLibraryAuditFilters{DocumentID: &docID}, wantWhere: "TRUE AND document_id = $1", wantArgCount: 1},
		{name: "action only", filters: ReferenceLibraryAuditFilters{Action: "download"}, wantWhere: "TRUE AND action = $1", wantArgCount: 1},
		{name: "both", filters: ReferenceLibraryAuditFilters{DocumentID: &docID, Action: "ask"}, wantWhere: "TRUE AND document_id = $1 AND action = $2", wantArgCount: 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			where, args := buildReferenceLibraryAuditWhere(tt.filters)
			if where != tt.wantWhere {
				t.Errorf("where = %q, want %q", where, tt.wantWhere)
			}
			if len(args) != tt.wantArgCount {
				t.Errorf("args = %v, want %d args", args, tt.wantArgCount)
			}
		})
	}
}

// TestReferenceLibraryRepositoryList proves the count-then-page flow: an empty
// count short-circuits (no list query), and a non-empty count issues the paged
// row_to_json query with LIMIT/OFFSET bound after the filter args.
func TestReferenceLibraryRepositoryList(t *testing.T) {
	t.Run("empty short-circuits", func(t *testing.T) {
		mock := newRefLibMock(t)
		repo := NewReferenceLibraryRepository(mock, zerolog.Nop())
		mock.ExpectQuery(`SELECT COUNT\(\*\) FROM reference_library_documents`).
			WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))

		items, total, err := repo.List(context.Background(), model.ReferenceLibraryListFilters{})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if total != 0 || len(items) != 0 {
			t.Fatalf("want empty, got total=%d items=%d", total, len(items))
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})

	t.Run("paged with filters", func(t *testing.T) {
		mock := newRefLibMock(t)
		repo := NewReferenceLibraryRepository(mock, zerolog.Nop())
		mock.ExpectQuery(`SELECT COUNT\(\*\) FROM reference_library_documents`).
			WithArgs("research").
			WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(1))
		mock.ExpectQuery(`SELECT row_to_json`).
			WithArgs("research", 25, 0).
			WillReturnRows(pgxmock.NewRows([]string{"row_to_json"}).
				AddRow([]byte(`{"id":"11111111-1111-1111-1111-111111111111","title_ar":"نظام","category":"research"}`)))

		items, total, err := repo.List(context.Background(), model.ReferenceLibraryListFilters{Category: "research"})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if total != 1 || len(items) != 1 {
			t.Fatalf("want 1/1, got total=%d items=%d", total, len(items))
		}
		if items[0].Category != "research" {
			t.Errorf("category = %q, want research", items[0].Category)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})
}

func TestReferenceLibraryRepositoryFingerprint(t *testing.T) {
	mock := newRefLibMock(t)
	repo := NewReferenceLibraryRepository(mock, zerolog.Nop())
	updated := time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`SELECT COUNT\(\*\), MAX\(updated_at\)`).
		WillReturnRows(pgxmock.NewRows([]string{"count", "max"}).AddRow(3, &updated))

	count, maxUpdated, err := repo.Fingerprint(context.Background())
	if err != nil {
		t.Fatalf("Fingerprint: %v", err)
	}
	if count != 3 {
		t.Errorf("count = %d, want 3", count)
	}
	if !maxUpdated.Equal(updated) {
		t.Errorf("maxUpdated = %v, want %v", maxUpdated, updated)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestReferenceLibraryRepositoryFacets(t *testing.T) {
	mock := newRefLibMock(t)
	repo := NewReferenceLibraryRepository(mock, zerolog.Nop())
	mock.ExpectQuery(`GROUP BY category`).
		WillReturnRows(pgxmock.NewRows([]string{"value", "count"}).AddRow("research", 18).AddRow("systems-regulations", 10))
	mock.ExpectQuery(`GROUP BY doc_type`).
		WillReturnRows(pgxmock.NewRows([]string{"value", "count"}).AddRow("research", 18))
	mock.ExpectQuery(`unnest\(tags\)`).
		WillReturnRows(pgxmock.NewRows([]string{"value", "count"}).AddRow("عقاري", 4))

	facets, err := repo.Facets(context.Background())
	if err != nil {
		t.Fatalf("Facets: %v", err)
	}
	if len(facets.Categories) != 2 || facets.Categories[0].Value != "research" || facets.Categories[0].Count != 18 {
		t.Fatalf("categories = %+v", facets.Categories)
	}
	if len(facets.Tags) != 1 || facets.Tags[0].Value != "عقاري" {
		t.Fatalf("tags = %+v", facets.Tags)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
