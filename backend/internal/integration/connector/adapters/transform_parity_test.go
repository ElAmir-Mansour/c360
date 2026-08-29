package adapters

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
	"github.com/clario360/platform/internal/integration/drsource"
	intmodel "github.com/clario360/platform/internal/integration/model"
	"github.com/clario360/platform/internal/integration/service/webhook"
)

// TestParity_NonDREvent_WithDRTransformInstalled proves the DR send-transform is
// a true no-op for non-DR events: a webhook delivery through a registry that has
// the production DR transform installed is byte-identical to a delivery through a
// registry with NO transform. This is the parity guarantee that wiring DR
// rendering does not perturb the five existing connectors for ordinary events.
func TestParity_NonDREvent_WithDRTransformInstalled(t *testing.T) {
	var mu sync.Mutex
	captured := make([][]byte, 0, 2)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		captured = append(captured, body)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	client := webhook.NewClient(5 * time.Second)
	cfgMap := map[string]any{"url": srv.URL, "method": "POST", "content_type": "application/json"}
	// A non-DR event; the same event drives both deliveries so bodies are
	// deterministic (only random id/time would differ — pinned below).
	evt, err := events.NewEvent("data.pipeline.failed", "notification-service", "tenant-1", map[string]any{"id": "pipe-1", "status": "failed"})
	if err != nil {
		t.Fatalf("new event: %v", err)
	}
	evt.Time = time.Date(2026, 6, 13, 9, 30, 0, 0, time.UTC)

	// Registry WITHOUT a transform.
	plain := BuildDefaultRegistry(Clients{Webhook: client})
	if _, err := plain.Send(context.Background(), string(intmodel.IntegrationTypeWebhook), cfgMap, evt); err != nil {
		t.Fatalf("plain send: %v", err)
	}

	// Registry WITH the production DR transform installed.
	withDR := BuildDefaultRegistry(Clients{Webhook: client})
	withDR.SetSendTransform(connector.EventTransform(drsource.NewEventTransform("https://app.clario360.example")))
	if _, err := withDR.Send(context.Background(), string(intmodel.IntegrationTypeWebhook), cfgMap, evt); err != nil {
		t.Fatalf("dr-transform send: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(captured) != 2 {
		t.Fatalf("expected 2 captured requests, got %d", len(captured))
	}
	if string(captured[0]) != string(captured[1]) {
		t.Fatalf("non-DR delivery diverged when DR transform installed:\n plain: %s\n dr:    %s", captured[0], captured[1])
	}
}

// TestDRTransform_EnrichesWebhookDelivery proves the positive side: for a DR
// event, the DR transform DOES change the delivered webhook body (it now carries
// the rendered DR fields), via a real httptest webhook receiver.
func TestDRTransform_EnrichesWebhookDelivery(t *testing.T) {
	var got []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	client := webhook.NewClient(5 * time.Second)
	cfgMap := map[string]any{"url": srv.URL, "method": "POST", "content_type": "application/json"}
	evt, err := events.NewEvent("datastream.dr.alert.rpo_breach", "clario-dr-service", "tenant-1", map[string]any{
		"stream_id":             "stream-7",
		"rpo_objective_seconds": 60,
		"live_rpo_seconds":      95,
	})
	if err != nil {
		t.Fatalf("new event: %v", err)
	}
	evt.Subject = "stream-7"

	r := BuildDefaultRegistry(Clients{Webhook: client})
	r.SetSendTransform(connector.EventTransform(drsource.NewEventTransform("https://app.clario360.example")))
	if _, err := r.Send(context.Background(), string(intmodel.IntegrationTypeWebhook), cfgMap, evt); err != nil {
		t.Fatalf("send: %v", err)
	}

	body := string(got)
	// The webhook client nests the event data under "data"; the enriched payload
	// must carry the rendered severity and the DR fields.
	for _, want := range []string{`"severity":"critical"`, `"field_map"`, `"RPO Objective"`} {
		if !contains(body, want) {
			t.Fatalf("enriched DR webhook body missing %q:\n%s", want, body)
		}
	}
}

// contains is a tiny substring helper kept local to avoid importing strings for
// one call in this test file.
func contains(haystack, needle string) bool {
	return len(needle) == 0 || indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	n, m := len(haystack), len(needle)
	for i := 0; i+m <= n; i++ {
		if haystack[i:i+m] == needle {
			return i
		}
	}
	return -1
}
