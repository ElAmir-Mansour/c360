package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"

	"github.com/clario360/platform/internal/dr/agent"
)

func TestAgentHealthzReportsHealthyShippingStream(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	handler := newAgentMetricsHandler(prometheus.NewRegistry(), func() agent.RuntimeStatus {
		return agent.RuntimeStatus{
			CapturedAt: now,
			Streams: []agent.StreamRuntimeStatus{{
				StreamID:     "stream-1",
				Kind:         agent.SourceFile,
				Phase:        agent.StreamPhaseShipping,
				Running:      true,
				LastFrameSeq: 12,
				LastFrameAt:  now.Add(-5 * time.Second),
				LastAckSeq:   12,
				LastAckAt:    now.Add(-4 * time.Second),
				UpdatedAt:    now.Add(-4 * time.Second),
			}},
		}
	}, time.Minute, func() time.Time { return now })

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	body := decodeHealthResponse(t, rec)
	if body.Status != "healthy" {
		t.Fatalf("health status = %q, want healthy", body.Status)
	}
	if len(body.Streams) != 1 || body.Streams[0].LastAckSeq != 12 {
		t.Fatalf("health streams = %+v, want acked stream", body.Streams)
	}
}

func TestAgentHealthzReportsDegradedForStaleUnackedFrame(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	handler := newAgentMetricsHandler(prometheus.NewRegistry(), func() agent.RuntimeStatus {
		return agent.RuntimeStatus{
			CapturedAt: now,
			Streams: []agent.StreamRuntimeStatus{{
				StreamID:     "stream-1",
				Kind:         agent.SourcePostgres,
				Phase:        agent.StreamPhaseShipping,
				Running:      true,
				LastFrameSeq: 99,
				LastFrameAt:  now.Add(-2 * time.Minute),
				UpdatedAt:    now.Add(-2 * time.Minute),
			}},
		}
	}, time.Minute, func() time.Time { return now })

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body=%s", rec.Code, rec.Body.String())
	}
	body := decodeHealthResponse(t, rec)
	if body.Status != "degraded" {
		t.Fatalf("health status = %q, want degraded", body.Status)
	}
	if !strings.Contains(body.Reason, "unacked frames") {
		t.Fatalf("reason = %q, want unacked-frame stale reason", body.Reason)
	}
}

func TestAgentHealthzReportsUnhealthyWithNoStreams(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	handler := newAgentMetricsHandler(prometheus.NewRegistry(), func() agent.RuntimeStatus {
		return agent.RuntimeStatus{CapturedAt: now}
	}, time.Minute, func() time.Time { return now })

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body=%s", rec.Code, rec.Body.String())
	}
	body := decodeHealthResponse(t, rec)
	if body.Status != "unhealthy" || body.Reason != "no streams configured" {
		t.Fatalf("health = %+v, want no-stream unhealthy", body)
	}
}

func decodeHealthResponse(t *testing.T, rec *httptest.ResponseRecorder) agentHealthResponse {
	t.Helper()
	var body agentHealthResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode health response: %v; raw=%s", err, rec.Body.String())
	}
	return body
}
