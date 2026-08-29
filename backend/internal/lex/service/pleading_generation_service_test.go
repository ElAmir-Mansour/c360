package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPleadingGenerationMetadataRoundTripUsesFrontendContract(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	state := &PleadingGenerationState{
		JobID:       uuid.New(),
		PleadingID:  uuid.New(),
		Status:      PleadingGenerationRunning,
		PartialBody: "Facts\n1. The invoice remains unpaid.",
		Language:    "en",
		DraftPrompt: "Keep the relief concise.",
		BaseVersion: 3,
		StartedAt:   now,
		UpdatedAt:   now,
	}

	metadata := withPleadingGeneration(map[string]any{"source": "test"}, state)
	got := pleadingGenerationFromMetadata(metadata)
	if got == nil {
		t.Fatal("generation state was not decoded")
	}
	if got.JobID != state.JobID || got.Status != PleadingGenerationRunning ||
		got.PartialBody != state.PartialBody || got.DraftPrompt != state.DraftPrompt ||
		got.BaseVersion != state.BaseVersion {
		t.Fatalf("round trip = %+v, want %+v", got, state)
	}

	payload, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal generation state: %v", err)
	}
	var wire map[string]any
	if err := json.Unmarshal(payload, &wire); err != nil {
		t.Fatalf("decode wire generation state: %v", err)
	}
	if wire["status"] != "running" {
		t.Fatalf("wire status = %#v, want running", wire["status"])
	}
	if wire["body"] != state.PartialBody {
		t.Fatalf("wire body = %#v, want partial body", wire["body"])
	}
	if _, legacy := wire["partial_body"]; legacy {
		t.Fatal("legacy partial_body field must not be emitted")
	}
}

func TestPleadingGenerationProgressIsBounded(t *testing.T) {
	t.Parallel()
	tests := []struct {
		bytes int
		min   int
		max   int
	}{
		{bytes: 0, min: 2, max: 2},
		{bytes: 1000, min: 10, max: 20},
		{bytes: 9000, min: 95, max: 95},
		{bytes: 50000, min: 95, max: 95},
	}
	for _, tt := range tests {
		got := pleadingGenerationProgress(tt.bytes)
		if got < tt.min || got > tt.max {
			t.Fatalf("progress(%d) = %d, want [%d,%d]", tt.bytes, got, tt.min, tt.max)
		}
	}
}

func TestPleadingGenerationRuntimeDetachesSlowSubscribers(t *testing.T) {
	t.Parallel()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	runtime := newPleadingGenerationRuntime(uuid.New(), cancel)
	events, unsubscribe := runtime.subscribe()
	defer unsubscribe()

	for i := 0; i < 500; i++ {
		runtime.broadcast(PleadingGenerationEvent{Type: "delta", Data: i})
	}
	runtime.close()

	count := 0
	for range events {
		count++
	}
	if count == 0 || count > 128 {
		t.Fatalf("buffered event count = %d, want 1..128", count)
	}
}

func TestPleadingGenerationErrorMapsTimeout(t *testing.T) {
	t.Parallel()
	code, _ := pleadingGenerationError(errors.Join(errors.New("provider"), context.DeadlineExceeded))
	if code != "DRAFTING_TIMEOUT" {
		t.Fatalf("code = %q, want DRAFTING_TIMEOUT", code)
	}
}
