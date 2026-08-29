package integration

import (
	"context"
	"testing"

	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

func defaultEventFilter() repository.IntegrationEventFilter {
	return repository.IntegrationEventFilter{Limit: 50}
}

// assertNoSubstring fails if needle appears anywhere in the stringified value,
// recursing through maps — the redaction leak detector.
func assertNoSubstring(t *testing.T, v any, needle string) {
	t.Helper()
	if strings.Contains(fmt.Sprintf("%v", v), needle) {
		t.Fatalf("redacted view leaked secret substring %q in %v", needle, v)
	}
}

// TestEventLogNilRepoIsSafe: an unwired event log never breaks the webhook ack —
// RecordEvent is a no-op (uuid.Nil), List/ListAll return empty, Get/Replay report
// not-found rather than panicking.
func TestEventLogNilRepoIsSafe(t *testing.T) {
	log := NewEventLog(nil, zerolog.Nop())
	ep := model.IntegrationEndpoint{ID: uuid.New(), TenantID: uuid.New(), Kind: model.IntegrationKindNafathVerify}

	if id := log.RecordEvent(context.Background(), ep, EventDirectionInbound, "nafath_verify", map[string]any{"k": "v"}, true, EventStatusProcessed, "ok"); id != uuid.Nil {
		t.Fatalf("nil-repo RecordEvent = %s, want uuid.Nil", id)
	}
	if got, err := log.List(context.Background(), ep.TenantID, ep.ID, defaultEventFilter()); err != nil || len(got) != 0 {
		t.Fatalf("nil-repo List = (%v, %v), want ([], nil)", got, err)
	}
	if got, err := log.ListAll(context.Background(), ep.TenantID, defaultEventFilter()); err != nil || len(got) != 0 {
		t.Fatalf("nil-repo ListAll = (%v, %v), want ([], nil)", got, err)
	}
	if _, err := log.Get(context.Background(), ep.TenantID, uuid.New()); err != pgx.ErrNoRows {
		t.Fatalf("nil-repo Get err = %v, want pgx.ErrNoRows", err)
	}
	if _, err := log.Replay(context.Background(), ep.TenantID, uuid.New(), uuid.New()); err != pgx.ErrNoRows {
		t.Fatalf("nil-repo Replay err = %v, want pgx.ErrNoRows", err)
	}
}

// TestRecordPayloadRedaction: the inbound payload is REDACTED before it could ever
// reach storage — secret-named keys (and nested credentials) collapse to the
// sentinel; non-sensitive identifiers pass through. This is the persisted-secret
// guard for the event inspector.
func TestRecordPayloadRedaction(t *testing.T) {
	payload := map[string]any{
		"trans_id":      "abc-123",
		"national_id":   "1000000000",
		"access_token":  "super-secret-bearer",
		"client_secret": "shh",
		"nested": map[string]any{
			"api_key":  "leak-me",
			"caseref":  "C-9",
			"password": "p@ss",
		},
	}
	red := RedactPayloadForKind(model.IntegrationKindNafathVerify, payload)
	// Non-sensitive identifiers survive.
	if red["trans_id"] != "abc-123" || red["national_id"] != "1000000000" {
		t.Fatalf("non-sensitive identifiers must pass through: %+v", red)
	}
	// Credential-flavoured keys are redacted.
	for _, k := range []string{"access_token", "client_secret"} {
		if red[k] != RedactedSentinel {
			t.Fatalf("key %q = %v, want sentinel (LEAK)", k, red[k])
		}
	}
	nested, ok := red["nested"].(map[string]any)
	if !ok {
		t.Fatalf("nested map missing: %+v", red["nested"])
	}
	if nested["api_key"] != RedactedSentinel || nested["password"] != RedactedSentinel {
		t.Fatalf("nested credentials not redacted: %+v", nested)
	}
	if nested["caseref"] != "C-9" {
		t.Fatalf("nested non-sensitive value lost: %+v", nested)
	}
	// The original input map must NOT be mutated (defensive copy).
	if payload["access_token"] != "super-secret-bearer" {
		t.Fatalf("RedactPayloadForKind mutated its input")
	}
	// No secret substring survives anywhere in the redacted view.
	for _, leak := range []string{"super-secret-bearer", "shh", "leak-me", "p@ss"} {
		assertNoSubstring(t, red, leak)
	}
}

func TestNormalizeDirectionAndStatus(t *testing.T) {
	if normalizeDirection("OUTBOUND") != EventDirectionOutbound {
		t.Fatal("outbound not normalized")
	}
	if normalizeDirection("garbage") != EventDirectionInbound {
		t.Fatal("unknown direction must default inbound")
	}
	if normalizeEventStatus("FAILED") != EventStatusFailed || normalizeEventStatus("") != EventStatusReceived {
		t.Fatal("status normalization wrong")
	}
}

// TestIsEventNotFound maps the repo sentinel so the registry can return a 404.
func TestIsEventNotFound(t *testing.T) {
	if !IsEventNotFound(pgx.ErrNoRows) {
		t.Fatal("pgx.ErrNoRows must be recognised as event-not-found")
	}
	if IsEventNotFound(nil) {
		t.Fatal("nil is not a not-found")
	}
}
