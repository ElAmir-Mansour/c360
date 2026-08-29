package monitor

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service/integration"
)

type fakeInboundSource struct {
	messages  []integration.NormalizedInboundMessage
	processed []string
	closed    bool
	fetchErr  error
}

func (f *fakeInboundSource) Fetch(ctx context.Context) ([]integration.NormalizedInboundMessage, error) {
	return f.messages, f.fetchErr
}

func (f *fakeInboundSource) MarkProcessed(ctx context.Context, ids []string) error {
	f.processed = append(f.processed, ids...)
	return nil
}

func (f *fakeInboundSource) Close() error {
	f.closed = true
	return nil
}

type fakeSourceProvider struct {
	sources []integration.InboundEmailSource
}

func (f *fakeSourceProvider) Sources(ctx context.Context) ([]integration.InboundEmailSource, error) {
	return f.sources, nil
}

type fakeIngestor struct {
	seen    map[string]bool
	calls   int
	failFor map[string]bool
}

func (f *fakeIngestor) IngestInboundParsed(ctx context.Context, req dto.IntakeEmailWebhookRequest, source string) (*model.IntakeMessage, error) {
	f.calls++
	if f.failFor[req.MessageID] {
		return nil, errors.New("boom")
	}
	if f.seen == nil {
		f.seen = map[string]bool{}
	}
	f.seen[req.MessageID] = true
	return &model.IntakeMessage{ID: uuid.New(), ProviderMessageID: req.MessageID, Status: model.IntakeMessageStatusRouted}, nil
}

func TestInboundEmailMonitorFetchIngestMark(t *testing.T) {
	src := &fakeInboundSource{messages: []integration.NormalizedInboundMessage{
		{MessageID: "m1", To: "legal@othaim.demo", Subject: "A"},
		{MessageID: "m2", To: "legal@othaim.demo", Subject: "B"},
	}}
	ing := &fakeIngestor{}
	m := NewInboundEmailMonitor(&fakeSourceProvider{sources: []integration.InboundEmailSource{src}}, ing, 0, zerolog.Nop())

	if err := m.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if ing.calls != 2 {
		t.Fatalf("ingest calls = %d, want 2", ing.calls)
	}
	if len(src.processed) != 2 {
		t.Fatalf("processed = %v, want 2 acked", src.processed)
	}
	if !src.closed {
		t.Fatalf("source not closed")
	}
}

func TestInboundEmailMonitorSkipsFailedMessage(t *testing.T) {
	src := &fakeInboundSource{messages: []integration.NormalizedInboundMessage{
		{MessageID: "ok", To: "legal@othaim.demo"},
		{MessageID: "bad", To: "legal@othaim.demo"},
	}}
	ing := &fakeIngestor{failFor: map[string]bool{"bad": true}}
	m := NewInboundEmailMonitor(&fakeSourceProvider{sources: []integration.InboundEmailSource{src}}, ing, 0, zerolog.Nop())

	if err := m.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	// Only the successful message is acknowledged; the failed one is retried next tick.
	if len(src.processed) != 1 || src.processed[0] != "ok" {
		t.Fatalf("processed = %v, want [ok]", src.processed)
	}
}

func TestInboundEmailMonitorRedeliveryIdempotent(t *testing.T) {
	src := &fakeInboundSource{messages: []integration.NormalizedInboundMessage{
		{MessageID: "dup", To: "legal@othaim.demo"},
	}}
	ing := &fakeIngestor{}
	m := NewInboundEmailMonitor(&fakeSourceProvider{sources: []integration.InboundEmailSource{src}}, ing, 0, zerolog.Nop())

	if err := m.RunOnce(context.Background()); err != nil {
		t.Fatalf("first RunOnce() error = %v", err)
	}
	// Redelivery: the same message re-fetched (ack failed / provider resend). The
	// monitor re-ingests; the service dedups on Message-ID, so this is safe.
	if err := m.RunOnce(context.Background()); err != nil {
		t.Fatalf("second RunOnce() error = %v", err)
	}
	if ing.calls != 2 {
		t.Fatalf("ingest calls = %d, want 2 (idempotent redelivery)", ing.calls)
	}
}

func TestInboundEmailMonitorUnconfigured(t *testing.T) {
	m := NewInboundEmailMonitor(nil, nil, 0, zerolog.Nop())
	if err := m.RunOnce(context.Background()); err == nil {
		t.Fatalf("RunOnce() with nil deps should error")
	}
}
