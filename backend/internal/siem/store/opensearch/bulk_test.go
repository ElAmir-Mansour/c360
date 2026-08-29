package opensearch

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) (*client, func()) {
	t.Helper()
	srv := httptest.NewServer(handler)
	log := zerolog.Nop()
	c, err := NewClient(context.Background(), Config{
		Addresses:       []string{srv.URL},
		HealthMinStatus: "yellow",
		MaxBulkBytes:    1 << 20,
	}, &log, nil)
	if err != nil {
		srv.Close()
		t.Fatalf("NewClient: %v", err)
	}
	return c.(*client), srv.Close
}

func TestBulkIndex_TenantMismatch(t *testing.T) {
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("server should not be hit on mismatch")
	})
	defer cleanup()

	tenant := uuid.New()
	other := uuid.New()
	_, err := c.BulkIndex(context.Background(), tenant, []storetypes.Document{
		{"tenant_id": other.String(), "@timestamp": "2026-05-14"},
	})
	if err == nil {
		t.Fatal("expected mismatch error")
	}
	if !errors.Is(err, ErrTenantMismatch) {
		t.Errorf("err = %v, want ErrTenantMismatch", err)
	}
}

func TestBulkIndex_AssignsTenantWhenMissing(t *testing.T) {
	var seen string
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		seen = string(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"took":1,"errors":false,"items":[{"index":{"status":201}}]}`))
	})
	defer cleanup()

	tenant := uuid.New()
	res, err := c.BulkIndex(context.Background(), tenant, []storetypes.Document{
		{"@timestamp": "2026-05-14"},
	})
	if err != nil {
		t.Fatalf("BulkIndex: %v", err)
	}
	if res.Succeeded != 1 {
		t.Errorf("succeeded = %d", res.Succeeded)
	}
	if !strings.Contains(seen, tenant.String()) {
		t.Errorf("tenant_id not assigned to doc; payload=%s", seen)
	}
}

func TestBulkIndex_PartialFailure(t *testing.T) {
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[
			{"index":{"status":201}},
			{"index":{"status":400,"error":{"type":"mapper_parsing_exception","reason":"bad"}}}
		]}`))
	})
	defer cleanup()

	tenant := uuid.New()
	res, err := c.BulkIndex(context.Background(), tenant, []storetypes.Document{
		{"@timestamp": "a", "tenant_id": tenant.String()},
		{"@timestamp": "b", "tenant_id": tenant.String()},
	})
	if err != nil {
		t.Fatalf("BulkIndex: %v", err)
	}
	if res.Succeeded != 1 || len(res.Failed) != 1 {
		t.Errorf("res = %+v", res)
	}
	if res.Failed[0].Status != 400 || !strings.Contains(res.Failed[0].Reason, "bad") {
		t.Errorf("failed[0] = %+v", res.Failed[0])
	}
}

func TestBulkIndex_Chunking(t *testing.T) {
	docs := make([]storetypes.Document, 0, 100)
	tenant := uuid.New()
	tenantStr := tenant.String()
	for i := 0; i < 50; i++ {
		docs = append(docs, storetypes.Document{
			"tenant_id":  tenantStr,
			"@timestamp": "2026-05-14",
			"payload":    strings.Repeat("x", 1024),
		})
	}

	var calls int
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		// echo a single success per pair
		body, _ := io.ReadAll(r.Body)
		n := bytes.Count(body, []byte("\"_index\""))
		items := make([]string, 0, n)
		for i := 0; i < n; i++ {
			items = append(items, `{"index":{"status":201}}`)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[` + strings.Join(items, ",") + `]}`))
	})
	defer cleanup()
	c.cfg.MaxBulkBytes = 5 * 1024 // force chunking

	res, err := c.BulkIndex(context.Background(), tenant, docs)
	if err != nil {
		t.Fatal(err)
	}
	if calls < 2 {
		t.Errorf("expected at least 2 HTTP calls due to chunking, got %d", calls)
	}
	if res.Succeeded != len(docs) {
		t.Errorf("succeeded=%d want=%d", res.Succeeded, len(docs))
	}
}
