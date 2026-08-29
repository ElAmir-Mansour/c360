package respond

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrMobilizationNotConfigured = errors.New("respond mobilization notifications are not configured")
	ErrMobilizationNoChannels    = errors.New("respond mobilization has no deliverable notification channels")
)

const (
	EventRoleMobilized              = "respond.role.mobilized"
	EventNotificationDispatchFailed = "respond.notification.failed"
	EventNotificationAcknowledged   = "respond.notification.acknowledged"
	EventNotificationEscalated      = "respond.notification.escalated"
)

type MobilizeRoleInput struct {
	IncidentID   uuid.UUID
	AssignmentID uuid.UUID
	Channels     []NotificationChannel
	RequiresAck  *bool
	AckTimeout   time.Duration
	ActionURL    string
	Actor        Actor
}

type RoleMobilizationResult struct {
	Assignment   RoleAssignment         `json:"assignment"`
	Responder    ResolvedResponder      `json:"responder"`
	Dispatches   []NotificationDispatch `json:"dispatches"`
	CreatedCount int                    `json:"created_count"`
}

type AcknowledgeMobilizationInput struct {
	IncidentID uuid.UUID
	DispatchID uuid.UUID
	Actor      Actor
}

func (s *Service) MobilizeRole(ctx context.Context, tenantID uuid.UUID, in MobilizeRoleInput) (*RoleMobilizationResult, error) {
	if !in.Actor.Can(PermRespondUpdate) {
		return nil, ErrUnauthorized
	}
	if s.notificationEngine == nil {
		return nil, ErrMobilizationNotConfigured
	}
	if tenantID == uuid.Nil || in.IncidentID == uuid.Nil || in.AssignmentID == uuid.Nil {
		return nil, fmt.Errorf("tenant_id, incident_id, and assignment_id are required: %w", ErrValidation)
	}
	requiresAck := true
	if in.RequiresAck != nil {
		requiresAck = *in.RequiresAck
	}
	ackTimeout := in.AckTimeout
	if ackTimeout <= 0 {
		ackTimeout = s.mobilizationAckTimeout
	}
	if ackTimeout <= 0 {
		ackTimeout = 5 * time.Minute
	}

	var incident *Incident
	var assignment *RoleAssignment
	var directoryEntries []ResponderDirectoryEntry
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		incident, err = s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		assignment, err = s.repo.GetIncidentRoleAssignment(ctx, tx, tenantID, in.IncidentID, in.AssignmentID)
		if err != nil {
			return err
		}
		if assignment.Status != RoleAssignmentActive {
			return ErrRoleAssignmentInactive
		}
		directoryEntries, err = s.repo.ListResponderDirectoryEntriesForUser(ctx, tx, tenantID, assignment.ResponderID)
		return err
	})
	if err != nil {
		return nil, err
	}

	responder := responderFromAssignment(*assignment, directoryEntries)
	escalationChain, err := s.resolveMobilizationEscalationChain(ctx, tenantID, incident, *assignment, responder)
	if err != nil {
		return nil, err
	}
	channels, err := mobilizationChannels(in.Channels, responder)
	if err != nil {
		return nil, err
	}
	if len(channels) == 0 {
		return nil, ErrMobilizationNoChannels
	}

	result := &RoleMobilizationResult{
		Assignment: *assignment,
		Responder:  responder,
		Dispatches: make([]NotificationDispatch, 0, len(channels)),
	}
	for _, channel := range channels {
		request := NotificationDispatchRequest{
			TenantID:         tenantID,
			IncidentID:       in.IncidentID,
			RoleAssignmentID: &assignment.ID,
			Role:             assignment.Role,
			RecipientUserID:  assignment.ResponderID,
			Channel:          channel,
			IdempotencyKey:   mobilizationIdempotencyKey(*assignment, channel),
			Title:            mobilizationTitle(*incident, *assignment),
			Body:             mobilizationBody(*incident, *assignment),
			ActionURL:        strings.TrimSpace(in.ActionURL),
			Payload:          mobilizationPayload(*incident, *assignment, responder),
			RequiresAck:      requiresAck,
			AckTimeout:       ackTimeout,
			EscalationChain:  escalationChain,
		}
		dispatch, created, dispatchErr := s.notificationEngine.Dispatch(ctx, request)
		if dispatch != nil {
			result.Dispatches = append(result.Dispatches, *dispatch)
			if created {
				result.CreatedCount++
			}
			eventType := EventRoleMobilized
			if dispatch.DeliveryState == NotificationDeliveryFailed || dispatchErr != nil {
				eventType = EventNotificationDispatchFailed
			}
			if err := s.appendNotificationTimeline(ctx, tenantID, in.IncidentID, in.Actor.UserID, eventType, notificationDispatchTimelinePayload(*dispatch, created)); err != nil {
				return result, err
			}
		}
		if dispatchErr != nil {
			return result, dispatchErr
		}
	}
	return result, nil
}

func (s *Service) AcknowledgeMobilization(ctx context.Context, tenantID uuid.UUID, in AcknowledgeMobilizationInput) (*NotificationDispatch, error) {
	if s.notificationEngine == nil {
		return nil, ErrMobilizationNotConfigured
	}
	if tenantID == uuid.Nil || in.IncidentID == uuid.Nil || in.DispatchID == uuid.Nil {
		return nil, fmt.Errorf("tenant_id, incident_id, and dispatch_id are required: %w", ErrValidation)
	}
	var existing *NotificationDispatch
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		existing, err = s.repo.GetNotificationDispatch(ctx, tx, tenantID, in.DispatchID)
		return err
	})
	if err != nil {
		return nil, err
	}
	if existing.IncidentID != in.IncidentID {
		return nil, ErrNotificationDispatchNotFound
	}
	if in.Actor.UserID != existing.RecipientUserID && !in.Actor.Can(PermRespondUpdate) {
		return nil, ErrUnauthorized
	}
	acknowledged, err := s.notificationEngine.Acknowledge(ctx, tenantID, in.DispatchID, in.Actor.UserID)
	if err != nil {
		return nil, err
	}
	if err := s.appendNotificationTimeline(ctx, tenantID, in.IncidentID, in.Actor.UserID, EventNotificationAcknowledged, notificationDispatchTimelinePayload(*acknowledged, false)); err != nil {
		return nil, err
	}
	return acknowledged, nil
}

func (s *Service) ProcessDueNotificationEscalations(ctx context.Context, tenantID uuid.UUID, actor Actor, limit int) ([]NotificationDispatch, error) {
	if !actor.Can(PermRespondUpdate) {
		return nil, ErrUnauthorized
	}
	if s.notificationEngine == nil {
		return nil, ErrMobilizationNotConfigured
	}
	escalated, err := s.notificationEngine.ProcessDueEscalations(ctx, tenantID, limit)
	if err != nil {
		return nil, err
	}
	for _, dispatch := range escalated {
		if err := s.appendNotificationTimeline(ctx, tenantID, dispatch.IncidentID, actor.UserID, EventNotificationEscalated, notificationDispatchTimelinePayload(dispatch, true)); err != nil {
			return escalated, err
		}
	}
	return escalated, nil
}

func (s *Service) ListIncidentNotificationDispatches(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor, limit int) ([]NotificationDispatch, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var out []NotificationDispatch
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, err = s.repo.ListNotificationDispatchesForIncident(ctx, tx, tenantID, incidentID, limit)
		return err
	})
	return out, err
}

func (s *Service) appendNotificationTimeline(ctx context.Context, tenantID, incidentID, actorID uuid.UUID, eventType string, payload map[string]any) error {
	if actorID == uuid.Nil {
		return ErrRoleAssignmentActorMissing
	}
	event := TimelineEvent{
		TenantID:   tenantID,
		IncidentID: incidentID,
		ActorID:    actorID,
		OccurredAt: s.now(),
		EventType:  eventType,
		Payload:    payload,
	}
	if err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	}); err != nil {
		return err
	}
	s.feed.Publish(event)
	return nil
}

func (s *Service) resolveMobilizationEscalationChain(ctx context.Context, tenantID uuid.UUID, incident *Incident, assignment RoleAssignment, responder ResolvedResponder) ([]uuid.UUID, error) {
	chain := []uuid.UUID{assignment.ResponderID}
	if s.responderResolver == nil || incident == nil {
		return chain, nil
	}
	resolved, err := s.responderResolver.ResolveResponders(ctx, ResponderResolutionRequest{
		TenantID:      tenantID,
		IncidentID:    assignment.IncidentID,
		Role:          assignment.Role,
		ServiceKeys:   incident.ImpactedServices,
		IncludeOnCall: true,
		Limit:         20,
	})
	if err != nil {
		return nil, err
	}
	for _, candidate := range resolved {
		if candidate.UserID == uuid.Nil {
			continue
		}
		if candidate.UserID == responder.UserID {
			continue
		}
		chain = append(chain, candidate.UserID)
	}
	return normalizeUUIDs(chain), nil
}

func responderFromAssignment(assignment RoleAssignment, entries []ResponderDirectoryEntry) ResolvedResponder {
	responder := ResolvedResponder{
		UserID: assignment.ResponderID,
		Roles:  []IncidentRole{assignment.Role},
		Source: "role_assignment",
	}
	for _, entry := range entries {
		responder = mergeResponder(responder, entry.toResolvedResponder("respond_responder_directory"))
	}
	return responder
}

func mobilizationChannels(requested []NotificationChannel, responder ResolvedResponder) ([]NotificationChannel, error) {
	if len(requested) == 0 {
		out := []NotificationChannel{NotificationChannelInApp, NotificationChannelWebSocket}
		if strings.TrimSpace(responder.Email) != "" {
			out = append(out, NotificationChannelEmail)
		}
		return out, nil
	}
	seen := map[NotificationChannel]struct{}{}
	out := make([]NotificationChannel, 0, len(requested))
	for _, channel := range requested {
		channel = NotificationChannel(strings.TrimSpace(string(channel)))
		if !channel.Valid() {
			return nil, ErrNotificationChannelUnsupported
		}
		if channel == NotificationChannelEmail && strings.TrimSpace(responder.Email) == "" {
			return nil, fmt.Errorf("email channel requires responder email: %w", ErrResponderDirectoryInvalid)
		}
		if channel == NotificationChannelChat && strings.TrimSpace(responder.ChatHandle) == "" {
			return nil, fmt.Errorf("chat channel requires responder chat handle: %w", ErrResponderDirectoryInvalid)
		}
		if _, err := notificationServiceChannel(channel); err != nil {
			return nil, err
		}
		if _, ok := seen[channel]; ok {
			continue
		}
		seen[channel] = struct{}{}
		out = append(out, channel)
	}
	return out, nil
}

func mobilizationIdempotencyKey(assignment RoleAssignment, channel NotificationChannel) string {
	return strings.Join([]string{
		"respond",
		assignment.IncidentID.String(),
		"role",
		assignment.ID.String(),
		"mobilization",
		string(channel),
	}, ":")
}

func mobilizationTitle(incident Incident, assignment RoleAssignment) string {
	return fmt.Sprintf("%s role assigned: %s", incident.Reference, strings.ReplaceAll(string(assignment.Role), "_", " "))
}

func mobilizationBody(incident Incident, assignment RoleAssignment) string {
	return fmt.Sprintf("You have been assigned as %s for %s: %s.", strings.ReplaceAll(string(assignment.Role), "_", " "), incident.Reference, incident.Title)
}

func mobilizationPayload(incident Incident, assignment RoleAssignment, responder ResolvedResponder) map[string]any {
	return map[string]any{
		"incident_id":        incident.ID.String(),
		"incident_reference": incident.Reference,
		"incident_title":     incident.Title,
		"severity":           string(incident.Severity),
		"role":               string(assignment.Role),
		"assignment_id":      assignment.ID.String(),
		"responder_id":       assignment.ResponderID.String(),
		"display_name":       responder.DisplayName,
		"email":              responder.Email,
		"phone":              responder.Phone,
		"chat_handle":        responder.ChatHandle,
		"team_key":           responder.TeamKey,
		"service_key":        responder.ServiceKey,
		"source":             responder.Source,
	}
}

func notificationDispatchTimelinePayload(dispatch NotificationDispatch, created bool) map[string]any {
	payload := map[string]any{
		"dispatch_id":       dispatch.ID.String(),
		"role":              string(dispatch.Role),
		"recipient_user_id": dispatch.RecipientUserID.String(),
		"channel":           string(dispatch.Channel),
		"delivery_state":    string(dispatch.DeliveryState),
		"ack_state":         string(dispatch.AckState),
		"escalation_state":  string(dispatch.EscalationState),
		"created":           created,
	}
	if dispatch.RoleAssignmentID != nil {
		payload["assignment_id"] = dispatch.RoleAssignmentID.String()
	}
	if dispatch.EscalatedDispatchID != nil {
		payload["escalated_dispatch_id"] = dispatch.EscalatedDispatchID.String()
	}
	if dispatch.LastError != "" {
		payload["last_error"] = dispatch.LastError
	}
	return payload
}
