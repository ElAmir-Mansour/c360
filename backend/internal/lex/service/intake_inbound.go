package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// simulatedMessageDomain is the synthetic RFC-5322 domain stamped on generated
// simulate Message-IDs so they are visibly non-production and never collide with
// a real provider id.
const simulatedMessageDomain = "clario360.local"

// SimulateInbound is the JWT-gated Simulate-Inbound admin action (CAP-002/003).
// It lets a mailbox-admin exercise the ENTIRE inbound-email bridge —
// classify → route → routed legal_request — against one of their own mailboxes
// with ZERO external dependencies (no mail provider, no HMAC). Because the caller
// is already authenticated and authorized (the route sits behind the mailbox-admin
// tier and the mailbox is loaded tenant-scoped, so RLS + ownership are enforced),
// the per-mailbox HMAC that guards the public webhook is intentionally bypassed:
// authentication has already happened at the JWT edge. The synthesized message is
// tagged intake_source="simulated" on both the audit row and the routed request so
// demo data stays auditable and filterable.
func (s *IntakeService) SimulateInbound(ctx context.Context, tenantID, actorID, mailboxID uuid.UUID, req dto.IntakeSimulateRequest) (*model.IntakeMessage, error) {
	req.Normalize()

	// Load the mailbox tenant-scoped: this enforces RLS + ownership (a caller in
	// tenant A cannot simulate against tenant B's mailbox) and yields the routing
	// facts (request_type / default service / beneficiary) exactly as the webhook
	// path resolves them.
	mailbox, err := s.GetMailbox(ctx, tenantID, mailboxID)
	if err != nil {
		return nil, err
	}
	if !mailbox.Active {
		return nil, conflictError("mailbox is not active")
	}

	synth := dto.IntakeEmailWebhookRequest{
		MessageID:   req.MessageID,
		From:        req.From,
		To:          mailbox.Address,
		Subject:     req.Subject,
		Body:        req.Body,
		Attachments: req.Attachments,
	}
	synth.Normalize()
	if synth.MessageID == "" {
		synth.MessageID = "simulated-" + uuid.NewString() + "@" + simulatedMessageDomain
	}
	if synth.From == "" {
		synth.From = "simulation@" + simulatedMessageDomain
	}
	if synth.Subject == "" {
		synth.Subject = "Simulated inbound email"
	}

	msg, err := s.ingestNormalized(ctx, mailbox, synth, intakeSourceSimulated)
	if err != nil {
		return nil, err
	}
	// Audit WHO triggered the simulation (the pipeline itself records the synthetic
	// system actor as created_by, matching a real inbound email that has no in-app
	// author). This event is secret-free and additive.
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.intake.simulated", tenantID, &actorID, map[string]any{
		"id":                  msg.ID,
		"mailbox_id":          mailbox.ID,
		"provider_message_id": synth.MessageID,
		"status":              string(msg.Status),
	}, s.logger)
	return msg, nil
}

// IngestInboundParsed is the TRUSTED-ingress entry point shared by the provider
// inbound-parse receiver (SES/Mailgun/…) and the IMAP poller. The caller has
// ALREADY authenticated the ingress at the edge — the provider receiver verifies
// the provider's own signature/shared-secret before calling here, and the IMAP
// poller authenticated to the mailbox over IMAP — so the per-mailbox HMAC that
// guards the public webhook is bypassed on this path. The mailbox (and therefore
// the tenant) is resolved from the To recipient via an RLS-bypass system read,
// exactly like the webhook, then the shared pipeline runs in tenant context.
// Idempotent on (tenant, provider_message_id), so a provider redelivery or a
// re-fetched IMAP message is ingested once.
//
// source is the descriptive intake_source tag, e.g. "provider:mailgun" or "imap".
func (s *IntakeService) IngestInboundParsed(ctx context.Context, req dto.IntakeEmailWebhookRequest, source string) (*model.IntakeMessage, error) {
	req.Normalize()
	if req.MessageID == "" {
		return nil, validationError("message_id is required", map[string]string{"message_id": "required"})
	}
	if req.To == "" {
		return nil, validationError("to is required", map[string]string{"to": "required"})
	}
	if strings.TrimSpace(source) == "" {
		source = intakeSourceProvider("")
	}

	var mailbox *model.IntakeMailbox
	if err := database.RunSystemRead(ctx, s.db, func(tx pgx.Tx) error {
		found, err := s.mailboxes.GetByAddressSystem(ctx, tx, req.To)
		if err != nil {
			return err
		}
		mailbox = found
		return nil
	}); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrIntakeMailboxNotFound
		}
		return nil, internalError("resolve intake mailbox", err)
	}

	return s.ingestNormalized(ctx, mailbox, req, source)
}
