package respond

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const EventStakeholderUpdateDispatched = "respond.stakeholder_update.dispatched"

type StakeholderUpdateReason string

const (
	StakeholderUpdateReasonPeriodic  StakeholderUpdateReason = "periodic"
	StakeholderUpdateReasonTriggered StakeholderUpdateReason = "triggered"
	StakeholderUpdateReasonManual    StakeholderUpdateReason = "manual"
)

func (r StakeholderUpdateReason) valid() bool {
	switch r {
	case StakeholderUpdateReasonPeriodic, StakeholderUpdateReasonTriggered, StakeholderUpdateReasonManual:
		return true
	default:
		return false
	}
}

type StakeholderUpdateStatus string

const (
	StakeholderUpdateStatusSent   StakeholderUpdateStatus = "sent"
	StakeholderUpdateStatusFailed StakeholderUpdateStatus = "failed"
)

type StakeholderTimelineSummary struct {
	EventCount int
	Latest     *TimelineEvent
}

type StakeholderUpdateSnapshot struct {
	Incident     *Incident
	Timeline     StakeholderTimelineSummary
	Reason       StakeholderUpdateReason
	GeneratedAt  time.Time
	NextUpdateAt *time.Time
}

type StakeholderUpdateContent struct {
	Subject               string     `json:"subject"`
	Body                  string     `json:"body"`
	ImpactSummary         string     `json:"impact_summary"`
	CurrentPhase          string     `json:"current_phase"`
	NextUpdateAt          *time.Time `json:"next_update_at,omitempty"`
	SourceTimelineEventID *uuid.UUID `json:"source_timeline_event_id,omitempty"`
	TimelineEventCount    int        `json:"timeline_event_count"`
}

type StakeholderUpdateGenerator interface {
	GenerateStakeholderUpdate(ctx context.Context, snapshot StakeholderUpdateSnapshot) (StakeholderUpdateContent, error)
}

type DeterministicStakeholderUpdateGenerator struct{}

func (DeterministicStakeholderUpdateGenerator) GenerateStakeholderUpdate(_ context.Context, snapshot StakeholderUpdateSnapshot) (StakeholderUpdateContent, error) {
	if snapshot.Incident == nil {
		return StakeholderUpdateContent{}, fmt.Errorf("incident is required: %w", ErrValidation)
	}
	inc := snapshot.Incident
	impact := stakeholderImpactSummary(inc.Description, inc.ImpactedServices)
	phase := string(inc.Status)
	services := normalizeServices(inc.ImpactedServices)
	serviceText := "none recorded"
	if len(services) > 0 {
		serviceText = strings.Join(services, ", ")
	}

	latestText := "No timeline events have been recorded for this incident."
	var sourceID *uuid.UUID
	if snapshot.Timeline.Latest != nil {
		latest := snapshot.Timeline.Latest
		sourceID = &latest.ID
		latestText = fmt.Sprintf("%s at %s by %s: %s",
			latest.EventType,
			latest.OccurredAt.UTC().Format(time.RFC3339),
			latest.ActorID.String(),
			summarizeEvent(*latest),
		)
	}

	next := "not scheduled"
	if snapshot.NextUpdateAt != nil {
		next = snapshot.NextUpdateAt.UTC().Format(time.RFC3339)
	}
	generatedAt := snapshot.GeneratedAt.UTC().Format(time.RFC3339)
	subject := fmt.Sprintf("%s %s %s update", inc.Reference, inc.Severity, inc.Status)
	body := strings.Join([]string{
		fmt.Sprintf("Incident: %s - %s", inc.Reference, inc.Title),
		fmt.Sprintf("Severity/status: %s / %s", inc.Severity, inc.Status),
		"Impact: " + impact,
		"Current phase: " + phase,
		"Impacted services: " + serviceText,
		fmt.Sprintf("Timeline events recorded: %d", snapshot.Timeline.EventCount),
		"Latest timeline event: " + latestText,
		"Next stakeholder update: " + next,
		"Generated at: " + generatedAt,
	}, "\n")

	return StakeholderUpdateContent{
		Subject:               subject,
		Body:                  body,
		ImpactSummary:         impact,
		CurrentPhase:          phase,
		NextUpdateAt:          snapshot.NextUpdateAt,
		SourceTimelineEventID: sourceID,
		TimelineEventCount:    snapshot.Timeline.EventCount,
	}, nil
}

type StakeholderUpdateDispatch struct {
	ID                    uuid.UUID               `json:"id"`
	TenantID              uuid.UUID               `json:"tenant_id"`
	IncidentID            uuid.UUID               `json:"incident_id"`
	Reason                StakeholderUpdateReason `json:"reason"`
	Channel               string                  `json:"channel"`
	RecipientRef          string                  `json:"recipient_ref"`
	Subject               string                  `json:"subject"`
	Body                  string                  `json:"body"`
	IncidentRowVersion    int                     `json:"incident_row_version"`
	TimelineEventCount    int                     `json:"timeline_event_count"`
	SourceTimelineEventID *uuid.UUID              `json:"source_timeline_event_id,omitempty"`
	NextUpdateAt          *time.Time              `json:"next_update_at,omitempty"`
	Status                StakeholderUpdateStatus `json:"status"`
	ReceiptRef            string                  `json:"receipt_ref,omitempty"`
	DispatchedBy          uuid.UUID               `json:"dispatched_by"`
	DispatchedAt          time.Time               `json:"dispatched_at"`
	CreatedAt             time.Time               `json:"created_at"`
}

type GenerateStakeholderUpdateInput struct {
	IncidentID   uuid.UUID
	Reason       StakeholderUpdateReason
	NextUpdateAt *time.Time
	Actor        Actor
}

type DispatchStakeholderUpdateInput struct {
	IncidentID   uuid.UUID
	Reason       StakeholderUpdateReason
	Channel      string
	RecipientRef string
	NextUpdateAt *time.Time
	ReceiptRef   string
	Actor        Actor
}

const stakeholderUpdateDispatchColumns = `id, tenant_id, incident_id, reason, channel,
recipient_ref, subject, body, incident_row_version, timeline_event_count,
source_timeline_event_id, next_update_at, status, receipt_ref, dispatched_by,
dispatched_at, created_at`

func scanStakeholderUpdateDispatch(row rowScanner) (*StakeholderUpdateDispatch, error) {
	var dispatch StakeholderUpdateDispatch
	var reason, status string
	var sourceID uuid.NullUUID
	if err := row.Scan(
		&dispatch.ID,
		&dispatch.TenantID,
		&dispatch.IncidentID,
		&reason,
		&dispatch.Channel,
		&dispatch.RecipientRef,
		&dispatch.Subject,
		&dispatch.Body,
		&dispatch.IncidentRowVersion,
		&dispatch.TimelineEventCount,
		&sourceID,
		&dispatch.NextUpdateAt,
		&status,
		&dispatch.ReceiptRef,
		&dispatch.DispatchedBy,
		&dispatch.DispatchedAt,
		&dispatch.CreatedAt,
	); err != nil {
		return nil, err
	}
	dispatch.Reason = StakeholderUpdateReason(reason)
	dispatch.Status = StakeholderUpdateStatus(status)
	if sourceID.Valid {
		dispatch.SourceTimelineEventID = &sourceID.UUID
	}
	return &dispatch, nil
}

func (s *Store) GetStakeholderTimelineSummary(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID) (StakeholderTimelineSummary, error) {
	var summary StakeholderTimelineSummary
	if err := db.QueryRow(ctx, `
SELECT count(*) FROM respond_incident_timeline_event
WHERE tenant_id = $1 AND incident_id = $2`, tenantID, incidentID).Scan(&summary.EventCount); err != nil {
		return summary, fmt.Errorf("respond: count stakeholder timeline events: %w", err)
	}

	var ev TimelineEvent
	var payloadJSON []byte
	err := db.QueryRow(ctx, `
SELECT id, tenant_id, incident_id, actor_id, occurred_at, event_type, payload
FROM respond_incident_timeline_event
WHERE tenant_id = $1 AND incident_id = $2
ORDER BY occurred_at DESC, id DESC
LIMIT 1`, tenantID, incidentID).Scan(
		&ev.ID,
		&ev.TenantID,
		&ev.IncidentID,
		&ev.ActorID,
		&ev.OccurredAt,
		&ev.EventType,
		&payloadJSON,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return summary, nil
		}
		return summary, fmt.Errorf("respond: get latest stakeholder timeline event: %w", err)
	}
	if len(payloadJSON) > 0 {
		if err := json.Unmarshal(payloadJSON, &ev.Payload); err != nil {
			return summary, fmt.Errorf("respond: unmarshal stakeholder timeline payload: %w", err)
		}
	}
	if ev.Payload == nil {
		ev.Payload = map[string]any{}
	}
	summary.Latest = &ev
	return summary, nil
}

func (s *Store) CreateStakeholderUpdateDispatch(ctx context.Context, db DBTX, dispatch *StakeholderUpdateDispatch) error {
	var sourceID any
	if dispatch.SourceTimelineEventID != nil {
		sourceID = *dispatch.SourceTimelineEventID
	}
	created, err := scanStakeholderUpdateDispatch(db.QueryRow(ctx, `
INSERT INTO respond_stakeholder_update_dispatch (
    tenant_id, incident_id, reason, channel, recipient_ref, subject, body,
    incident_row_version, timeline_event_count, source_timeline_event_id,
    next_update_at, status, receipt_ref, dispatched_by, dispatched_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
RETURNING `+stakeholderUpdateDispatchColumns,
		dispatch.TenantID,
		dispatch.IncidentID,
		dispatch.Reason,
		dispatch.Channel,
		dispatch.RecipientRef,
		dispatch.Subject,
		dispatch.Body,
		dispatch.IncidentRowVersion,
		dispatch.TimelineEventCount,
		sourceID,
		dispatch.NextUpdateAt,
		dispatch.Status,
		dispatch.ReceiptRef,
		dispatch.DispatchedBy,
		dispatch.DispatchedAt,
	))
	if err != nil {
		return fmt.Errorf("respond: create stakeholder update dispatch: %w", err)
	}
	*dispatch = *created
	return nil
}

func (s *Store) UpdateStakeholderTokensNextUpdate(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, nextUpdateAt *time.Time) error {
	if nextUpdateAt == nil {
		return nil
	}
	if _, err := db.Exec(ctx, `
UPDATE respond_stakeholder_token
   SET next_update_at = $3
 WHERE tenant_id = $1
   AND incident_id = $2
   AND revoked_at IS NULL`, tenantID, incidentID, *nextUpdateAt); err != nil {
		return fmt.Errorf("respond: update stakeholder token next update: %w", err)
	}
	return nil
}

func (s *Store) ListStakeholderUpdateDispatches(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, limit int) ([]StakeholderUpdateDispatch, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := db.Query(ctx, `SELECT `+stakeholderUpdateDispatchColumns+`
FROM respond_stakeholder_update_dispatch
WHERE tenant_id = $1 AND incident_id = $2
ORDER BY dispatched_at DESC, id DESC
LIMIT $3`, tenantID, incidentID, limit)
	if err != nil {
		return nil, fmt.Errorf("respond: list stakeholder update dispatches: %w", err)
	}
	defer rows.Close()
	var out []StakeholderUpdateDispatch
	for rows.Next() {
		dispatch, err := scanStakeholderUpdateDispatch(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan stakeholder update dispatch: %w", err)
		}
		out = append(out, *dispatch)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read stakeholder update dispatches: %w", err)
	}
	return out, nil
}

func (s *Service) GenerateStakeholderUpdate(ctx context.Context, tenantID uuid.UUID, in GenerateStakeholderUpdateInput) (*StakeholderUpdateContent, error) {
	if !in.Actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	if in.IncidentID == uuid.Nil {
		return nil, fmt.Errorf("incident_id is required: %w", ErrValidation)
	}
	reason := in.Reason
	if reason == "" {
		reason = StakeholderUpdateReasonManual
	}
	if !reason.valid() {
		return nil, fmt.Errorf("invalid stakeholder update reason: %w", ErrValidation)
	}
	var content StakeholderUpdateContent
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		inc, err := s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		summary, err := s.repo.GetStakeholderTimelineSummary(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		next := in.NextUpdateAt
		if next == nil {
			next = defaultStakeholderNextUpdate(inc, s.now())
		}
		content, err = DeterministicStakeholderUpdateGenerator{}.GenerateStakeholderUpdate(ctx, StakeholderUpdateSnapshot{
			Incident:     inc,
			Timeline:     summary,
			Reason:       reason,
			GeneratedAt:  s.now(),
			NextUpdateAt: next,
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return &content, nil
}

func (s *Service) DispatchStakeholderUpdate(ctx context.Context, tenantID uuid.UUID, in DispatchStakeholderUpdateInput) (*StakeholderUpdateDispatch, error) {
	if !in.Actor.Can(PermRespondTimeline) {
		return nil, ErrUnauthorized
	}
	if in.IncidentID == uuid.Nil || in.Actor.UserID == uuid.Nil {
		return nil, fmt.Errorf("incident_id and actor are required: %w", ErrValidation)
	}
	reason := in.Reason
	if reason == "" {
		reason = StakeholderUpdateReasonManual
	}
	if !reason.valid() {
		return nil, fmt.Errorf("invalid stakeholder update reason: %w", ErrValidation)
	}
	channel := strings.TrimSpace(in.Channel)
	if channel == "" {
		channel = "status_page"
	}
	dispatchedAt := s.now()
	var dispatch *StakeholderUpdateDispatch
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		inc, err := s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		summary, err := s.repo.GetStakeholderTimelineSummary(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		next := in.NextUpdateAt
		if next == nil {
			next = defaultStakeholderNextUpdate(inc, dispatchedAt)
		}
		content, err := DeterministicStakeholderUpdateGenerator{}.GenerateStakeholderUpdate(ctx, StakeholderUpdateSnapshot{
			Incident:     inc,
			Timeline:     summary,
			Reason:       reason,
			GeneratedAt:  dispatchedAt,
			NextUpdateAt: next,
		})
		if err != nil {
			return err
		}
		dispatch = &StakeholderUpdateDispatch{
			TenantID:              tenantID,
			IncidentID:            in.IncidentID,
			Reason:                reason,
			Channel:               channel,
			RecipientRef:          strings.TrimSpace(in.RecipientRef),
			Subject:               content.Subject,
			Body:                  content.Body,
			IncidentRowVersion:    inc.RowVersion,
			TimelineEventCount:    content.TimelineEventCount,
			SourceTimelineEventID: content.SourceTimelineEventID,
			NextUpdateAt:          content.NextUpdateAt,
			Status:                StakeholderUpdateStatusSent,
			ReceiptRef:            strings.TrimSpace(in.ReceiptRef),
			DispatchedBy:          in.Actor.UserID,
			DispatchedAt:          dispatchedAt,
		}
		if err := s.repo.CreateStakeholderUpdateDispatch(ctx, tx, dispatch); err != nil {
			return err
		}
		if err := s.repo.UpdateStakeholderTokensNextUpdate(ctx, tx, tenantID, in.IncidentID, dispatch.NextUpdateAt); err != nil {
			return err
		}
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: in.IncidentID,
			ActorID:    in.Actor.UserID,
			OccurredAt: dispatchedAt,
			EventType:  EventStakeholderUpdateDispatched,
			Payload: map[string]any{
				"dispatch_id":          dispatch.ID.String(),
				"reason":               dispatch.Reason,
				"channel":              dispatch.Channel,
				"recipient_ref":        dispatch.RecipientRef,
				"subject":              dispatch.Subject,
				"next_update_at":       timePtrRFC3339(dispatch.NextUpdateAt),
				"timeline_event_count": dispatch.TimelineEventCount,
				"source_timeline_id":   uuidPtrString(dispatch.SourceTimelineEventID),
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("incident_id", in.IncidentID.String()).Str("dispatch_id", dispatch.ID.String()).Str("channel", dispatch.Channel).Msg("respond stakeholder update dispatched")
	return dispatch, nil
}

func defaultStakeholderNextUpdate(inc *Incident, now time.Time) *time.Time {
	interval := 4 * time.Hour
	switch inc.Severity {
	case SeveritySEV1:
		interval = 15 * time.Minute
	case SeveritySEV2:
		interval = 30 * time.Minute
	case SeveritySEV3:
		interval = time.Hour
	}
	next := now.UTC().Add(interval)
	return &next
}

func timePtrRFC3339(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func uuidPtrString(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}
