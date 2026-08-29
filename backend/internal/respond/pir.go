package respond

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrPIRNotFound            = errors.New("respond PIR not found")
	ErrPIRIncidentNotResolved = errors.New("respond PIR requires a resolved incident")
	ErrPIRSignedOff           = errors.New("respond PIR has already been signed off")
	ErrPIRNotComplete         = errors.New("respond PIR is not complete and signed off")
	ErrPIRActionItemNotFound  = errors.New("respond PIR action item not found")
)

const (
	EventPIRGenerated         = "respond.pir.generated"
	EventPIRSignedOff         = "respond.pir.signed_off"
	EventPIRActionItemUpdated = "respond.pir.action_item.updated"
)

type PIRStatus string

const (
	PIRStatusDraft     PIRStatus = "draft"
	PIRStatusSignedOff PIRStatus = "signed_off"
)

type PIRActionItemStatus string

const (
	PIRActionItemOpen       PIRActionItemStatus = "open"
	PIRActionItemInProgress PIRActionItemStatus = "in_progress"
	PIRActionItemClosed     PIRActionItemStatus = "closed"
	PIRActionItemCancelled  PIRActionItemStatus = "cancelled"
)

func (s PIRActionItemStatus) valid() bool {
	switch s {
	case PIRActionItemOpen, PIRActionItemInProgress, PIRActionItemClosed, PIRActionItemCancelled:
		return true
	default:
		return false
	}
}

type IncidentPIR struct {
	ID                  uuid.UUID               `json:"id"`
	TenantID            uuid.UUID               `json:"tenant_id"`
	IncidentID          uuid.UUID               `json:"incident_id"`
	Status              PIRStatus               `json:"status"`
	Summary             string                  `json:"summary"`
	Timeline            []PIRTimelineEntry      `json:"timeline"`
	SeverityHistory     []PIRSeverityChange     `json:"severity_history"`
	Roles               []PIRRoleRecord         `json:"roles"`
	Tasks               []PIRTaskRecord         `json:"tasks"`
	Approvals           []PIRApprovalRecord     `json:"approvals"`
	Notifications       []PIRNotificationRecord `json:"notifications"`
	Integrations        []PIRIntegrationRecord  `json:"integrations"`
	MTTR                PIRMTTR                 `json:"mttr"`
	ContributingFactors []string                `json:"contributing_factors"`
	LessonsLearned      []string                `json:"lessons_learned"`
	ActionItems         []PIRActionItem         `json:"action_items"`
	GeneratedBy         uuid.UUID               `json:"generated_by"`
	GeneratedAt         time.Time               `json:"generated_at"`
	SignedOffBy         *uuid.UUID              `json:"signed_off_by,omitempty"`
	SignedOffAt         *time.Time              `json:"signed_off_at,omitempty"`
	ContentHash         string                  `json:"content_hash"`
	RowVersion          int                     `json:"row_version"`
	CreatedAt           time.Time               `json:"created_at"`
	UpdatedAt           time.Time               `json:"updated_at"`
}

type PIRTimelineEntry struct {
	EventID    uuid.UUID      `json:"event_id"`
	OccurredAt time.Time      `json:"occurred_at"`
	EventType  string         `json:"event_type"`
	ActorID    uuid.UUID      `json:"actor_id"`
	Summary    string         `json:"summary"`
	Payload    map[string]any `json:"payload"`
}

type PIRSeverityChange struct {
	OccurredAt time.Time `json:"occurred_at"`
	ActorID    uuid.UUID `json:"actor_id"`
	From       string    `json:"from,omitempty"`
	To         Severity  `json:"to"`
	Source     string    `json:"source"`
}

type PIRRoleRecord struct {
	OccurredAt time.Time `json:"occurred_at"`
	ActorID    uuid.UUID `json:"actor_id"`
	Role       string    `json:"role"`
	UserID     string    `json:"user_id"`
	EventType  string    `json:"event_type"`
}

type PIRTaskRecord struct {
	OccurredAt      time.Time `json:"occurred_at"`
	TaskID          string    `json:"task_id,omitempty"`
	Title           string    `json:"title"`
	Status          string    `json:"status"`
	OwnerID         string    `json:"owner_id,omitempty"`
	DurationSeconds int       `json:"duration_seconds,omitempty"`
	SourceEventType string    `json:"source_event_type"`
}

type PIRApprovalRecord struct {
	ApprovalID     uuid.UUID        `json:"approval_id"`
	Action         ApprovalAction   `json:"action"`
	ActionKey      string           `json:"action_key"`
	RequestedBy    uuid.UUID        `json:"requested_by"`
	RequestedAt    time.Time        `json:"requested_at"`
	RequiredRole   string           `json:"required_role,omitempty"`
	Decision       ApprovalDecision `json:"decision"`
	DecidedBy      string           `json:"decided_by,omitempty"`
	DecidedAt      *time.Time       `json:"decided_at,omitempty"`
	WorkflowSystem string           `json:"workflow_system,omitempty"`
	WorkflowTaskID string           `json:"workflow_task_id,omitempty"`
}

type PIRNotificationRecord struct {
	OccurredAt time.Time `json:"occurred_at"`
	EventType  string    `json:"event_type"`
	ActorID    uuid.UUID `json:"actor_id"`
	Channel    string    `json:"channel"`
	Recipient  string    `json:"recipient"`
	Subject    string    `json:"subject"`
	Status     string    `json:"status"`
}

type PIRIntegrationRecord struct {
	OccurredAt     time.Time `json:"occurred_at"`
	EventType      string    `json:"event_type"`
	ActorID        uuid.UUID `json:"actor_id"`
	System         string    `json:"system"`
	ExternalID     string    `json:"external_id"`
	ExternalStatus string    `json:"external_status"`
}

type PIRMTTR struct {
	StartedAt     time.Time `json:"started_at"`
	ResolvedAt    time.Time `json:"resolved_at"`
	ActualSeconds int       `json:"actual_seconds"`
	TargetSeconds int       `json:"target_seconds"`
	MetTarget     bool      `json:"met_target"`
	BasisSeverity Severity  `json:"basis_severity"`
}

type PIRActionItem struct {
	ID          uuid.UUID           `json:"id"`
	TenantID    uuid.UUID           `json:"tenant_id"`
	PIRID       uuid.UUID           `json:"pir_id"`
	IncidentID  uuid.UUID           `json:"incident_id"`
	Title       string              `json:"title"`
	Description string              `json:"description"`
	OwnerID     *uuid.UUID          `json:"owner_id,omitempty"`
	Status      PIRActionItemStatus `json:"status"`
	DueAt       *time.Time          `json:"due_at,omitempty"`
	CompletedAt *time.Time          `json:"completed_at,omitempty"`
	CreatedBy   uuid.UUID           `json:"created_by"`
	CreatedAt   time.Time           `json:"created_at"`
	UpdatedAt   time.Time           `json:"updated_at"`
}

type GeneratePIRInput struct {
	IncidentID          uuid.UUID
	ContributingFactors []string
	LessonsLearned      []string
	ActionItems         []CreatePIRActionItemInput
	Actor               Actor
}

type CreatePIRActionItemInput struct {
	Title       string
	Description string
	OwnerID     *uuid.UUID
	DueAt       *time.Time
}

type SignOffPIRInput struct {
	IncidentID uuid.UUID
	Actor      Actor
}

type UpdatePIRActionItemInput struct {
	ActionItemID uuid.UUID
	Status       PIRActionItemStatus
	Actor        Actor
}

type PIRSupplementalProvider interface {
	ListPIRRoles(ctx context.Context, tenantID, incidentID uuid.UUID) ([]PIRRoleRecord, error)
	ListPIRTasks(ctx context.Context, tenantID, incidentID uuid.UUID) ([]PIRTaskRecord, error)
	ListPIRNotifications(ctx context.Context, tenantID, incidentID uuid.UUID) ([]PIRNotificationRecord, error)
	ListPIRIntegrations(ctx context.Context, tenantID, incidentID uuid.UUID) ([]PIRIntegrationRecord, error)
}

const incidentPIRColumns = `id, tenant_id, incident_id, status, summary, timeline,
severity_history, roles, tasks, approvals, notifications, integrations,
mttr_started_at, mttr_resolved_at, mttr_seconds, mttr_target_seconds, mttr_met,
mttr_basis_severity, contributing_factors,
lessons_learned, generated_by, generated_at, signed_off_by, signed_off_at,
content_hash, row_version, created_at, updated_at`

func scanIncidentPIR(row rowScanner) (*IncidentPIR, error) {
	var pir IncidentPIR
	var status string
	var timelineJSON, severityJSON, rolesJSON, tasksJSON, approvalsJSON, notificationsJSON, integrationsJSON []byte
	var factorsJSON, lessonsJSON []byte
	var signedOffBy uuid.NullUUID
	var basisSeverity string
	if err := row.Scan(
		&pir.ID,
		&pir.TenantID,
		&pir.IncidentID,
		&status,
		&pir.Summary,
		&timelineJSON,
		&severityJSON,
		&rolesJSON,
		&tasksJSON,
		&approvalsJSON,
		&notificationsJSON,
		&integrationsJSON,
		&pir.MTTR.StartedAt,
		&pir.MTTR.ResolvedAt,
		&pir.MTTR.ActualSeconds,
		&pir.MTTR.TargetSeconds,
		&pir.MTTR.MetTarget,
		&basisSeverity,
		&factorsJSON,
		&lessonsJSON,
		&pir.GeneratedBy,
		&pir.GeneratedAt,
		&signedOffBy,
		&pir.SignedOffAt,
		&pir.ContentHash,
		&pir.RowVersion,
		&pir.CreatedAt,
		&pir.UpdatedAt,
	); err != nil {
		return nil, err
	}
	pir.Status = PIRStatus(status)
	pir.MTTR.BasisSeverity = Severity(basisSeverity)
	if signedOffBy.Valid {
		pir.SignedOffBy = &signedOffBy.UUID
	}
	for _, item := range []struct {
		name string
		raw  []byte
		dest any
	}{
		{"timeline", timelineJSON, &pir.Timeline},
		{"severity history", severityJSON, &pir.SeverityHistory},
		{"roles", rolesJSON, &pir.Roles},
		{"tasks", tasksJSON, &pir.Tasks},
		{"approvals", approvalsJSON, &pir.Approvals},
		{"notifications", notificationsJSON, &pir.Notifications},
		{"integrations", integrationsJSON, &pir.Integrations},
		{"contributing factors", factorsJSON, &pir.ContributingFactors},
		{"lessons learned", lessonsJSON, &pir.LessonsLearned},
	} {
		if len(item.raw) == 0 {
			continue
		}
		if err := json.Unmarshal(item.raw, item.dest); err != nil {
			return nil, fmt.Errorf("respond: unmarshal PIR %s: %w", item.name, err)
		}
	}
	return &pir, nil
}

func (s *Store) ListAllTimelineEvents(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID) ([]TimelineEvent, error) {
	var all []TimelineEvent
	var after *uuid.UUID
	for {
		batch, err := s.ListTimelineEvents(ctx, db, tenantID, incidentID, TimelineFilter{Limit: 500, AfterID: after})
		if err != nil {
			return nil, err
		}
		all = append(all, batch...)
		if len(batch) < 500 {
			break
		}
		last := batch[len(batch)-1].ID
		after = &last
	}
	return all, nil
}

func (s *Store) UpsertIncidentPIR(ctx context.Context, db DBTX, pir *IncidentPIR) error {
	fields, err := pirJSONFields(pir)
	if err != nil {
		return err
	}
	row := db.QueryRow(ctx, `
INSERT INTO respond_incident_pir (
    tenant_id, incident_id, status, summary, timeline, severity_history,
    roles, tasks, approvals, notifications, integrations, mttr_started_at,
    mttr_resolved_at, mttr_seconds, mttr_target_seconds, mttr_met,
    mttr_basis_severity, contributing_factors, lessons_learned,
    generated_by, generated_at, content_hash
)
VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
ON CONFLICT (tenant_id, incident_id) DO UPDATE
   SET status = 'draft',
       summary = EXCLUDED.summary,
       timeline = EXCLUDED.timeline,
       severity_history = EXCLUDED.severity_history,
       roles = EXCLUDED.roles,
       tasks = EXCLUDED.tasks,
       approvals = EXCLUDED.approvals,
       notifications = EXCLUDED.notifications,
       integrations = EXCLUDED.integrations,
       mttr_started_at = EXCLUDED.mttr_started_at,
       mttr_resolved_at = EXCLUDED.mttr_resolved_at,
       mttr_seconds = EXCLUDED.mttr_seconds,
       mttr_target_seconds = EXCLUDED.mttr_target_seconds,
       mttr_met = EXCLUDED.mttr_met,
       mttr_basis_severity = EXCLUDED.mttr_basis_severity,
       contributing_factors = EXCLUDED.contributing_factors,
       lessons_learned = EXCLUDED.lessons_learned,
       generated_by = EXCLUDED.generated_by,
       generated_at = EXCLUDED.generated_at,
       content_hash = EXCLUDED.content_hash,
       row_version = respond_incident_pir.row_version + 1,
       updated_at = now()
 WHERE respond_incident_pir.status <> 'signed_off'
RETURNING `+incidentPIRColumns,
		pir.TenantID,
		pir.IncidentID,
		pir.Summary,
		fields.timeline,
		fields.severity,
		fields.roles,
		fields.tasks,
		fields.approvals,
		fields.notifications,
		fields.integrations,
		pir.MTTR.StartedAt,
		pir.MTTR.ResolvedAt,
		pir.MTTR.ActualSeconds,
		pir.MTTR.TargetSeconds,
		pir.MTTR.MetTarget,
		pir.MTTR.BasisSeverity,
		fields.factors,
		fields.lessons,
		pir.GeneratedBy,
		pir.GeneratedAt,
		pir.ContentHash,
	)
	stored, err := scanIncidentPIR(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPIRSignedOff
		}
		return fmt.Errorf("respond: upsert incident PIR: %w", err)
	}
	*pir = *stored
	return nil
}

func (s *Store) CreatePIRActionItems(ctx context.Context, db DBTX, pir *IncidentPIR, items []CreatePIRActionItemInput, createdBy uuid.UUID, createdAt time.Time) error {
	for _, item := range items {
		title := strings.TrimSpace(item.Title)
		if title == "" {
			return fmt.Errorf("PIR action item title is required: %w", ErrValidation)
		}
		status := PIRActionItemOpen
		var owner any
		if item.OwnerID != nil {
			owner = *item.OwnerID
		}
		if _, err := db.Exec(ctx, `
INSERT INTO respond_incident_pir_action_item (
    tenant_id, pir_id, incident_id, title, description, owner_id, status,
    due_at, created_by, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
			pir.TenantID,
			pir.ID,
			pir.IncidentID,
			title,
			strings.TrimSpace(item.Description),
			owner,
			status,
			item.DueAt,
			createdBy,
			createdAt,
		); err != nil {
			return fmt.Errorf("respond: create PIR action item: %w", err)
		}
	}
	return nil
}

func (s *Store) GetIncidentPIR(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID) (*IncidentPIR, error) {
	pir, err := scanIncidentPIR(db.QueryRow(ctx, `SELECT `+incidentPIRColumns+`
FROM respond_incident_pir
WHERE tenant_id = $1 AND incident_id = $2`, tenantID, incidentID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPIRNotFound
		}
		return nil, fmt.Errorf("respond: get incident PIR: %w", err)
	}
	items, err := s.ListPIRActionItems(ctx, db, tenantID, pir.ID)
	if err != nil {
		return nil, err
	}
	pir.ActionItems = items
	return pir, nil
}

func (s *Store) ListPIRActionItems(ctx context.Context, db DBTX, tenantID, pirID uuid.UUID) ([]PIRActionItem, error) {
	rows, err := db.Query(ctx, `
SELECT id, tenant_id, pir_id, incident_id, title, description, owner_id, status,
       due_at, completed_at, created_by, created_at, updated_at
FROM respond_incident_pir_action_item
WHERE tenant_id = $1 AND pir_id = $2
ORDER BY created_at ASC, id ASC`, tenantID, pirID)
	if err != nil {
		return nil, fmt.Errorf("respond: list PIR action items: %w", err)
	}
	defer rows.Close()
	var items []PIRActionItem
	for rows.Next() {
		item, err := scanPIRActionItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read PIR action items: %w", err)
	}
	return items, nil
}

func scanPIRActionItem(row rowScanner) (*PIRActionItem, error) {
	var item PIRActionItem
	var owner uuid.NullUUID
	var status string
	if err := row.Scan(
		&item.ID,
		&item.TenantID,
		&item.PIRID,
		&item.IncidentID,
		&item.Title,
		&item.Description,
		&owner,
		&status,
		&item.DueAt,
		&item.CompletedAt,
		&item.CreatedBy,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("respond: scan PIR action item: %w", err)
	}
	if owner.Valid {
		item.OwnerID = &owner.UUID
	}
	item.Status = PIRActionItemStatus(status)
	return &item, nil
}

func (s *Store) SignOffIncidentPIR(ctx context.Context, db DBTX, tenantID, incidentID, actorID uuid.UUID, signedOffAt time.Time) (*IncidentPIR, error) {
	pir, err := scanIncidentPIR(db.QueryRow(ctx, `
UPDATE respond_incident_pir
   SET status = 'signed_off',
       signed_off_by = $3,
       signed_off_at = $4,
       row_version = row_version + 1,
       updated_at = now()
 WHERE tenant_id = $1
   AND incident_id = $2
   AND status = 'draft'
RETURNING `+incidentPIRColumns, tenantID, incidentID, actorID, signedOffAt))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			existing, getErr := s.GetIncidentPIR(ctx, db, tenantID, incidentID)
			if getErr != nil {
				return nil, getErr
			}
			if existing.Status == PIRStatusSignedOff {
				return nil, ErrPIRSignedOff
			}
		}
		return nil, fmt.Errorf("respond: sign off incident PIR: %w", err)
	}
	items, err := s.ListPIRActionItems(ctx, db, tenantID, pir.ID)
	if err != nil {
		return nil, err
	}
	pir.ActionItems = items
	return pir, nil
}

func (s *Store) UpdatePIRActionItemStatus(ctx context.Context, db DBTX, tenantID, actionItemID uuid.UUID, status PIRActionItemStatus, completedAt *time.Time) (*PIRActionItem, error) {
	item, err := scanPIRActionItem(db.QueryRow(ctx, `
UPDATE respond_incident_pir_action_item
   SET status = $3,
       completed_at = $4,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2
RETURNING id, tenant_id, pir_id, incident_id, title, description, owner_id, status,
          due_at, completed_at, created_by, created_at, updated_at`,
		tenantID, actionItemID, status, completedAt))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPIRActionItemNotFound
		}
		return nil, fmt.Errorf("respond: update PIR action item status: %w", err)
	}
	return item, nil
}

func (s *Service) GeneratePIR(ctx context.Context, tenantID uuid.UUID, in GeneratePIRInput) (*IncidentPIR, error) {
	if !in.Actor.Can(PermRespondUpdate) {
		return nil, ErrUnauthorized
	}
	if in.IncidentID == uuid.Nil || in.Actor.UserID == uuid.Nil {
		return nil, fmt.Errorf("incident_id and actor are required: %w", ErrValidation)
	}
	generatedAt := s.now()
	var pir *IncidentPIR
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		inc, err := s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		timeline, err := s.repo.ListAllTimelineEvents(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		approvals, err := s.repo.ListIncidentApprovals(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		pir, err = AssembleIncidentPIR(inc, timeline, approvals, in.ActionItems, in.ContributingFactors, in.LessonsLearned, in.Actor.UserID, generatedAt)
		if err != nil {
			return err
		}
		if err := s.repo.UpsertIncidentPIR(ctx, tx, pir); err != nil {
			return err
		}
		if err := s.repo.CreatePIRActionItems(ctx, tx, pir, in.ActionItems, in.Actor.UserID, generatedAt); err != nil {
			return err
		}
		pir.ActionItems, err = s.repo.ListPIRActionItems(ctx, tx, tenantID, pir.ID)
		if err != nil {
			return err
		}
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: in.IncidentID,
			ActorID:    in.Actor.UserID,
			OccurredAt: generatedAt,
			EventType:  EventPIRGenerated,
			Payload: map[string]any{
				"pir_id":               pir.ID.String(),
				"content_hash":         pir.ContentHash,
				"timeline_event_count": len(pir.Timeline),
				"approval_count":       len(pir.Approvals),
				"notification_count":   len(pir.Notifications),
				"integration_count":    len(pir.Integrations),
				"action_item_count":    len(pir.ActionItems),
				"mttr_actual_seconds":  pir.MTTR.ActualSeconds,
				"mttr_target_seconds":  pir.MTTR.TargetSeconds,
				"mttr_met_target":      pir.MTTR.MetTarget,
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("incident_id", in.IncidentID.String()).Str("pir_id", pir.ID.String()).Msg("respond PIR generated")
	return pir, nil
}

func (s *Service) GetPIR(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (*IncidentPIR, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var pir *IncidentPIR
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		pir, err = s.repo.GetIncidentPIR(ctx, tx, tenantID, incidentID)
		return err
	})
	return pir, err
}

func (s *Service) SignOffPIR(ctx context.Context, tenantID uuid.UUID, in SignOffPIRInput) (*IncidentPIR, error) {
	if in.Actor.UserID == uuid.Nil {
		return nil, ErrUnauthorized
	}
	if !actorCanSignOffPIR(in.Actor) {
		return nil, ErrUnauthorized
	}
	signedOffAt := s.now()
	var pir *IncidentPIR
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		pir, err = s.repo.SignOffIncidentPIR(ctx, tx, tenantID, in.IncidentID, in.Actor.UserID, signedOffAt)
		if err != nil {
			return err
		}
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: in.IncidentID,
			ActorID:    in.Actor.UserID,
			OccurredAt: signedOffAt,
			EventType:  EventPIRSignedOff,
			Payload: map[string]any{
				"pir_id":        pir.ID.String(),
				"content_hash":  pir.ContentHash,
				"signed_off_by": in.Actor.UserID.String(),
				"signed_off_at": signedOffAt.UTC().Format(time.RFC3339),
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("incident_id", in.IncidentID.String()).Str("pir_id", pir.ID.String()).Msg("respond PIR signed off")
	return pir, nil
}

func (s *Service) UpdatePIRActionItemStatus(ctx context.Context, tenantID uuid.UUID, in UpdatePIRActionItemInput) (*PIRActionItem, error) {
	if !in.Actor.Can(PermRespondUpdate) {
		return nil, ErrUnauthorized
	}
	if in.ActionItemID == uuid.Nil || !in.Status.valid() {
		return nil, fmt.Errorf("action item id and valid status are required: %w", ErrValidation)
	}
	var completedAt *time.Time
	if in.Status == PIRActionItemClosed || in.Status == PIRActionItemCancelled {
		now := s.now()
		completedAt = &now
	}
	var item *PIRActionItem
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		item, err = s.repo.UpdatePIRActionItemStatus(ctx, tx, tenantID, in.ActionItemID, in.Status, completedAt)
		if err != nil {
			return err
		}
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: item.IncidentID,
			ActorID:    in.Actor.UserID,
			OccurredAt: s.now(),
			EventType:  EventPIRActionItemUpdated,
			Payload: map[string]any{
				"action_item_id": item.ID.String(),
				"pir_id":         item.PIRID.String(),
				"status":         item.Status,
				"completed_at":   timePtrRFC3339(item.CompletedAt),
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	return item, nil
}

func (s *Service) RequirePIRClosureReady(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) error {
	if !actor.Can(PermRespondTransition) {
		return ErrUnauthorized
	}
	return s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		pir, err := s.repo.GetIncidentPIR(ctx, tx, tenantID, incidentID)
		if err != nil {
			if errors.Is(err, ErrPIRNotFound) {
				return ErrPIRNotComplete
			}
			return err
		}
		if pir.Status != PIRStatusSignedOff || pir.SignedOffBy == nil || pir.SignedOffAt == nil {
			return ErrPIRNotComplete
		}
		return nil
	})
}

func (s *Service) TransitionIncidentWithClosureGate(ctx context.Context, tenantID uuid.UUID, in TransitionIncidentInput) (*Incident, error) {
	if in.To == StatusClosed {
		if err := s.RequirePIRClosureReady(ctx, tenantID, in.IncidentID, in.Actor); err != nil {
			return nil, err
		}
	}
	return s.TransitionIncident(ctx, tenantID, in)
}

func AssembleIncidentPIR(inc *Incident, timeline []TimelineEvent, approvals []IncidentApproval, actionInputs []CreatePIRActionItemInput, factors, lessons []string, generatedBy uuid.UUID, generatedAt time.Time) (*IncidentPIR, error) {
	if inc == nil {
		return nil, fmt.Errorf("incident is required: %w", ErrValidation)
	}
	if inc.Status != StatusResolved && inc.Status != StatusClosed {
		return nil, ErrPIRIncidentNotResolved
	}
	if inc.ResolvedAt == nil {
		return nil, ErrPIRIncidentNotResolved
	}
	if len(timeline) == 0 {
		return nil, fmt.Errorf("PIR requires persisted timeline events: %w", ErrValidation)
	}
	pir := &IncidentPIR{
		TenantID:            inc.TenantID,
		IncidentID:          inc.ID,
		Status:              PIRStatusDraft,
		Summary:             buildPIRSummary(inc, len(timeline), len(approvals)),
		Timeline:            buildPIRTimeline(timeline),
		SeverityHistory:     buildPIRSeverityHistory(inc, timeline),
		Roles:               buildPIRRoles(timeline),
		Tasks:               buildPIRTasks(timeline),
		Approvals:           buildPIRApprovals(approvals),
		Notifications:       buildPIRNotifications(timeline),
		Integrations:        buildPIRIntegrations(timeline),
		MTTR:                buildPIRMTTR(inc, timeline),
		ContributingFactors: normalizeTextList(factors),
		LessonsLearned:      normalizeTextList(lessons),
		ActionItems:         actionItemsForHash(inc, actionInputs, generatedBy),
		GeneratedBy:         generatedBy,
		GeneratedAt:         generatedAt,
	}
	if len(pir.SeverityHistory) == 0 {
		return nil, fmt.Errorf("PIR severity history is empty: %w", ErrValidation)
	}
	pir.ContentHash = PIRContentHash(pir)
	return pir, nil
}

func buildPIRSummary(inc *Incident, timelineCount, approvalCount int) string {
	start := inc.DeclaredAt
	if inc.DetectedAt != nil {
		start = *inc.DetectedAt
	}
	resolved := "unresolved"
	if inc.ResolvedAt != nil {
		resolved = inc.ResolvedAt.UTC().Format(time.RFC3339)
	}
	return fmt.Sprintf("%s (%s) resolved incident %q at severity %s with status %s. Impact: %s. Incident clock started %s and resolved %s. PIR includes %d timeline events and %d approval records.",
		inc.Reference,
		inc.ID.String(),
		inc.Title,
		inc.Severity,
		inc.Status,
		stakeholderImpactSummary(inc.Description, inc.ImpactedServices),
		start.UTC().Format(time.RFC3339),
		resolved,
		timelineCount,
		approvalCount,
	)
}

func buildPIRTimeline(events []TimelineEvent) []PIRTimelineEntry {
	out := make([]PIRTimelineEntry, 0, len(events))
	for _, ev := range events {
		out = append(out, PIRTimelineEntry{
			EventID:    ev.ID,
			OccurredAt: ev.OccurredAt,
			EventType:  ev.EventType,
			ActorID:    ev.ActorID,
			Summary:    summarizeEvent(ev),
			Payload:    clonePayload(ev.Payload),
		})
	}
	return out
}

func buildPIRSeverityHistory(inc *Incident, events []TimelineEvent) []PIRSeverityChange {
	var out []PIRSeverityChange
	for _, ev := range events {
		switch ev.EventType {
		case EventIncidentDeclared:
			sev := severityFromAny(ev.Payload["severity"])
			if !sev.Valid() {
				sev = inc.Severity
			}
			out = append(out, PIRSeverityChange{OccurredAt: ev.OccurredAt, ActorID: ev.ActorID, To: sev, Source: ev.EventType})
		case EventSeverityChanged:
			sev := severityFromAny(ev.Payload["to"])
			if !sev.Valid() {
				continue
			}
			out = append(out, PIRSeverityChange{OccurredAt: ev.OccurredAt, ActorID: ev.ActorID, From: fmt.Sprint(ev.Payload["from"]), To: sev, Source: ev.EventType})
		}
	}
	if len(out) == 0 {
		out = append(out, PIRSeverityChange{OccurredAt: inc.DeclaredAt, ActorID: inc.DeclaredBy, To: inc.Severity, Source: "incident.severity"})
	}
	return out
}

func buildPIRRoles(events []TimelineEvent) []PIRRoleRecord {
	var out []PIRRoleRecord
	for _, ev := range events {
		if !strings.Contains(ev.EventType, "role") {
			continue
		}
		role := firstPayloadString(ev.Payload, "role", "incident_role")
		userID := firstPayloadString(ev.Payload, "user_id", "assignee_id", "assigned_to")
		if role == "" && userID == "" {
			continue
		}
		out = append(out, PIRRoleRecord{OccurredAt: ev.OccurredAt, ActorID: ev.ActorID, Role: role, UserID: userID, EventType: ev.EventType})
	}
	return out
}

func buildPIRTasks(events []TimelineEvent) []PIRTaskRecord {
	var out []PIRTaskRecord
	for _, ev := range events {
		if !strings.Contains(ev.EventType, "task") {
			continue
		}
		title := firstPayloadString(ev.Payload, "title", "name", "summary")
		if title == "" {
			title = ev.EventType
		}
		out = append(out, PIRTaskRecord{
			OccurredAt:      ev.OccurredAt,
			TaskID:          firstPayloadString(ev.Payload, "task_id", "id"),
			Title:           title,
			Status:          firstPayloadString(ev.Payload, "status", "state"),
			OwnerID:         firstPayloadString(ev.Payload, "owner_id", "assignee_id", "assigned_to"),
			DurationSeconds: firstPayloadInt(ev.Payload, "duration_seconds", "duration_sec"),
			SourceEventType: ev.EventType,
		})
	}
	return out
}

func buildPIRApprovals(approvals []IncidentApproval) []PIRApprovalRecord {
	out := make([]PIRApprovalRecord, 0, len(approvals))
	for _, approval := range approvals {
		decidedBy := ""
		if approval.DecidedBy != nil {
			decidedBy = approval.DecidedBy.String()
		}
		out = append(out, PIRApprovalRecord{
			ApprovalID:     approval.ID,
			Action:         approval.Action,
			ActionKey:      approval.ActionKey,
			RequestedBy:    approval.RequestedBy,
			RequestedAt:    approval.RequestedAt,
			RequiredRole:   approvalRequiredRoleString(approval.RequiredRole),
			Decision:       approval.Decision,
			DecidedBy:      decidedBy,
			DecidedAt:      approval.DecidedAt,
			WorkflowSystem: approval.WorkflowRef.System,
			WorkflowTaskID: approval.WorkflowRef.TaskID,
		})
	}
	return out
}

func buildPIRNotifications(events []TimelineEvent) []PIRNotificationRecord {
	var out []PIRNotificationRecord
	for _, ev := range events {
		if !strings.Contains(ev.EventType, "notification") && !strings.Contains(ev.EventType, "stakeholder_update") {
			continue
		}
		out = append(out, PIRNotificationRecord{
			OccurredAt: ev.OccurredAt,
			EventType:  ev.EventType,
			ActorID:    ev.ActorID,
			Channel:    firstPayloadString(ev.Payload, "channel"),
			Recipient:  firstPayloadString(ev.Payload, "recipient_ref", "recipient", "user_id"),
			Subject:    firstPayloadString(ev.Payload, "subject", "title"),
			Status:     firstPayloadString(ev.Payload, "status", "delivery_status"),
		})
	}
	return out
}

func buildPIRIntegrations(events []TimelineEvent) []PIRIntegrationRecord {
	var out []PIRIntegrationRecord
	for _, ev := range events {
		if !strings.Contains(ev.EventType, "integration") {
			continue
		}
		out = append(out, PIRIntegrationRecord{
			OccurredAt:     ev.OccurredAt,
			EventType:      ev.EventType,
			ActorID:        ev.ActorID,
			System:         firstPayloadString(ev.Payload, "external_system", "system", "provider"),
			ExternalID:     firstPayloadString(ev.Payload, "external_id", "ticket_id", "external_key"),
			ExternalStatus: firstPayloadString(ev.Payload, "external_status", "status"),
		})
	}
	return out
}

func buildPIRMTTR(inc *Incident, events []TimelineEvent) PIRMTTR {
	start := inc.DeclaredAt
	if inc.DetectedAt != nil {
		start = *inc.DetectedAt
	}
	resolved := *inc.ResolvedAt
	basis := highestSeverity(inc.Severity, buildPIRSeverityHistory(inc, events))
	target := mttrTargetForSeverity(basis)
	actual := int(resolved.Sub(start).Seconds())
	if actual < 0 {
		actual = 0
	}
	return PIRMTTR{
		StartedAt:     start,
		ResolvedAt:    resolved,
		ActualSeconds: actual,
		TargetSeconds: int(target.Seconds()),
		MetTarget:     time.Duration(actual)*time.Second <= target,
		BasisSeverity: basis,
	}
}

func PIRContentHash(pir *IncidentPIR) string {
	type actionItemHash struct {
		Title       string     `json:"title"`
		Description string     `json:"description"`
		OwnerID     string     `json:"owner_id,omitempty"`
		DueAt       *time.Time `json:"due_at,omitempty"`
	}
	items := make([]actionItemHash, 0, len(pir.ActionItems))
	for _, item := range pir.ActionItems {
		owner := ""
		if item.OwnerID != nil {
			owner = item.OwnerID.String()
		}
		items = append(items, actionItemHash{Title: item.Title, Description: item.Description, OwnerID: owner, DueAt: item.DueAt})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Title == items[j].Title {
			return items[i].OwnerID < items[j].OwnerID
		}
		return items[i].Title < items[j].Title
	})
	payload := struct {
		IncidentID          uuid.UUID               `json:"incident_id"`
		Summary             string                  `json:"summary"`
		Timeline            []PIRTimelineEntry      `json:"timeline"`
		SeverityHistory     []PIRSeverityChange     `json:"severity_history"`
		Roles               []PIRRoleRecord         `json:"roles"`
		Tasks               []PIRTaskRecord         `json:"tasks"`
		Approvals           []PIRApprovalRecord     `json:"approvals"`
		Notifications       []PIRNotificationRecord `json:"notifications"`
		Integrations        []PIRIntegrationRecord  `json:"integrations"`
		MTTR                PIRMTTR                 `json:"mttr"`
		ContributingFactors []string                `json:"contributing_factors"`
		LessonsLearned      []string                `json:"lessons_learned"`
		ActionItems         []actionItemHash        `json:"action_items"`
	}{
		IncidentID:          pir.IncidentID,
		Summary:             pir.Summary,
		Timeline:            pir.Timeline,
		SeverityHistory:     pir.SeverityHistory,
		Roles:               pir.Roles,
		Tasks:               pir.Tasks,
		Approvals:           pir.Approvals,
		Notifications:       pir.Notifications,
		Integrations:        pir.Integrations,
		MTTR:                pir.MTTR,
		ContributingFactors: pir.ContributingFactors,
		LessonsLearned:      pir.LessonsLearned,
		ActionItems:         items,
	}
	rendered, _ := json.Marshal(payload)
	sum := sha256.Sum256(rendered)
	return hex.EncodeToString(sum[:])
}

type pirJSONBundle struct {
	timeline      []byte
	severity      []byte
	roles         []byte
	tasks         []byte
	approvals     []byte
	notifications []byte
	integrations  []byte
	factors       []byte
	lessons       []byte
}

func pirJSONFields(pir *IncidentPIR) (pirJSONBundle, error) {
	var out pirJSONBundle
	fields := []struct {
		name string
		src  any
		dest *[]byte
	}{
		{"timeline", pir.Timeline, &out.timeline},
		{"severity", pir.SeverityHistory, &out.severity},
		{"roles", pir.Roles, &out.roles},
		{"tasks", pir.Tasks, &out.tasks},
		{"approvals", pir.Approvals, &out.approvals},
		{"notifications", pir.Notifications, &out.notifications},
		{"integrations", pir.Integrations, &out.integrations},
		{"contributing factors", pir.ContributingFactors, &out.factors},
		{"lessons learned", pir.LessonsLearned, &out.lessons},
	}
	for _, field := range fields {
		rendered, err := json.Marshal(field.src)
		if err != nil {
			return out, fmt.Errorf("respond: marshal PIR %s: %w", field.name, err)
		}
		*field.dest = rendered
	}
	return out, nil
}

func actionItemsForHash(inc *Incident, inputs []CreatePIRActionItemInput, createdBy uuid.UUID) []PIRActionItem {
	out := make([]PIRActionItem, 0, len(inputs))
	for _, input := range inputs {
		title := strings.TrimSpace(input.Title)
		if title == "" {
			continue
		}
		out = append(out, PIRActionItem{
			TenantID:    inc.TenantID,
			IncidentID:  inc.ID,
			Title:       title,
			Description: strings.TrimSpace(input.Description),
			OwnerID:     input.OwnerID,
			Status:      PIRActionItemOpen,
			DueAt:       input.DueAt,
			CreatedBy:   createdBy,
		})
	}
	return out
}

func actorCanSignOffPIR(actor Actor) bool {
	if actor.Can(PermRespondAdmin) {
		return true
	}
	for _, role := range actor.IncidentRoles {
		if role == RoleCommander {
			return true
		}
	}
	return false
}

func normalizeTextList(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, value := range in {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func clonePayload(payload map[string]any) map[string]any {
	if len(payload) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(payload))
	for k, v := range payload {
		out[k] = v
	}
	return out
}

func severityFromAny(value any) Severity {
	switch v := value.(type) {
	case Severity:
		return v
	case string:
		return Severity(v)
	default:
		return Severity(fmt.Sprint(v))
	}
}

func firstPayloadString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func firstPayloadInt(payload map[string]any, keys ...string) int {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		switch v := value.(type) {
		case int:
			return v
		case int64:
			return int(v)
		case float64:
			return int(v)
		case json.Number:
			n, _ := v.Int64()
			return int(n)
		case string:
			n, err := strconv.Atoi(strings.TrimSpace(v))
			if err == nil {
				return n
			}
		}
	}
	return 0
}

func highestSeverity(current Severity, history []PIRSeverityChange) Severity {
	highest := current
	for _, change := range history {
		if pirSeverityRank(change.To) < pirSeverityRank(highest) {
			highest = change.To
		}
	}
	return highest
}

func pirSeverityRank(sev Severity) int {
	switch sev {
	case SeveritySEV1:
		return 1
	case SeveritySEV2:
		return 2
	case SeveritySEV3:
		return 3
	default:
		return 4
	}
}

func mttrTargetForSeverity(sev Severity) time.Duration {
	switch sev {
	case SeveritySEV1:
		return 4 * time.Hour
	case SeveritySEV2:
		return 8 * time.Hour
	case SeveritySEV3:
		return 24 * time.Hour
	default:
		return 72 * time.Hour
	}
}
