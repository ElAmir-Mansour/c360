package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/gateway/audittap"
	gwconfig "github.com/clario360/platform/internal/gateway/config"
	coremw "github.com/clario360/platform/internal/middleware"
)

type recordingContractTap struct {
	events []audittap.Event
	err    error
}

func (t *recordingContractTap) Record(_ context.Context, event audittap.Event) error {
	headers := make(map[string]string, len(event.Headers))
	for k, v := range event.Headers {
		headers[k] = v
	}
	event.Headers = headers
	t.events = append(t.events, event)
	return t.err
}

func TestProxyContract_RecordsRouteMetadataAndInjectsHeaders(t *testing.T) {
	tap := &recordingContractTap{}
	route := contractTestRoute(false)

	var capturedContractID, capturedContractVersion, capturedAPIVersion, capturedPrefix, capturedService string
	handler := coremw.RequestID(ProxyHeaders(ProxyContract(route, tap, zerolog.Nop())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedContractID = r.Header.Get(HeaderGatewayContractID)
		capturedContractVersion = r.Header.Get(HeaderGatewayContractVersion)
		capturedAPIVersion = r.Header.Get(HeaderGatewayAPIVersion)
		capturedPrefix = r.Header.Get(HeaderGatewayRoutePrefix)
		capturedService = r.Header.Get(HeaderGatewayRouteService)
		w.WriteHeader(http.StatusOK)
	}))))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/dr/sites", nil)
	req.Header.Set(coremw.RequestIDHeader, "req-1")
	req.Header.Set(HeaderAPIVersion, "v1")
	req.Header.Set("Accept", "application/json")
	req.Header.Set(HeaderGatewayContractID, "spoofed")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if capturedContractID != "clario-dr-service" {
		t.Fatalf("forwarded contract id = %q, want clario-dr-service", capturedContractID)
	}
	if capturedContractVersion != "1.0.0" {
		t.Fatalf("forwarded contract version = %q, want 1.0.0", capturedContractVersion)
	}
	if capturedAPIVersion != "v1" {
		t.Fatalf("forwarded api version = %q, want v1", capturedAPIVersion)
	}
	if capturedPrefix != "/api/v1/dr" || capturedService != "clario-dr-service" {
		t.Fatalf("forwarded route metadata = %q/%q, want /api/v1/dr/clario-dr-service", capturedPrefix, capturedService)
	}
	if len(tap.events) != 1 {
		t.Fatalf("tap events = %d, want 1", len(tap.events))
	}

	event := tap.events[0]
	if event.RequestID != "req-1" {
		t.Errorf("event request id = %q, want req-1", event.RequestID)
	}
	if event.RoutePrefix != "/api/v1/dr" || event.Service != "clario-dr-service" {
		t.Errorf("event route metadata = %q/%q, want /api/v1/dr/clario-dr-service", event.RoutePrefix, event.Service)
	}
	if event.ContractID != "clario-dr-service" || event.ContractVersion != "1.0.0" || event.APIVersion != "v1" {
		t.Errorf("event contract metadata = %#v", event)
	}
	if event.Headers[HeaderAPIVersion] != "v1" {
		t.Errorf("event %s header = %q, want v1", HeaderAPIVersion, event.Headers[HeaderAPIVersion])
	}
	if event.Headers[HeaderGatewayContractID] != "" {
		t.Errorf("event must not capture spoofed internal contract header, got %q", event.Headers[HeaderGatewayContractID])
	}
	if event.Outcome != "allowed" {
		t.Errorf("event outcome = %q, want allowed", event.Outcome)
	}
}

func TestProxyContract_VersionMismatchFailsClosedOnlyWhenConfigured(t *testing.T) {
	tests := []struct {
		name           string
		failClosed     bool
		wantStatus     int
		wantNextCalled bool
		wantOutcome    string
	}{
		{name: "record only mismatch allows", failClosed: false, wantStatus: http.StatusOK, wantNextCalled: true, wantOutcome: "version_observed"},
		{name: "fail closed mismatch rejects", failClosed: true, wantStatus: http.StatusUpgradeRequired, wantNextCalled: false, wantOutcome: "version_rejected"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tap := &recordingContractTap{}
			nextCalled := false
			handler := ProxyContract(contractTestRoute(tt.failClosed), tap, zerolog.Nop())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				nextCalled = true
				w.WriteHeader(http.StatusOK)
			}))

			req := httptest.NewRequest(http.MethodGet, "/api/v1/dr/sites", nil)
			req.Header.Set(HeaderAPIVersion, "v2")
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			if rr.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rr.Code, tt.wantStatus)
			}
			if nextCalled != tt.wantNextCalled {
				t.Fatalf("next called = %v, want %v", nextCalled, tt.wantNextCalled)
			}
			if len(tap.events) != 1 {
				t.Fatalf("tap events = %d, want 1", len(tap.events))
			}
			if tap.events[0].Outcome != tt.wantOutcome {
				t.Fatalf("event outcome = %q, want %s", tap.events[0].Outcome, tt.wantOutcome)
			}
			if !strings.Contains(tap.events[0].Reason, "unsupported API version") {
				t.Fatalf("event reason = %q, want unsupported API version", tap.events[0].Reason)
			}
		})
	}
}

func TestProxyContract_TapFailureFailsClosedOnlyWhenConfigured(t *testing.T) {
	tests := []struct {
		name           string
		failClosed     bool
		wantStatus     int
		wantNextCalled bool
	}{
		{name: "record only tap failure allows", failClosed: false, wantStatus: http.StatusOK, wantNextCalled: true},
		{name: "fail closed tap failure rejects", failClosed: true, wantStatus: http.StatusServiceUnavailable, wantNextCalled: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tap := &recordingContractTap{err: errors.New("audit tap unavailable")}
			nextCalled := false
			handler := ProxyContract(contractTestRoute(tt.failClosed), tap, zerolog.Nop())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				nextCalled = true
				w.WriteHeader(http.StatusOK)
			}))

			req := httptest.NewRequest(http.MethodGet, "/api/v1/dr/sites", nil)
			req.Header.Set(HeaderAPIVersion, "v1")
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			if rr.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rr.Code, tt.wantStatus)
			}
			if nextCalled != tt.wantNextCalled {
				t.Fatalf("next called = %v, want %v", nextCalled, tt.wantNextCalled)
			}
			if len(tap.events) != 1 {
				t.Fatalf("tap events = %d, want 1", len(tap.events))
			}
		})
	}
}

func contractTestRoute(failClosed bool) gwconfig.RouteConfig {
	return gwconfig.RouteConfig{
		Prefix:        "/api/v1/dr",
		Service:       "clario-dr-service",
		Public:        false,
		EndpointGroup: gwconfig.EndpointGroupWrite,
		Contract: gwconfig.ContractIntent{
			ID:         "clario-dr-service",
			Version:    "1.0.0",
			APIVersion: "v1",
			Phase:      "phase-1-foundation",
			FailClosed: failClosed,
		},
	}
}
