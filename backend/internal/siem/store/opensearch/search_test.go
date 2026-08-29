package opensearch

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestInjectTenantFilter_Shapes(t *testing.T) {
	tenant := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	tenantStr := tenant.String()

	cases := []struct {
		name string
		in   string
	}{
		{"empty", ``},
		{"empty_object", `{}`},
		{"match_all", `{"query":{"match_all":{}}}`},
		{"bool_with_filter", `{"query":{"bool":{"filter":[{"term":{"event.kind":"alert"}}]}}}`},
		{"bool_without_filter", `{"query":{"bool":{"must":[{"match":{"event.action":"login"}}]}}}`},
		{"query_string", `{"query":{"query_string":{"query":"alert AND outcome:fail"}}}`},
		{"scroll", `{"query":{"match_all":{}}, "size":1000, "scroll":"1m"}`},
		{"search_after", `{"query":{"match_all":{}}, "search_after":["2026"]}`},
		{"knn", `{"query":{"knn":{"vector":{"vector":[1,2,3]}}}}`},
		{"terms_set", `{"query":{"terms_set":{"tags":{"terms":["a","b"]}}}}`},
		{"nested", `{"query":{"nested":{"path":"intel.matched","query":{"match":{"intel.matched.source":"misp"}}}}}`},
		{"aggregation", `{"size":0,"aggs":{"by_kind":{"terms":{"field":"event.kind"}}}}`},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			body, err := InjectTenantFilter(json.RawMessage(tc.in), tenant)
			if err != nil {
				t.Fatalf("InjectTenantFilter: %v", err)
			}
			var parsed map[string]any
			if err := json.Unmarshal(body, &parsed); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			q, ok := parsed["query"].(map[string]any)
			if !ok {
				t.Fatalf("query missing: %s", body)
			}
			boolQ, ok := q["bool"].(map[string]any)
			if !ok {
				t.Fatalf("bool missing: %s", body)
			}
			filters, ok := boolQ["filter"].([]any)
			if !ok || len(filters) == 0 {
				t.Fatalf("filters missing: %s", body)
			}
			found := false
			for _, f := range filters {
				m := f.(map[string]any)
				term, _ := m["term"].(map[string]any)
				if term["tenant_id"] == tenantStr {
					found = true
				}
			}
			if !found {
				t.Errorf("tenant_id filter not injected: %s", body)
			}
		})
	}
}

func TestInjectTenantFilter_RejectIndexTarget(t *testing.T) {
	bad := []string{
		`{"query":{"term":{"_index":"siem-foo"}}}`,
		`{"index":"siem-foo","query":{"match_all":{}}}`,
		`{"query":{"bool":{"filter":[{"terms":{"_index":["siem-a","siem-b"]}}]}}}`,
	}
	for _, b := range bad {
		_, err := InjectTenantFilter(json.RawMessage(b), uuid.New())
		if err == nil {
			t.Errorf("expected rejection for %q", b)
			continue
		}
		if !errors.Is(err, ErrSearchTargetsIndex) {
			t.Errorf("err for %q = %v, want ErrSearchTargetsIndex", b, err)
		}
	}
}

func TestInjectTenantFilter_InvalidJSON(t *testing.T) {
	_, err := InjectTenantFilter(json.RawMessage(`{not json`), uuid.New())
	if err == nil || !strings.Contains(err.Error(), "parse") {
		t.Errorf("expected parse error, got %v", err)
	}
}
