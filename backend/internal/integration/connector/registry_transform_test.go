package connector

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/events"
)

// TestRegistry_SendTransform_Applied verifies that an installed send transform
// rewrites the event before it reaches the connector's Send, using a REAL
// httptest server and the real httpEchoConnector (no mocks). The transform here
// rewrites the event type; the body the server receives must carry the rewritten
// type, proving the transform ran on the dispatch path.
func TestRegistry_SendTransform_Applied(t *testing.T) {
	var gotType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		if s, ok := payload["type"].(string); ok {
			gotType = s
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	r := NewRegistry()
	if err := r.Register(newHTTPEchoConnector(srv.URL)); err != nil {
		t.Fatalf("register: %v", err)
	}

	r.SetSendTransform(func(e *events.Event) *events.Event {
		clone := *e
		clone.Type = "transformed." + e.Type
		return &clone
	})

	evt, err := events.NewEvent("datastream.dr.alert.rpo_breach", "clario-dr", "tenant-1", map[string]any{"x": 1})
	if err != nil {
		t.Fatalf("new event: %v", err)
	}
	cfg := map[string]any{"path": "/hook", "token": "t", "retries": float64(0)}
	if _, err := r.Send(context.Background(), "http_echo", cfg, evt); err != nil {
		t.Fatalf("send: %v", err)
	}
	if gotType == "" || gotType[:len("transformed.")] != "transformed." {
		t.Fatalf("transform not applied; server saw type=%q", gotType)
	}
}

// TestRegistry_SendTransform_NilNoOp verifies that with no transform installed
// (or after clearing it), the event reaches Send unchanged — the behavior the
// five existing connectors rely on for parity.
func TestRegistry_SendTransform_NilNoOp(t *testing.T) {
	var gotType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		gotType, _ = payload["type"].(string)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	r := NewRegistry()
	if err := r.Register(newHTTPEchoConnector(srv.URL)); err != nil {
		t.Fatalf("register: %v", err)
	}
	// Install then clear, to exercise the nil path explicitly.
	r.SetSendTransform(func(e *events.Event) *events.Event { return e })
	r.SetSendTransform(nil)

	evt, err := events.NewEvent("cyber.alert.created", "clario", "tenant-1", map[string]any{"x": 1})
	if err != nil {
		t.Fatalf("new event: %v", err)
	}
	cfg := map[string]any{"path": "/hook", "token": "t", "retries": float64(0)}
	if _, err := r.Send(context.Background(), "http_echo", cfg, evt); err != nil {
		t.Fatalf("send: %v", err)
	}
	if gotType != evt.Type {
		t.Fatalf("event mutated with nil transform: sent=%q got=%q", evt.Type, gotType)
	}
}
