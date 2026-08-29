package residency

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/config"
)

// TestEnforcer_AuditsDenyDecision proves the WTQ-SEC-03 code-side audit trail:
// a cross-region denial emits a structured "residency.denied" event carrying the
// tenant, its region, and the service region.
func TestEnforcer_AuditsDenyDecision(t *testing.T) {
	var buf bytes.Buffer
	e := NewEnforcer(config.ResidencyConfig{ServiceRegion: "ksa-central"},
		NewStaticLoader(map[string]string{"tenant-eu": "eu-west"})).
		WithAuditLogger(zerolog.New(&buf))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil)
	req = req.WithContext(auth.WithTenantID(req.Context(), "tenant-eu"))
	rec := httptest.NewRecorder()
	e.Middleware(okHandler()).ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-region request = %d, want 403", rec.Code)
	}
	if !strings.Contains(buf.String(), "residency.denied") {
		t.Fatalf("missing residency.denied audit event: %s", buf.String())
	}
	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("audit log not valid JSON: %v (%s)", err, buf.String())
	}
	if entry["tenant_id"] != "tenant-eu" || entry["tenant_region"] != "eu-west" || entry["service_region"] != "ksa-central" {
		t.Fatalf("audit fields wrong: %v", entry)
	}
	if entry["code"] != "RESIDENCY_VIOLATION" {
		t.Fatalf("audit code wrong: %v", entry["code"])
	}
}

// TestEnforcer_NoAuditOnAllow proves allowed requests are not logged (audit
// noise control) and the logger is purely additive.
func TestEnforcer_NoAuditOnAllow(t *testing.T) {
	var buf bytes.Buffer
	e := NewEnforcer(config.ResidencyConfig{ServiceRegion: "ksa-central"},
		NewStaticLoader(map[string]string{"t": "ksa-central"})).
		WithAuditLogger(zerolog.New(&buf))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil)
	req = req.WithContext(auth.WithTenantID(req.Context(), "t"))
	rec := httptest.NewRecorder()
	e.Middleware(okHandler()).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("same-region request = %d, want 200", rec.Code)
	}
	if buf.Len() != 0 {
		t.Fatalf("no audit expected on allow, got: %s", buf.String())
	}
}
