package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/service"
)

func TestStreamPleadingGenerationWritesResumableSSEFrames(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	state := &service.PleadingGenerationState{
		JobID:      uuid.New(),
		PleadingID: uuid.New(),
		Status:     service.PleadingGenerationQueued,
		StartedAt:  now,
		UpdatedAt:  now,
	}
	events := make(chan service.PleadingGenerationEvent, 3)
	events <- service.PleadingGenerationEvent{
		Type: "generation_started",
		Data: map[string]any{"progress": 2},
	}
	events <- service.PleadingGenerationEvent{
		Type: "delta",
		Data: map[string]any{"text": "Facts", "progress": 15},
	}
	events <- service.PleadingGenerationEvent{
		Type: "generation_completed",
		Data: map[string]any{"body": "Facts", "progress": 100},
	}
	close(events)

	unsubscribed := false
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/generation", nil)
	h := &LitigationHandler{}
	h.streamPleadingGeneration(rec, req, http.StatusAccepted, state, events, func() {
		unsubscribed = true
	})

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusAccepted)
	}
	if contentType := rec.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/event-stream") {
		t.Fatalf("content type = %q, want text/event-stream", contentType)
	}
	body := rec.Body.String()
	for _, frame := range []string{
		"event: job",
		"event: generation_started",
		"event: delta",
		`"text":"Facts"`,
		"event: generation_completed",
		"event: done",
	} {
		if !strings.Contains(body, frame) {
			t.Fatalf("SSE body missing %q:\n%s", frame, body)
		}
	}
	if !unsubscribed {
		t.Fatal("stream did not unsubscribe after the terminal event")
	}
}
