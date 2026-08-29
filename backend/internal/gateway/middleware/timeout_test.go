package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTimeout_TimesOutHTTPRequests(t *testing.T) {
	handler := Timeout(5*time.Millisecond, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504, got %d", rr.Code)
	}
}

func TestTimeout_BypassesWebSocketUpgrades(t *testing.T) {
	handler := Timeout(5*time.Millisecond, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(20 * time.Millisecond)
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/ws/v1/notifications", nil)
	req.Header.Set("Connection", "keep-alive, Upgrade")
	req.Header.Set("Upgrade", "websocket")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected websocket upgrade request to bypass timeout, got %d", rr.Code)
	}
}
