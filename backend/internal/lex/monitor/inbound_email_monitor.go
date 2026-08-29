package monitor

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/leadership"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service/integration"
)

// inboundEmailIngestor is the seam the poller drives — satisfied by
// *service.IntakeService (its IngestInboundParsed). Keeping it an interface lets
// the monitor be unit-tested with a fake and avoids importing the concrete service.
type inboundEmailIngestor interface {
	IngestInboundParsed(ctx context.Context, req dto.IntakeEmailWebhookRequest, source string) (*model.IntakeMessage, error)
}

// InboundEmailSourceProvider enumerates the currently-pollable IMAP mailboxes
// (one per active inbound `email` integration endpoint that carries IMAP config).
// A live implementation builds emersion-backed sources; the tests supply a fake.
// Returning an empty slice (e.g. no IMAP client compiled in / no endpoints) makes
// the poller a harmless no-op.
type InboundEmailSourceProvider interface {
	Sources(ctx context.Context) ([]integration.InboundEmailSource, error)
}

// InboundEmailMonitor is the leader-gated background poller that pulls UNSEEN mail
// from configured IMAP mailboxes and funnels it into the intake pipeline's trusted
// ingress (IngestInboundParsed), alongside the provider inbound-parse receiver.
//
// It MUST be leader-gated (see RunLeader): Fetch + MarkProcessed are MUTATING
// side-effects on an EXTERNAL mailbox (they set \Seen), so N replicas polling one
// inbox would duplicate-fetch and race the \Seen flag. Message-ID dedup keeps the
// data correct, but leader-election avoids the wasted work and the flag race.
// Mirrors IntegrationSyncMonitor's ticker + per-item resilience shape.
type InboundEmailMonitor struct {
	sources  InboundEmailSourceProvider
	ingestor inboundEmailIngestor
	interval time.Duration
	logger   zerolog.Logger
}

// NewInboundEmailMonitor builds the poller. interval is the poll cadence; a
// non-positive value defaults to 2m (mirroring the other monitors' guards).
func NewInboundEmailMonitor(sources InboundEmailSourceProvider, ingestor inboundEmailIngestor, interval time.Duration, logger zerolog.Logger) *InboundEmailMonitor {
	if interval <= 0 {
		interval = 2 * time.Minute
	}
	return &InboundEmailMonitor{
		sources:  sources,
		ingestor: ingestor,
		interval: interval,
		logger:   logger.With().Str("component", "lex-inbound-email-monitor").Logger(),
	}
}

func (m *InboundEmailMonitor) Run(ctx context.Context) error {
	if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
		m.logger.Error().Err(err).Msg("inbound email monitor iteration failed")
	}
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
				m.logger.Error().Err(err).Msg("inbound email monitor iteration failed")
			}
		}
	}
}

// RunOnce polls every configured source once. Per-source and per-message errors
// are logged and skipped so one bad mailbox never starves the rest; the loop
// never panics. A message is acknowledged (MarkProcessed) only after it ingested
// successfully — ingestion is idempotent on the provider Message-ID, so a message
// that failed to ack (and is re-fetched next tick) is deduped, not duplicated.
func (m *InboundEmailMonitor) RunOnce(ctx context.Context) error {
	if m.sources == nil || m.ingestor == nil {
		return fmt.Errorf("inbound email monitor is not fully configured")
	}
	sources, err := m.sources.Sources(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, source := range sources {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := m.pollSource(ctx, source); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (m *InboundEmailMonitor) pollSource(ctx context.Context, source integration.InboundEmailSource) error {
	defer func() { _ = source.Close() }()

	messages, err := source.Fetch(ctx)
	if err != nil {
		return fmt.Errorf("fetch inbound email: %w", err)
	}
	processed := make([]string, 0, len(messages))
	for _, msg := range messages {
		if err := ctx.Err(); err != nil {
			return err
		}
		req := inboundMessageToWebhookRequest(msg)
		if _, ierr := m.ingestor.IngestInboundParsed(ctx, req, "imap"); ierr != nil {
			// Per-message resilience: log + skip (do NOT mark processed, so the next
			// tick retries; dedup makes a later success idempotent).
			m.logger.Error().
				Err(ierr).
				Str("provider_message_id", msg.MessageID).
				Str("to", msg.To).
				Msg("ingest inbound email failed")
			continue
		}
		if msg.MessageID != "" {
			processed = append(processed, msg.MessageID)
		}
	}
	if len(processed) == 0 {
		return nil
	}
	if err := source.MarkProcessed(ctx, processed); err != nil {
		// The messages ARE ingested; failing to ack only risks a re-fetch (deduped).
		m.logger.Warn().Err(err).Int("count", len(processed)).Msg("mark inbound email processed failed")
	}
	return nil
}

// RunLeader runs the poller as a leader-elected singleton so exactly one replica
// polls a given IMAP inbox at a time (Fetch + \Seen are mutating external
// side-effects). A nil elector degrades to the un-gated Run (single-replica / dev).
func (m *InboundEmailMonitor) RunLeader(ctx context.Context, elector leadership.Elector, instanceID string) error {
	return runLeaderGated(ctx, elector, "lex:inbound-email", instanceID, m.logger, m.Run)
}

// inboundMessageToWebhookRequest maps a normalized IMAP/provider message onto the
// intake pipeline's webhook DTO (the single shape ingestNormalized consumes).
func inboundMessageToWebhookRequest(m integration.NormalizedInboundMessage) dto.IntakeEmailWebhookRequest {
	attachments := make([]dto.IntakeEmailAttachment, 0, len(m.Attachments))
	for _, a := range m.Attachments {
		attachments = append(attachments, dto.IntakeEmailAttachment{
			Filename:    a.Filename,
			ContentType: a.ContentType,
			ContentB64:  a.ContentB64,
		})
	}
	return dto.IntakeEmailWebhookRequest{
		MessageID:   m.MessageID,
		From:        m.From,
		To:          m.To,
		Subject:     m.Subject,
		Body:        m.Body,
		Attachments: attachments,
	}
}
