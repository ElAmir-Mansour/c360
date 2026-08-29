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

// BulkIndex submits docs to /_bulk in body-size-bounded chunks. Per-document
// errors are returned in BulkResult.Failed. Returns ErrTenantMismatch if any
// document's tenant_id field disagrees with tenantID.
func (c *client) BulkIndex(ctx context.Context, tenantID uuid.UUID, docs []storetypes.Document) (BulkResult, error) {
	ctx, span := c.startSpan(ctx, "bulk_index", tenantID)
	defer span.End()

	out := BulkResult{}
	if len(docs) == 0 {
		return out, nil
	}

	// Pre-validate tenant_id on every document. Mismatch is fatal — we do
	// NOT submit a partial batch.
	expected := tenantID.String()
	for i, d := range docs {
		got, _ := d["tenant_id"].(string)
		if got == "" {
			d["tenant_id"] = expected
			continue
		}
		if got != expected {
			return out, fmt.Errorf("%w: doc %d has tenant_id=%q expected=%q", ErrTenantMismatch, i, got, expected)
		}
	}

	alias := storetypes.WriteAlias(tenantID)
	start := time.Now()
	defer func() {
		if c.m != nil {
			c.m.BulkDuration.WithLabelValues(tenantID.String()).Observe(time.Since(start).Seconds())
		}
	}()

	// Build chunked bodies. Each doc emits 2 NDJSON lines (action + source).
	chunks, err := buildBulkChunks(docs, alias, c.cfg.MaxBulkBytes)
	if err != nil {
		return out, err
	}

	for _, body := range chunks {
		status, respBody, err := c.do(ctx, http.MethodPost, "/_bulk",
			bytes.NewReader(body),
			http.Header{"Content-Type": []string{"application/x-ndjson"}})
		if err != nil {
			return out, fmt.Errorf("opensearch: bulk request: %w", err)
		}
		if err := classifyStatus(status, respBody); err != nil {
			return out, fmt.Errorf("opensearch: bulk: %w", err)
		}
		ok, failed, parseErr := parseBulkResponse(respBody)
		if parseErr != nil {
			return out, parseErr
		}
		out.Succeeded += ok
		out.Failed = append(out.Failed, failed...)
	}

	if c.m != nil {
		c.m.BulkDocsTotal.WithLabelValues(tenantID.String(), "ok").Add(float64(out.Succeeded))
		c.m.BulkDocsTotal.WithLabelValues(tenantID.String(), "fail").Add(float64(len(out.Failed)))
	}
	return out, nil
}

// buildBulkChunks splits docs into NDJSON bodies each under maxBytes.
func buildBulkChunks(docs []storetypes.Document, alias string, maxBytes int) ([][]byte, error) {
	if maxBytes <= 0 {
		maxBytes = 5 * 1024 * 1024
	}
	actionLine := []byte(fmt.Sprintf("{\"index\":{\"_index\":%q}}\n", alias))
	var chunks [][]byte
	var current bytes.Buffer
	for _, d := range docs {
		src, err := json.Marshal(d)
		if err != nil {
			return nil, fmt.Errorf("opensearch: marshal doc: %w", err)
		}
		pairSize := len(actionLine) + len(src) + 1
		if current.Len() > 0 && current.Len()+pairSize > maxBytes {
			chunks = append(chunks, append([]byte(nil), current.Bytes()...))
			current.Reset()
		}
		current.Write(actionLine)
		current.Write(src)
		current.WriteByte('\n')
	}
	if current.Len() > 0 {
		chunks = append(chunks, append([]byte(nil), current.Bytes()...))
	}
	return chunks, nil
}

// parseBulkResponse extracts per-item success/failure counts.
func parseBulkResponse(body []byte) (int, []FailedDoc, error) {
	var parsed struct {
		Items []map[string]struct {
			Status int `json:"status"`
			Error  *struct {
				Type   string `json:"type"`
				Reason string `json:"reason"`
			} `json:"error"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return 0, nil, fmt.Errorf("opensearch: parse bulk response: %w", err)
	}
	var ok int
	var failed []FailedDoc
	for i, item := range parsed.Items {
		for _, v := range item { // expect exactly one key (index/create/update)
			if v.Error != nil || v.Status >= 300 {
				reason := ""
				typ := ""
				if v.Error != nil {
					reason = v.Error.Reason
					typ = v.Error.Type
				}
				failed = append(failed, FailedDoc{Index: i, Status: v.Status, Type: typ, Reason: reason})
			} else {
				ok++
			}
		}
	}
	return ok, failed, nil
}
