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
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrApprovalRequired       = errors.New("respond approval is required")
	ErrApprovalNotFound       = errors.New("respond approval not found")
	ErrApprovalAlreadyPending = errors.New("respond approval is already pending for this action")
	ErrApprovalAlreadyDecided = errors.New("respond approval is already decided")
	ErrApprovalSelfDecision   = errors.New("respond requester cannot approve their own gated action")
	ErrInvalidApproval        = errors.New("respond approval decision is invalid")
)

const (
	EventApprovalRequested = "respond.approval.requested"
	EventApprovalDecided   = "respond.approval.decided"
)

type ApprovalAction string

const (
	ApprovalActionAuthorizeFailover          ApprovalAction = "authorize_failover"
	ApprovalActionDeclareMajorBusinessImpact ApprovalAction = "declare_major_business_impact"
	ApprovalActionCloseIncident              ApprovalAction = "close_incident"
)

func (a ApprovalAction) Valid() bool {
	switch a {
	case ApprovalActionAuthorizeFailover, ApprovalActionDeclareMajorBusinessImpact, ApprovalActionCloseIncident:
		return true
	default:
		return strings.TrimSpace(string(a)) != ""
	}
}

type ApprovalDecision string

const (
	ApprovalDecisionPending   ApprovalDecision = "pending"
	ApprovalDecisionApproved  ApprovalDecision = "approved"
	ApprovalDecisionRejected  ApprovalDecision = "rejected"
	ApprovalDecisionCancelled ApprovalDecision = "cancelled"
)

func (d ApprovalDecision) final() bool {
	switch d {
	case ApprovalDecisionApproved, ApprovalDecisionRejected, ApprovalDecisionCancelled:
		return true
	default:
		return false
	}
}

type WorkflowApprovalRef struct {
	System     string `json:"system,omitempty"`
	InstanceID string `json:"instance_id,omitempty"`
	TaskID     string `json:"task_id,omitempty"`
}

// ApprovalWorkflowGateway is the composition seam for the platform workflow
// engine approval_chain executor. Respond persists and enforces the incident
// gate locally; implementations can start or link the human workflow and return
// the workflow instance/task identifiers stored on IncidentApproval.
type ApprovalWorkflowGateway interface {
	RequestIncidentApproval(ctx context.Context, req ApprovalWorkflowRequest) (WorkflowApprovalRef, error)
}

type ApprovalWorkflowRequest struct {
	TenantID     uuid.UUID
	IncidentID   uuid.UUID
	Action       ApprovalAction
	ActionKey    string
	RequestedBy  uuid.UUID
	RequiredRole *IncidentRole
	Metadata     map[string]any
}

type IncidentApproval struct {
	ID             uuid.UUID           `json:"id"`
	TenantID       uuid.UUID           `json:"tenant_id"`
	IncidentID     uuid.UUID           `json:"incident_id"`
	Action         ApprovalAction      `json:"action"`
	ActionKey      string              `json:"action_key"`
	RequestedBy    uuid.UUID           `json:"requested_by"`
	RequestedAt    time.Time           `json:"requested_at"`
	RequiredRole   *IncidentRole       `json:"required_role,omitempty"`
	Decision       ApprovalDecision    `json:"decision"`
	DecidedBy      *uuid.UUID          `json:"decided_by,omitempty"`
	DecidedAt      *time.Time          `json:"decided_at,omitempty"`
	DecisionReason string              `json:"decision_reason,omitempty"`
	WorkflowRef    WorkflowApprovalRef `json:"workflow_ref,omitempty"`
	Metadata       map[string]any      `json:"metadata,omitempty"`
	CreatedAt      time.Time           `json:"created_at"`
	UpdatedAt      time.Time           `json:"updated_at"`
}

type RequestApprovalInput struct {
	IncidentID   uuid.UUID
	Action       ApprovalAction
	ActionKey    string
	RequiredRole *IncidentRole
	WorkflowRef  WorkflowApprovalRef
	Metadata     map[string]any
	Actor        Actor
}

type DecideApprovalInput struct {
	ApprovalID uuid.UUID
	Decision   ApprovalDecision
	Reason     string
	Actor      Actor
}

type RequireApprovedActionInput struct {
	IncidentID uuid.UUID
	Action     ApprovalAction
	ActionKey  string
	Actor      Actor
}

const incidentApprovalColumns = `id, tenant_id, incident_id, action, action_key,
requested_by, requested_at, required_role, decision, decided_by, decided_at,
decision_reason, workflow_system, workflow_instance_id, workflow_task_id,
metadata, created_at, updated_at`

func scanIncidentApproval(row rowScanner) (*IncidentApproval, error) {
	var approval IncidentApproval
	var action, decision string
	var requiredRole *string
	var decidedBy uuid.NullUUID
	var metadataJSON []byte
	if err := row.Scan(
		&approval.ID,
		&approval.TenantID,
		&approval.IncidentID,
		&action,
		&approval.ActionKey,
		&approval.RequestedBy,
		&approval.RequestedAt,
		&requiredRole,
		&decision,
		&decidedBy,
		&approval.DecidedAt,
		&approval.DecisionReason,
		&approval.WorkflowRef.System,
		&approval.WorkflowRef.InstanceID,
		&approval.WorkflowRef.TaskID,
		&metadataJSON,
		&approval.CreatedAt,
		&approval.UpdatedAt,
	); err != nil {
		return nil, err
	}
	approval.Action = ApprovalAction(action)
	approval.Decision = ApprovalDecision(decision)
	if requiredRole != nil {
		role := IncidentRole(*requiredRole)
		approval.RequiredRole = &role
	}
	if decidedBy.Valid {
		approval.DecidedBy = &decidedBy.UUID
	}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &approval.Metadata); err != nil {
			return nil, fmt.Errorf("respond: unmarshal approval metadata: %w", err)
		}
	}
	if approval.Metadata == nil {
		approval.Metadata = map[string]any{}
	}
	return &approval, nil
}

func (s *Store) CreateIncidentApproval(ctx context.Context, db DBTX, approval *IncidentApproval) error {
	metadataJSON, err := json.Marshal(approval.Metadata)
	if err != nil {
		return fmt.Errorf("respond: marshal approval metadata: %w", err)
	}
	var requiredRole any
	if approval.RequiredRole != nil {
		requiredRole = string(*approval.RequiredRole)
	}
	row := db.QueryRow(ctx, `
INSERT INTO respond_incident_approval (
    tenant_id, incident_id, action, action_key, requested_by, requested_at,
    required_role, decision, decision_reason, workflow_system,
    workflow_instance_id, workflow_task_id, metadata
)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', '', $8, $9, $10, $11)
RETURNING `+incidentApprovalColumns,
		approval.TenantID,
		approval.IncidentID,
		approval.Action,
		approval.ActionKey,
		approval.RequestedBy,
		approval.RequestedAt,
		requiredRole,
		approval.WorkflowRef.System,
		approval.WorkflowRef.InstanceID,
		approval.WorkflowRef.TaskID,
		metadataJSON,
	)
	created, err := scanIncidentApproval(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrApprovalAlreadyPending
		}
		return fmt.Errorf("respond: create incident approval: %w", err)
	}
	*approval = *created
	return nil
}

func (s *Store) GetIncidentApproval(ctx context.Context, db DBTX, tenantID, approvalID uuid.UUID) (*IncidentApproval, error) {
	approval, err := scanIncidentApproval(db.QueryRow(ctx, `SELECT `+incidentApprovalColumns+`
FROM respond_incident_approval WHERE tenant_id = $1 AND id = $2`, tenantID, approvalID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrApprovalNotFound
		}
		return nil, fmt.Errorf("respond: get incident approval %s: %w", approvalID, err)
	}
	return approval, nil
}

func (s *Store) DecideIncidentApproval(ctx context.Context, db DBTX, tenantID, approvalID uuid.UUID, decision ApprovalDecision, decidedBy uuid.UUID, decidedAt time.Time, reason string) (*IncidentApproval, error) {
	approval, err := scanIncidentApproval(db.QueryRow(ctx, `
UPDATE respond_incident_approval
   SET decision = $3,
       decided_by = $4,
       decided_at = $5,
       decision_reason = $6,
       updated_at = now()
 WHERE tenant_id = $1
   AND id = $2
   AND decision = 'pending'
RETURNING `+incidentApprovalColumns,
		tenantID, approvalID, decision, decidedBy, decidedAt, strings.TrimSpace(reason)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			existing, getErr := s.GetIncidentApproval(ctx, db, tenantID, approvalID)
			if getErr != nil {
				return nil, getErr
			}
			if existing.Decision != ApprovalDecisionPending {
				return nil, ErrApprovalAlreadyDecided
			}
		}
		return nil, fmt.Errorf("respond: decide incident approval %s: %w", approvalID, err)
	}
	return approval, nil
}

func (s *Store) GetApprovedIncidentApproval(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, action ApprovalAction, actionKey string) (*IncidentApproval, error) {
	approval, err := scanIncidentApproval(db.QueryRow(ctx, `SELECT `+incidentApprovalColumns+`
FROM respond_incident_approval
WHERE tenant_id = $1
  AND incident_id = $2
  AND action = $3
  AND action_key = $4
  AND decision = 'approved'
ORDER BY decided_at DESC, id DESC
LIMIT 1`, tenantID, incidentID, action, normalizeApprovalActionKey(actionKey)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrApprovalRequired
		}
		return nil, fmt.Errorf("respond: get approved incident approval: %w", err)
	}
	return approval, nil
}

func (s *Store) ListIncidentApprovals(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID) ([]IncidentApproval, error) {
	rows, err := db.Query(ctx, `SELECT `+incidentApprovalColumns+`
FROM respond_incident_approval
WHERE tenant_id = $1 AND incident_id = $2
ORDER BY requested_at ASC, id ASC`, tenantID, incidentID)
	if err != nil {
		return nil, fmt.Errorf("respond: list incident approvals: %w", err)
	}
	defer rows.Close()
	var approvals []IncidentApproval
	for rows.Next() {
		approval, err := scanIncidentApproval(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan incident approval: %w", err)
		}
		approvals = append(approvals, *approval)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read incident approvals: %w", err)
	}
	return approvals, nil
}

func (s *Service) RequestApproval(ctx context.Context, tenantID uuid.UUID, in RequestApprovalInput) (*IncidentApproval, error) {
	if !in.Actor.Can(PermRespondUpdate) && !in.Actor.Can(PermRespondTransition) {
		return nil, ErrUnauthorized
	}
	if err := validateApprovalRequest(in); err != nil {
		return nil, err
	}
	approval := &IncidentApproval{
		TenantID:     tenantID,
		IncidentID:   in.IncidentID,
		Action:       in.Action,
		ActionKey:    normalizeApprovalActionKey(in.ActionKey),
		RequestedBy:  in.Actor.UserID,
		RequestedAt:  s.now(),
		RequiredRole: in.RequiredRole,
		WorkflowRef:  normalizeWorkflowApprovalRef(in.WorkflowRef),
		Metadata:     normalizeApprovalMetadata(in.Metadata),
	}
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID); err != nil {
			return err
		}
		if err := s.repo.CreateIncidentApproval(ctx, tx, approval); err != nil {
			return err
		}
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: in.IncidentID,
			ActorID:    in.Actor.UserID,
			OccurredAt: approval.RequestedAt,
			EventType:  EventApprovalRequested,
			Payload: map[string]any{
				"approval_id":          approval.ID.String(),
				"action":               approval.Action,
				"action_key":           approval.ActionKey,
				"requested_by":         approval.RequestedBy.String(),
				"required_role":        approvalRequiredRoleString(approval.RequiredRole),
				"workflow_system":      approval.WorkflowRef.System,
				"workflow_instance_id": approval.WorkflowRef.InstanceID,
				"workflow_task_id":     approval.WorkflowRef.TaskID,
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("incident_id", in.IncidentID.String()).Str("approval_id", approval.ID.String()).Str("action", string(approval.Action)).Msg("respond approval requested")
	return approval, nil
}

func (s *Service) DecideApproval(ctx context.Context, tenantID uuid.UUID, in DecideApprovalInput) (*IncidentApproval, error) {
	if in.Actor.UserID == uuid.Nil {
		return nil, ErrUnauthorized
	}
	if !in.Decision.final() {
		return nil, ErrInvalidApproval
	}
	var approval *IncidentApproval
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		current, err := s.repo.GetIncidentApproval(ctx, tx, tenantID, in.ApprovalID)
		if err != nil {
			return err
		}
		if current.RequestedBy == in.Actor.UserID {
			return ErrApprovalSelfDecision
		}
		if !actorCanDecideApproval(in.Actor, current) {
			return ErrUnauthorized
		}
		decidedAt := s.now()
		approval, err = s.repo.DecideIncidentApproval(ctx, tx, tenantID, in.ApprovalID, in.Decision, in.Actor.UserID, decidedAt, in.Reason)
		if err != nil {
			return err
		}
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: approval.IncidentID,
			ActorID:    in.Actor.UserID,
			OccurredAt: decidedAt,
			EventType:  EventApprovalDecided,
			Payload: map[string]any{
				"approval_id": approval.ID.String(),
				"action":      approval.Action,
				"action_key":  approval.ActionKey,
				"decision":    approval.Decision,
				"decided_by":  in.Actor.UserID.String(),
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("incident_id", approval.IncidentID.String()).Str("approval_id", approval.ID.String()).Str("decision", string(approval.Decision)).Msg("respond approval decided")
	return approval, nil
}

func (s *Service) RequireApprovedAction(ctx context.Context, tenantID uuid.UUID, in RequireApprovedActionInput) (*IncidentApproval, error) {
	if !in.Actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	if !in.Action.Valid() || in.IncidentID == uuid.Nil {
		return nil, fmt.Errorf("incident_id and action are required: %w", ErrValidation)
	}
	var approval *IncidentApproval
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		approval, err = s.repo.GetApprovedIncidentApproval(ctx, tx, tenantID, in.IncidentID, in.Action, in.ActionKey)
		return err
	})
	return approval, err
}

func validateApprovalRequest(in RequestApprovalInput) error {
	if in.IncidentID == uuid.Nil || in.Actor.UserID == uuid.Nil {
		return fmt.Errorf("incident_id and actor are required: %w", ErrValidation)
	}
	if !in.Action.Valid() {
		return fmt.Errorf("approval action is required: %w", ErrValidation)
	}
	return nil
}

func normalizeApprovalActionKey(key string) string {
	return strings.TrimSpace(key)
}

func normalizeWorkflowApprovalRef(ref WorkflowApprovalRef) WorkflowApprovalRef {
	ref.System = strings.TrimSpace(ref.System)
	ref.InstanceID = strings.TrimSpace(ref.InstanceID)
	ref.TaskID = strings.TrimSpace(ref.TaskID)
	return ref
}

func normalizeApprovalMetadata(in map[string]any) map[string]any {
	if len(in) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(in))
	for key, value := range in {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		out[key] = value
	}
	return out
}

func actorCanDecideApproval(actor Actor, approval *IncidentApproval) bool {
	if actor.Can(PermRespondAdmin) {
		return true
	}
	if approval.RequiredRole != nil {
		for _, role := range actor.IncidentRoles {
			if role == *approval.RequiredRole {
				return true
			}
		}
		return false
	}
	for _, role := range actor.IncidentRoles {
		if role == RoleCommander {
			return true
		}
	}
	return false
}

func approvalRequiredRoleString(role *IncidentRole) string {
	if role == nil {
		return ""
	}
	return string(*role)
}
