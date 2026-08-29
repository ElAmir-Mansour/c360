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
	ErrInvalidIncidentRole        = errors.New("invalid respond incident role")
	ErrRoleAssignmentNotFound     = errors.New("respond role assignment not found")
	ErrCommanderAlreadyAssigned   = errors.New("respond incident already has an active commander")
	ErrRoleAssignmentConflict     = errors.New("respond role assignment conflict")
	ErrRoleAssignmentInactive     = errors.New("respond role assignment is not active")
	ErrRoleAssignmentActorMissing = errors.New("respond role assignment actor is required")
)

var validIncidentRoles = map[IncidentRole]struct{}{
	RoleCommander:           {},
	RoleCommunicationsLead:  {},
	RoleTechnicalLead:       {},
	RoleSubjectMatterExpert: {},
	RoleScribe:              {},
	RoleStakeholderLiaison:  {},
	RoleResolver:            {},
}

func (r IncidentRole) Valid() bool {
	if _, ok := validIncidentRoles[r]; ok {
		return true
	}
	return strings.TrimSpace(string(r)) != ""
}

type RoleAssignmentStatus string

const (
	RoleAssignmentActive   RoleAssignmentStatus = "active"
	RoleAssignmentReleased RoleAssignmentStatus = "released"
)

type RoleHistoryAction string

const (
	RoleHistoryAssigned   RoleHistoryAction = "assigned"
	RoleHistoryReleased   RoleHistoryAction = "released"
	RoleHistoryReassigned RoleHistoryAction = "reassigned"
)

type RoleAssignment struct {
	ID            uuid.UUID            `json:"id"`
	TenantID      uuid.UUID            `json:"tenant_id"`
	IncidentID    uuid.UUID            `json:"incident_id"`
	Role          IncidentRole         `json:"role"`
	ResponderID   uuid.UUID            `json:"responder_id"`
	AssignedBy    uuid.UUID            `json:"assigned_by"`
	AssignedAt    time.Time            `json:"assigned_at"`
	ReleasedBy    *uuid.UUID           `json:"released_by,omitempty"`
	ReleasedAt    *time.Time           `json:"released_at,omitempty"`
	ReleaseReason string               `json:"release_reason,omitempty"`
	Status        RoleAssignmentStatus `json:"status"`
	Source        string               `json:"source"`
	Metadata      map[string]any       `json:"metadata,omitempty"`
	RowVersion    int                  `json:"row_version"`
	CreatedAt     time.Time            `json:"created_at"`
	UpdatedAt     time.Time            `json:"updated_at"`
}

type RoleHistoryEntry struct {
	ID           uuid.UUID         `json:"id"`
	TenantID     uuid.UUID         `json:"tenant_id"`
	IncidentID   uuid.UUID         `json:"incident_id"`
	AssignmentID uuid.UUID         `json:"assignment_id"`
	Role         IncidentRole      `json:"role"`
	ResponderID  uuid.UUID         `json:"responder_id"`
	ActorID      uuid.UUID         `json:"actor_id"`
	Action       RoleHistoryAction `json:"action"`
	OccurredAt   time.Time         `json:"occurred_at"`
	Metadata     map[string]any    `json:"metadata,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
}

type AssignRoleInput struct {
	TenantID    uuid.UUID
	IncidentID  uuid.UUID
	Role        IncidentRole
	ResponderID uuid.UUID
	AssignedBy  uuid.UUID
	AssignedAt  time.Time
	Source      string
	Metadata    map[string]any
}

func (in *AssignRoleInput) normalize() error {
	in.Source = strings.TrimSpace(in.Source)
	if in.Source == "" {
		in.Source = "manual"
	}
	if in.AssignedAt.IsZero() {
		in.AssignedAt = time.Now().UTC()
	}
	if in.TenantID == uuid.Nil || in.IncidentID == uuid.Nil || in.ResponderID == uuid.Nil {
		return fmt.Errorf("tenant_id, incident_id, and responder_id are required: %w", ErrValidation)
	}
	if in.AssignedBy == uuid.Nil {
		return ErrRoleAssignmentActorMissing
	}
	if !in.Role.Valid() {
		return ErrInvalidIncidentRole
	}
	return nil
}

type ReleaseRoleInput struct {
	TenantID      uuid.UUID
	IncidentID    uuid.UUID
	AssignmentID  uuid.UUID
	ReleasedBy    uuid.UUID
	ReleasedAt    time.Time
	ReleaseReason string
	Metadata      map[string]any
}

func (in *ReleaseRoleInput) normalize() error {
	in.ReleaseReason = strings.TrimSpace(in.ReleaseReason)
	if in.ReleasedAt.IsZero() {
		in.ReleasedAt = time.Now().UTC()
	}
	if in.TenantID == uuid.Nil || in.IncidentID == uuid.Nil || in.AssignmentID == uuid.Nil {
		return fmt.Errorf("tenant_id, incident_id, and assignment_id are required: %w", ErrValidation)
	}
	if in.ReleasedBy == uuid.Nil {
		return ErrRoleAssignmentActorMissing
	}
	return nil
}

const roleAssignmentColumns = `id, tenant_id, incident_id, role, responder_id, assigned_by, assigned_at,
released_by, released_at, release_reason, status, source, metadata, row_version, created_at, updated_at`

func scanRoleAssignment(row rowScanner) (*RoleAssignment, error) {
	var assignment RoleAssignment
	var role, status string
	var metadataJSON []byte
	if err := row.Scan(
		&assignment.ID,
		&assignment.TenantID,
		&assignment.IncidentID,
		&role,
		&assignment.ResponderID,
		&assignment.AssignedBy,
		&assignment.AssignedAt,
		&assignment.ReleasedBy,
		&assignment.ReleasedAt,
		&assignment.ReleaseReason,
		&status,
		&assignment.Source,
		&metadataJSON,
		&assignment.RowVersion,
		&assignment.CreatedAt,
		&assignment.UpdatedAt,
	); err != nil {
		return nil, err
	}
	assignment.Role = IncidentRole(role)
	assignment.Status = RoleAssignmentStatus(status)
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &assignment.Metadata); err != nil {
			return nil, fmt.Errorf("respond: unmarshal role assignment metadata: %w", err)
		}
	}
	if assignment.Metadata == nil {
		assignment.Metadata = map[string]any{}
	}
	return &assignment, nil
}

const roleHistoryColumns = `id, tenant_id, incident_id, assignment_id, role, responder_id, actor_id,
action, occurred_at, metadata, created_at`

func scanRoleHistory(row rowScanner) (*RoleHistoryEntry, error) {
	var entry RoleHistoryEntry
	var role, action string
	var metadataJSON []byte
	if err := row.Scan(
		&entry.ID,
		&entry.TenantID,
		&entry.IncidentID,
		&entry.AssignmentID,
		&role,
		&entry.ResponderID,
		&entry.ActorID,
		&action,
		&entry.OccurredAt,
		&metadataJSON,
		&entry.CreatedAt,
	); err != nil {
		return nil, err
	}
	entry.Role = IncidentRole(role)
	entry.Action = RoleHistoryAction(action)
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &entry.Metadata); err != nil {
			return nil, fmt.Errorf("respond: unmarshal role history metadata: %w", err)
		}
	}
	if entry.Metadata == nil {
		entry.Metadata = map[string]any{}
	}
	return &entry, nil
}

func (s *Store) AssignIncidentRole(ctx context.Context, db DBTX, in AssignRoleInput) (*RoleAssignment, error) {
	if err := in.normalize(); err != nil {
		return nil, err
	}
	metadataJSON, err := json.Marshal(in.Metadata)
	if err != nil {
		return nil, fmt.Errorf("respond: marshal role assignment metadata: %w", err)
	}
	if in.Metadata == nil {
		metadataJSON = []byte(`{}`)
	}

	assignment, err := scanRoleAssignment(db.QueryRow(ctx, `
INSERT INTO respond_incident_role_assignment (
    tenant_id, incident_id, role, responder_id, assigned_by, assigned_at, source, metadata
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING `+roleAssignmentColumns,
		in.TenantID, in.IncidentID, in.Role, in.ResponderID, in.AssignedBy, in.AssignedAt, in.Source, metadataJSON,
	))
	if err != nil {
		return nil, mapRoleAssignmentInsertError(err)
	}
	if err := s.appendRoleHistory(ctx, db, assignment, in.AssignedBy, RoleHistoryAssigned, in.AssignedAt, in.Metadata); err != nil {
		return nil, err
	}
	return assignment, nil
}

func (s *Store) ReleaseIncidentRole(ctx context.Context, db DBTX, in ReleaseRoleInput) (*RoleAssignment, error) {
	if err := in.normalize(); err != nil {
		return nil, err
	}

	assignment, err := scanRoleAssignment(db.QueryRow(ctx, `
UPDATE respond_incident_role_assignment
   SET released_by = $4,
       released_at = $5,
       release_reason = $6,
       status = $7,
       row_version = row_version + 1,
       updated_at = now()
 WHERE tenant_id = $1
   AND incident_id = $2
   AND id = $3
   AND status = $8
RETURNING `+roleAssignmentColumns,
		in.TenantID, in.IncidentID, in.AssignmentID, in.ReleasedBy, in.ReleasedAt,
		in.ReleaseReason, RoleAssignmentReleased, RoleAssignmentActive,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoleAssignmentInactive
		}
		return nil, fmt.Errorf("respond: release role assignment %s: %w", in.AssignmentID, err)
	}
	if err := s.appendRoleHistory(ctx, db, assignment, in.ReleasedBy, RoleHistoryReleased, in.ReleasedAt, in.Metadata); err != nil {
		return nil, err
	}
	return assignment, nil
}

func (s *Store) ListActiveRoleAssignments(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID) ([]RoleAssignment, error) {
	rows, err := db.Query(ctx, `SELECT `+roleAssignmentColumns+`
FROM respond_incident_role_assignment
WHERE tenant_id = $1 AND incident_id = $2 AND status = $3
ORDER BY assigned_at ASC, id ASC`, tenantID, incidentID, RoleAssignmentActive)
	if err != nil {
		return nil, fmt.Errorf("respond: list active role assignments: %w", err)
	}
	defer rows.Close()

	var out []RoleAssignment
	for rows.Next() {
		assignment, err := scanRoleAssignment(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan role assignment: %w", err)
		}
		out = append(out, *assignment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read role assignments: %w", err)
	}
	return out, nil
}

func (s *Store) GetIncidentRoleAssignment(ctx context.Context, db DBTX, tenantID, incidentID, assignmentID uuid.UUID) (*RoleAssignment, error) {
	assignment, err := scanRoleAssignment(db.QueryRow(ctx, `SELECT `+roleAssignmentColumns+`
FROM respond_incident_role_assignment
WHERE tenant_id = $1 AND incident_id = $2 AND id = $3`, tenantID, incidentID, assignmentID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoleAssignmentNotFound
		}
		return nil, fmt.Errorf("respond: get role assignment %s: %w", assignmentID, err)
	}
	return assignment, nil
}

func (s *Store) ListRoleHistory(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, limit int) ([]RoleHistoryEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := db.Query(ctx, `SELECT `+roleHistoryColumns+`
FROM respond_incident_role_history
WHERE tenant_id = $1 AND incident_id = $2
ORDER BY occurred_at ASC, id ASC
LIMIT $3`, tenantID, incidentID, limit)
	if err != nil {
		return nil, fmt.Errorf("respond: list role history: %w", err)
	}
	defer rows.Close()

	var out []RoleHistoryEntry
	for rows.Next() {
		entry, err := scanRoleHistory(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan role history: %w", err)
		}
		out = append(out, *entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read role history: %w", err)
	}
	return out, nil
}

func (s *Store) appendRoleHistory(ctx context.Context, db DBTX, assignment *RoleAssignment, actorID uuid.UUID, action RoleHistoryAction, occurredAt time.Time, metadata map[string]any) error {
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("respond: marshal role history metadata: %w", err)
	}
	if metadata == nil {
		metadataJSON = []byte(`{}`)
	}
	_, err = db.Exec(ctx, `
INSERT INTO respond_incident_role_history (
    tenant_id, incident_id, assignment_id, role, responder_id, actor_id, action, occurred_at, metadata
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		assignment.TenantID,
		assignment.IncidentID,
		assignment.ID,
		assignment.Role,
		assignment.ResponderID,
		actorID,
		action,
		occurredAt,
		metadataJSON,
	)
	if err != nil {
		return fmt.Errorf("respond: append role history: %w", err)
	}
	return nil
}

func mapRoleAssignmentInsertError(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return fmt.Errorf("respond: assign incident role: %w", err)
	}
	if pgErr.Code == "23505" {
		switch pgErr.ConstraintName {
		case "idx_respond_role_one_active_commander":
			return ErrCommanderAlreadyAssigned
		case "idx_respond_role_unique_active_responder":
			return ErrRoleAssignmentConflict
		default:
			return fmt.Errorf("%w: %s", ErrRoleAssignmentConflict, pgErr.ConstraintName)
		}
	}
	return fmt.Errorf("respond: assign incident role: %w", err)
}
