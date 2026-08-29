package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/rs/zerolog"
)

// TestAssignBaseTrial_OnePostNoOverrides guards the structural core of the
// definitive license-race fix: the async license writer must assign the trial
// plan and touch NO entitlement overrides. If anyone re-introduces a
// revoke/override loop into AssignBaseTrial, this test fails — that loop is the
// exact bug the single-writer model eliminates. (The integration race test
// exercises a recording fake; this one pins the REAL httpLicenseAssigner.)
func TestAssignBaseTrial_OnePostNoOverrides(t *testing.T) {
	var mu sync.Mutex
	type call struct{ method, path string }
	var calls []call
	var lastBody map[string]any

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		calls = append(calls, call{r.Method, r.URL.Path})
		if r.Method == http.MethodPost {
			b, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(b, &lastBody)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	a := &httpLicenseAssigner{
		baseURL:    srv.URL,
		token:      "test-token",
		client:     srv.Client(),
		trialDays:  14,
		trialSeats: 5,
		graceDays:  7,
		logger:     zerolog.Nop(),
	}

	if err := a.AssignBaseTrial(context.Background(), "tenant-1", 3); err != nil {
		t.Fatalf("AssignBaseTrial: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 1 {
		t.Fatalf("expected exactly 1 HTTP call, got %d: %+v", len(calls), calls)
	}
	if calls[0].method != http.MethodPost || calls[0].path != "/internal/licensing/tenants/tenant-1/license" {
		t.Fatalf("expected POST /internal/licensing/tenants/tenant-1/license, got %s %s", calls[0].method, calls[0].path)
	}
	for _, c := range calls {
		if strings.Contains(c.path, "/overrides/") {
			t.Fatalf("AssignBaseTrial must write NO overrides, but called %s %s", c.method, c.path)
		}
	}
	if lastBody["plan_key"] != "trial" {
		t.Fatalf("expected plan_key=trial, got %v", lastBody["plan_key"])
	}
	if seats, _ := lastBody["seats"].(float64); int(seats) != 3 {
		t.Fatalf("expected seats=3, got %v", lastBody["seats"])
	}
}

// TestAssignBaseTrial_FloorsNonPositiveSeats confirms seats<=0 floors to the
// trial default (so an unset onboarding row still gets a valid seat count).
func TestAssignBaseTrial_FloorsNonPositiveSeats(t *testing.T) {
	var mu sync.Mutex
	var lastBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &lastBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	a := &httpLicenseAssigner{baseURL: srv.URL, token: "t", client: srv.Client(), trialDays: 14, trialSeats: 5, graceDays: 7, logger: zerolog.Nop()}
	if err := a.AssignBaseTrial(context.Background(), "tenant-2", 0); err != nil {
		t.Fatalf("AssignBaseTrial: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if seats, _ := lastBody["seats"].(float64); int(seats) != 5 {
		t.Fatalf("expected floored seats=5, got %v", lastBody["seats"])
	}
}
