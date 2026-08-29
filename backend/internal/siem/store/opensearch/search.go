package opensearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

// Search runs a tenant-scoped search. The caller-supplied DSL is parsed and
// a tenant_id term filter is injected into query.bool.filter[]. The DSL is
// rejected if it tries to target _index directly (which would let a caller
// reach another tenant's indices).
func (c *client) Search(ctx context.Context, tenantID uuid.UUID, dsl json.RawMessage) (SearchResult, error) {
	ctx, span := c.startSpan(ctx, "search", tenantID)
	defer span.End()

	body, err := InjectTenantFilter(dsl, tenantID)
	if err != nil {
		return SearchResult{}, err
	}

	start := time.Now()
	defer func() {
		if c.m != nil {
			c.m.SearchDuration.WithLabelValues(tenantID.String()).Observe(time.Since(start).Seconds())
		}
	}()

	path := "/" + storetypes.IndexPattern(tenantID) + "/_search"
	status, respBody, err := c.do(ctx, http.MethodPost, path,
		bytes.NewReader(body),
		http.Header{"Content-Type": []string{"application/json"}})
	if err != nil {
		if c.m != nil {
			c.m.SearchTotal.WithLabelValues(tenantID.String(), "fail").Inc()
		}
		return SearchResult{}, fmt.Errorf("opensearch: search: %w", err)
	}
	if err := classifyStatus(status, respBody); err != nil {
		if c.m != nil {
			c.m.SearchTotal.WithLabelValues(tenantID.String(), "fail").Inc()
		}
		return SearchResult{}, fmt.Errorf("opensearch: search: %w", err)
	}

	var parsed struct {
		ScrollID string `json:"_scroll_id"`
		Hits     struct {
			Total struct {
				Value int `json:"value"`
			} `json:"total"`
			Hits []struct {
				Source storetypes.Document `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return SearchResult{}, fmt.Errorf("opensearch: parse search response: %w", err)
	}
	res := SearchResult{
		Total:    parsed.Hits.Total.Value,
		ScrollID: parsed.ScrollID,
		Hits:     make([]storetypes.Document, 0, len(parsed.Hits.Hits)),
	}
	for _, h := range parsed.Hits.Hits {
		res.Hits = append(res.Hits, h.Source)
	}
	if c.m != nil {
		c.m.SearchTotal.WithLabelValues(tenantID.String(), "ok").Inc()
	}
	return res, nil
}

// InjectTenantFilter takes the caller's DSL and returns a new body with a
// tenant_id term filter merged into query.bool.filter[]. Exposed so tests
// can snapshot the injection across many DSL shapes.
func InjectTenantFilter(dsl json.RawMessage, tenantID uuid.UUID) ([]byte, error) {
	root := map[string]any{}
	if len(dsl) > 0 {
		if err := json.Unmarshal(dsl, &root); err != nil {
			return nil, fmt.Errorf("opensearch: parse DSL: %w", err)
		}
	}

	if containsIndexTarget(root) {
		return nil, fmt.Errorf("%w: rejected at injection", ErrSearchTargetsIndex)
	}

	query, _ := root["query"].(map[string]any)
	if query == nil {
		query = map[string]any{}
	}
	boolQ, _ := query["bool"].(map[string]any)
	if boolQ == nil {
		// Wrap an existing leaf query into a bool query.
		// If the caller wrote {"query": {"match_all": {}}}, we transform
		// it into {"query": {"bool": {"must":[{"match_all":{}}],"filter":[...]}}}.
		if len(query) > 0 {
			must := []any{copyMap(query)}
			query = map[string]any{
				"bool": map[string]any{"must": must},
			}
			boolQ, _ = query["bool"].(map[string]any)
		} else {
			query = map[string]any{"bool": map[string]any{}}
			boolQ, _ = query["bool"].(map[string]any)
		}
	}
	filters, _ := boolQ["filter"].([]any)
	tenantFilter := map[string]any{
		"term": map[string]any{
			"tenant_id": tenantID.String(),
		},
	}
	filters = append(filters, tenantFilter)
	boolQ["filter"] = filters
	query["bool"] = boolQ
	root["query"] = query

	return json.Marshal(root)
}

// containsIndexTarget walks the root and returns true iff any element of the
// form {"term": {"_index": ...}} or {"terms": {"_index": ...}} is present,
// or if there's a top-level "index" key.
func containsIndexTarget(v any) bool {
	switch t := v.(type) {
	case map[string]any:
		if _, ok := t["_index"]; ok {
			return true
		}
		// Reject caller-supplied "index" key at the root.
		if _, ok := t["index"]; ok {
			return true
		}
		for _, vv := range t {
			if containsIndexTarget(vv) {
				return true
			}
		}
	case []any:
		for _, vv := range t {
			if containsIndexTarget(vv) {
				return true
			}
		}
	}
	return false
}

// copyMap returns a shallow copy of a map so we don't share references when
// promoting a leaf query into a bool.must.
func copyMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
