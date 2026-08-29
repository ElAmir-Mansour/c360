// Package service — lex_notification_service.go implements the durable in-app
// inbox (CAP-156) and the email fan-out seam (CAP-157) for the Phase-4
// notification triggers. Rather than coupling against the platform
// notification-service RuleEngine (another team's code), lex writes inbox rows
// directly and dispatches an email copy through a thin dispatcher seam that
// mirrors the obligation-reminder dispatcher (Deterministic default + injectable
// HTTP adapter) — no new channel layer.
package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// LexEmailDispatcher is the email fan-out seam (CAP-157). It deliberately mirrors
// the obligation-reminder dispatcher contract (a Deterministic default that
// produces an auditable proof, plus an injectable real adapter) so email is one
// seam across the suite rather than a bespoke channel layer.
//
// recipientEmail is the resolved deliverable address for recipientID (resolved by
// the service from the platform_core user directory just before dispatch, so the
// address never has to be persisted into the inbox row as PII). A real transport
// (SMTP / HTTP provider) sends to recipientEmail; the deterministic default stamps
// it into its proof. It may be empty only on the dev deterministic path where no
// directory is wired.
type LexEmailDispatcher interface {
	DispatchNotificationEmail(ctx context.Context, tenantID uuid.UUID, item model.NotificationInboxItem, recipientID uuid.UUID, recipientEmail string, now time.Time) (map[string]any, error)
}

// DeterministicLexEmailDispatcher is the default, side-effect-free dispatcher. It
// returns a deterministic proof (no network I/O) so tests and dev environments
// have a stable record without a live mail provider.
type DeterministicLexEmailDispatcher struct{}

// DispatchNotificationEmail returns a deterministic delivery proof.
func (DeterministicLexEmailDispatcher) DispatchNotificationEmail(_ context.Context, tenantID uuid.UUID, item model.NotificationInboxItem, recipientID uuid.UUID, recipientEmail string, now time.Time) (map[string]any, error) {
	return map[string]any{
		"provider_adapter": "deterministic",
		"tenant_id":        tenantID.String(),
		"recipient_id":     recipientID.String(),
		"recipient_email":  strings.TrimSpace(recipientEmail),
		"notification_id":  item.ID.String(),
		"category":         string(item.Category),
		"dispatched_at":    now.UTC().Format(time.RFC3339Nano),
		"subject":          item.Title.Localize("en"),
		"delivery_status":  "queued",
	}, nil
}

// LexNotificationService owns the in-app inbox + per-user subscriptions and the
// shared write path used by the consumer and ProximityMonitor.
type LexNotificationService struct {
	inbox         *repository.NotificationInboxRepository
	subscriptions *repository.NotificationSubscriptionRepository
	emailer       LexEmailDispatcher
	directory     SignatureUserDirectory
	publisher     Publisher
	source        string
	topic         string
	logger        zerolog.Logger
	now           func() time.Time
}

// NewLexNotificationService constructs the service. A nil emailer falls back to
// the Deterministic dispatcher; a nil publisher to a no-op. source/topic feed the
// CloudEvents emitted when an inbox row is written.
func NewLexNotificationService(
	inbox *repository.NotificationInboxRepository,
	subscriptions *repository.NotificationSubscriptionRepository,
	emailer LexEmailDispatcher,
	publisher Publisher,
	topic string,
	logger zerolog.Logger,
) *LexNotificationService {
	if emailer == nil {
		emailer = DeterministicLexEmailDispatcher{}
	}
	return &LexNotificationService{
		inbox:         inbox,
		subscriptions: subscriptions,
		emailer:       emailer,
		publisher:     publisherOrNoop(publisher),
		source:        "lex-service",
		topic:         topic,
		logger:        logger.With().Str("component", "lex-notification-service").Logger(),
		now:           time.Now,
	}
}

// SetEmailDispatcher swaps the email seam (HTTP/SMTP adapter in production). A nil
// dispatcher reverts to the Deterministic default.
func (s *LexNotificationService) SetEmailDispatcher(d LexEmailDispatcher) {
	if d == nil {
		d = DeterministicLexEmailDispatcher{}
	}
	s.emailer = d
}

// SetUserDirectory wires the platform_core user directory used to resolve a
// recipient's deliverable email address just before an email is dispatched
// (CAP-157). It mirrors SignatureService.SetUserDirectory. Wiring it in ANY
// provider mode is safe: the resolved address is used only for the outbound email
// and is never persisted onto the inbox row (which is returned to the FE), so no
// PII leaks into the durable record. A nil directory disables address resolution
// (the deterministic dev path still no-ops without one).
func (s *LexNotificationService) SetUserDirectory(d SignatureUserDirectory) {
	s.directory = d
}

// resolveRecipientEmail returns the recipient's deliverable, lower-cased email
// address, or "" when no directory is wired, resolution fails, the user is
// inactive, or the address is blank. It is deliberately silent-on-miss: email is
// best-effort and must never break the durable in-app row.
func (s *LexNotificationService) resolveRecipientEmail(ctx context.Context, tenantID, recipientID uuid.UUID) string {
	if s.directory == nil {
		return ""
	}
	identity, err := s.directory.ResolveSignatureUser(ctx, tenantID, recipientID)
	if err != nil {
		s.logger.Debug().Err(err).Str("recipient_id", recipientID.String()).Msg("resolve notification recipient email")
		return ""
	}
	if identity == nil {
		return ""
	}
	if !strings.EqualFold(strings.TrimSpace(identity.Status), activeSignatureUserStatus) {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(identity.Email))
}

// NotifyInput is one trigger's payload. Channels other than in_app are advisory:
// in_app is always written (subject to subscription suppression); email is fanned
// out through the dispatcher seam when not suppressed.
type NotifyInput struct {
	RecipientID uuid.UUID
	Category    model.NotificationCategory
	Title       forms.LocalizedText
	Body        forms.LocalizedText
	EntityType  string
	EntityID    *uuid.UUID
	ActionURL   string
	EventID     *uuid.UUID
	DedupKey    string
	Email       bool
	Metadata    map[string]any
	CreatedBy   uuid.UUID
}

// Notify writes a durable in-app inbox row (deduped by DedupKey) for the
// recipient and, when Email is requested and not suppressed, fans an email copy
// out through the dispatcher seam. It is the single write path the consumer and
// monitor call. A suppressed in_app channel skips the row entirely; a suppressed
// email channel skips only the email. The returned bool reports whether an inbox
// row was actually written (false on dedup or in_app suppression) so callers can
// drive dedup markers.
func (s *LexNotificationService) Notify(ctx context.Context, tenantID uuid.UUID, in NotifyInput) (bool, error) {
	if in.RecipientID == uuid.Nil {
		return false, nil
	}
	if in.Category == "" {
		in.Category = model.NotificationCategoryGeneral
	}

	inAppSuppressed, err := s.subscriptions.IsSuppressed(ctx, nil, tenantID, in.RecipientID, in.Category, model.NotificationChannelInApp)
	if err != nil {
		return false, err
	}
	if inAppSuppressed {
		return false, nil
	}

	item := &model.NotificationInboxItem{
		ID:          uuid.New(),
		TenantID:    tenantID,
		RecipientID: in.RecipientID,
		Category:    in.Category,
		Title:       in.Title,
		Body:        in.Body,
		Metadata:    in.Metadata,
		EventID:     in.EventID,
	}
	if et := strings.TrimSpace(in.EntityType); et != "" {
		item.EntityType = &et
	}
	item.EntityID = in.EntityID
	if au := strings.TrimSpace(in.ActionURL); au != "" {
		item.ActionURL = &au
	}
	if dk := strings.TrimSpace(in.DedupKey); dk != "" {
		item.DedupKey = &dk
	}

	written, err := s.inbox.Create(ctx, nil, item)
	if err != nil {
		return false, err
	}
	if !written {
		return false, nil
	}

	writeEvent(ctx, s.publisher, s.source, s.topic, "com.clario360.lex.notification.created", tenantID, &in.RecipientID, map[string]any{
		"id":           item.ID,
		"recipient_id": in.RecipientID,
		"category":     in.Category,
		"entity_type":  item.EntityType,
		"entity_id":    item.EntityID,
	}, s.logger)

	if in.Email {
		emailSuppressed, err := s.subscriptions.IsSuppressed(ctx, nil, tenantID, in.RecipientID, in.Category, model.NotificationChannelEmail)
		if err != nil {
			s.logger.Error().Err(err).Msg("check email subscription suppression")
		} else if !emailSuppressed {
			// Resolve the deliverable address at dispatch time (never persisted onto
			// the inbox row). When a directory is wired but the recipient has no
			// active/deliverable address, skip the email — the durable in-app row is
			// already committed, so this is a silent best-effort no-op. When no
			// directory is wired at all (dev deterministic path) we still dispatch so
			// the deterministic proof is produced.
			recipientEmail := s.resolveRecipientEmail(ctx, tenantID, in.RecipientID)
			if s.directory != nil && recipientEmail == "" {
				s.logger.Info().Str("notification_id", item.ID.String()).Str("recipient_id", in.RecipientID.String()).Msg("skip notification email: no active deliverable recipient address")
			} else if _, err := s.emailer.DispatchNotificationEmail(ctx, tenantID, *item, in.RecipientID, recipientEmail, s.now().UTC()); err != nil {
				// Email is best-effort: the durable in-app row is already
				// committed; log and continue (mirrors dispatcher seam semantics).
				s.logger.Error().Err(err).Str("notification_id", item.ID.String()).Msg("dispatch notification email")
			}
		}
	}
	return true, nil
}

// --- handler-facing inbox operations ---------------------------------------

func (s *LexNotificationService) ListInbox(ctx context.Context, tenantID, recipientID uuid.UUID, filters model.NotificationInboxListFilters) ([]dto.NotificationInboxResponse, int, error) {
	items, total, err := s.inbox.List(ctx, tenantID, recipientID, filters)
	if err != nil {
		return nil, 0, err
	}
	out := make([]dto.NotificationInboxResponse, 0, len(items))
	for i := range items {
		out = append(out, notificationInboxToResponse(items[i]))
	}
	return out, total, nil
}

func (s *LexNotificationService) GetInbox(ctx context.Context, tenantID, recipientID, id uuid.UUID) (*dto.NotificationInboxResponse, error) {
	item, err := s.inbox.Get(ctx, tenantID, recipientID, id)
	if err != nil {
		return nil, translateNotFound(err, "notification not found")
	}
	resp := notificationInboxToResponse(*item)
	return &resp, nil
}

func (s *LexNotificationService) Counts(ctx context.Context, tenantID, recipientID uuid.UUID) (dto.NotificationInboxCountsResponse, error) {
	counts, err := s.inbox.Counts(ctx, tenantID, recipientID)
	if err != nil {
		return dto.NotificationInboxCountsResponse{}, err
	}
	return dto.NotificationInboxCountsResponse{Total: counts.Total, Unread: counts.Unread}, nil
}

func (s *LexNotificationService) MarkRead(ctx context.Context, tenantID, recipientID, id uuid.UUID) (*dto.NotificationInboxResponse, error) {
	item, err := s.inbox.MarkRead(ctx, tenantID, recipientID, id, s.now().UTC())
	if err != nil {
		return nil, translateNotFound(err, "notification not found")
	}
	resp := notificationInboxToResponse(*item)
	return &resp, nil
}

func (s *LexNotificationService) MarkAllRead(ctx context.Context, tenantID, recipientID uuid.UUID) (int64, error) {
	return s.inbox.MarkAllRead(ctx, tenantID, recipientID, s.now().UTC())
}

// --- handler-facing subscription operations --------------------------------

func (s *LexNotificationService) UpsertSubscription(ctx context.Context, tenantID, userID uuid.UUID, req dto.UpsertNotificationSubscriptionRequest) (*dto.NotificationSubscriptionResponse, error) {
	if fields := req.Validate(); fields != nil {
		return nil, validationError("invalid notification subscription", fields)
	}
	sub := &model.NotificationSubscription{
		ID:        uuid.New(),
		TenantID:  tenantID,
		UserID:    userID,
		Category:  req.Category,
		Channel:   req.Channel,
		Enabled:   req.Enabled,
		CreatedBy: userID,
	}
	saved, err := s.subscriptions.Upsert(ctx, sub)
	if err != nil {
		return nil, err
	}
	resp := notificationSubscriptionToResponse(*saved)
	return &resp, nil
}

func (s *LexNotificationService) ListSubscriptions(ctx context.Context, tenantID, userID uuid.UUID, filters model.NotificationSubscriptionListFilters) ([]dto.NotificationSubscriptionResponse, error) {
	subs, err := s.subscriptions.List(ctx, tenantID, userID, filters)
	if err != nil {
		return nil, err
	}
	out := make([]dto.NotificationSubscriptionResponse, 0, len(subs))
	for i := range subs {
		out = append(out, notificationSubscriptionToResponse(subs[i]))
	}
	return out, nil
}

func (s *LexNotificationService) DeleteSubscription(ctx context.Context, tenantID, userID, id uuid.UUID) error {
	if err := s.subscriptions.Delete(ctx, tenantID, userID, id); err != nil {
		return translateNotFound(err, "notification subscription not found")
	}
	return nil
}

// --- mapping helpers --------------------------------------------------------

func notificationInboxToResponse(item model.NotificationInboxItem) dto.NotificationInboxResponse {
	resp := dto.NotificationInboxResponse{
		ID:         item.ID,
		Category:   item.Category,
		Title:      item.Title,
		Body:       item.Body,
		EntityType: item.EntityType,
		EntityID:   item.EntityID,
		ActionURL:  item.ActionURL,
		Metadata:   item.Metadata,
		Read:       item.IsRead(),
		CreatedAt:  item.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if item.ReadAt != nil {
		formatted := item.ReadAt.UTC().Format(time.RFC3339Nano)
		resp.ReadAt = &formatted
	}
	if resp.Metadata == nil {
		resp.Metadata = map[string]any{}
	}
	return resp
}

func notificationSubscriptionToResponse(sub model.NotificationSubscription) dto.NotificationSubscriptionResponse {
	return dto.NotificationSubscriptionResponse{
		ID:        sub.ID,
		Category:  sub.Category,
		Channel:   sub.Channel,
		Enabled:   sub.Enabled,
		CreatedAt: sub.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt: sub.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

// translateNotFound maps a pgx.ErrNoRows into a 404 AppError, leaving other
// errors intact.
func translateNotFound(err error, message string) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return notFoundError(message)
	}
	return err
}
