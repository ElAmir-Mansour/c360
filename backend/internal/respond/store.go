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

type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Store struct{}

func NewStore() *Store { return &Store{} }

type rowScanner interface {
	Scan(dest ...any) error
}

const incidentColumns = `id, tenant_id, reference, title, description, severity, status,
declared_by, declared_at, detected_at, mitigated_at, resolved_at, closed_at,
impacted_services, row_version, created_at, updated_at`

func scanIncident(row rowScanner) (*Incident, error) {
	var inc Incident
	var severity, status string
	var servicesJSON []byte
	if err := row.Scan(
		&inc.ID, &inc.TenantID, &inc.Reference, &inc.Title, &inc.Description,
		&severity, &status, &inc.DeclaredBy, &inc.DeclaredAt, &inc.DetectedAt,
		&inc.MitigatedAt, &inc.ResolvedAt, &inc.ClosedAt, &servicesJSON,
		&inc.RowVersion, &inc.CreatedAt, &inc.UpdatedAt,
	); err != nil {
		return nil, err
	}
	inc.Severity = Severity(severity)
	inc.Status = Status(status)
	if len(servicesJSON) > 0 {
		if err := json.Unmarshal(servicesJSON, &inc.ImpactedServices); err != nil {
			return nil, fmt.Errorf("respond: unmarshal impacted services: %w", err)
		}
	}
	if inc.ImpactedServices == nil {
		inc.ImpactedServices = []string{}
	}
	return &inc, nil
}

func (s *Store) CreateIncident(ctx context.Context, db DBTX, inc *Incident) error {
	servicesJSON, err := json.Marshal(inc.ImpactedServices)
	if err != nil {
		return fmt.Errorf("respond: marshal impacted services: %w", err)
	}
	row := db.QueryRow(ctx, `
WITH next_ref AS (
    INSERT INTO respond_incident_reference_counter (tenant_id, ref_year, last_number)
    VALUES ($1, EXTRACT(YEAR FROM $8::timestamptz)::int, 1)
    ON CONFLICT (tenant_id, ref_year)
    DO UPDATE SET last_number = respond_incident_reference_counter.last_number + 1,
                  updated_at = now()
    RETURNING ref_year, last_number
)
INSERT INTO respond_incident (
    tenant_id, reference, title, description, severity, status, declared_by,
    declared_at, detected_at, impacted_services
)
SELECT $1,
       'INC-' || ref_year::text || '-' || lpad(last_number::text, 4, '0'),
       $2, $3, $4, $5, $6, $8, $7, $9
FROM next_ref
RETURNING `+incidentColumns,
		inc.TenantID, inc.Title, inc.Description, inc.Severity, inc.Status, inc.DeclaredBy,
		inc.DetectedAt, inc.DeclaredAt, servicesJSON)

	created, err := scanIncident(row)
	if err != nil {
		return fmt.Errorf("respond: create incident: %w", err)
	}
	*inc = *created
	return nil
}

func (s *Store) GetIncident(ctx context.Context, db DBTX, tenantID, id uuid.UUID) (*Incident, error) {
	inc, err := scanIncident(db.QueryRow(ctx, `SELECT `+incidentColumns+`
FROM respond_incident WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("incident %s: %w", id, ErrIncidentNotFound)
		}
		return nil, fmt.Errorf("respond: get incident %s: %w", id, err)
	}
	return inc, nil
}

func (s *Store) ListIncidents(ctx context.Context, db DBTX, tenantID uuid.UUID, status *Status, severity *Severity, limit, offset int) ([]*Incident, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args := []any{tenantID}
	where := []string{"tenant_id = $1"}
	if status != nil {
		args = append(args, *status)
		where = append(where, fmt.Sprintf("status = $%d", len(args)))
	}
	if severity != nil {
		args = append(args, *severity)
		where = append(where, fmt.Sprintf("severity = $%d", len(args)))
	}
	args = append(args, limit, offset)
	q := `SELECT ` + incidentColumns + ` FROM respond_incident WHERE ` + strings.Join(where, " AND ") +
		fmt.Sprintf(` ORDER BY declared_at DESC, id DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args))
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("respond: list incidents: %w", err)
	}
	defer rows.Close()

	var out []*Incident
	for rows.Next() {
		inc, serr := scanIncident(rows)
		if serr != nil {
			return nil, fmt.Errorf("respond: scan incident: %w", serr)
		}
		out = append(out, inc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read incidents: %w", err)
	}
	return out, nil
}

func (s *Store) CountIncidents(ctx context.Context, db DBTX, tenantID uuid.UUID, status *Status, severity *Severity) (int, error) {
	args := []any{tenantID}
	where := []string{"tenant_id = $1"}
	if status != nil {
		args = append(args, *status)
		where = append(where, fmt.Sprintf("status = $%d", len(args)))
	}
	if severity != nil {
		args = append(args, *severity)
		where = append(where, fmt.Sprintf("severity = $%d", len(args)))
	}
	var total int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM respond_incident WHERE `+strings.Join(where, " AND "), args...).Scan(&total); err != nil {
		return 0, fmt.Errorf("respond: count incidents: %w", err)
	}
	return total, nil
}

func (s *Store) UpdateIncident(ctx context.Context, db DBTX, inc *Incident, expectedVersion int) error {
	servicesJSON, err := json.Marshal(inc.ImpactedServices)
	if err != nil {
		return fmt.Errorf("respond: marshal impacted services: %w", err)
	}
	updated, err := scanIncident(db.QueryRow(ctx, `
UPDATE respond_incident
   SET title = $3,
       description = $4,
       impacted_services = $5,
       row_version = row_version + 1,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND row_version = $6
RETURNING `+incidentColumns,
		inc.TenantID, inc.ID, inc.Title, inc.Description, servicesJSON, expectedVersion))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrVersionConflict
		}
		return fmt.Errorf("respond: update incident %s: %w", inc.ID, err)
	}
	*inc = *updated
	return nil
}

func (s *Store) UpdateSeverity(ctx context.Context, db DBTX, tenantID, id uuid.UUID, severity Severity, expectedVersion int) (*Incident, error) {
	updated, err := scanIncident(db.QueryRow(ctx, `
UPDATE respond_incident
   SET severity = $3, row_version = row_version + 1, updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND row_version = $4
RETURNING `+incidentColumns, tenantID, id, severity, expectedVersion))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("respond: update severity %s: %w", id, err)
	}
	return updated, nil
}

func (s *Store) UpdateStatus(ctx context.Context, db DBTX, tenantID, id uuid.UUID, from, to Status, expectedVersion int, at time.Time) (*Incident, error) {
	updated, err := scanIncident(db.QueryRow(ctx, `
UPDATE respond_incident
   SET status = $4,
       mitigated_at = CASE WHEN $4 = 'Mitigated' THEN COALESCE(mitigated_at, $6) ELSE mitigated_at END,
       resolved_at = CASE WHEN $4 = 'Resolved' THEN COALESCE(resolved_at, $6) ELSE resolved_at END,
       closed_at = CASE WHEN $4 = 'Closed' THEN COALESCE(closed_at, $6) ELSE closed_at END,
       row_version = row_version + 1,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND status = $3 AND row_version = $5
RETURNING `+incidentColumns, tenantID, id, from, to, expectedVersion, at))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("respond: update status %s: %w", id, err)
	}
	return updated, nil
}

func (s *Store) AppendTimelineEvent(ctx context.Context, db DBTX, ev *TimelineEvent) error {
	payloadJSON, err := json.Marshal(ev.Payload)
	if err != nil {
		return fmt.Errorf("respond: marshal timeline payload: %w", err)
	}
	if ev.Payload == nil {
		payloadJSON = []byte(`{}`)
	}
	err = db.QueryRow(ctx, `
INSERT INTO respond_incident_timeline_event
    (tenant_id, incident_id, actor_id, occurred_at, event_type, payload)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, occurred_at`,
		ev.TenantID, ev.IncidentID, ev.ActorID, ev.OccurredAt, ev.EventType, payloadJSON,
	).Scan(&ev.ID, &ev.OccurredAt)
	if err != nil {
		return fmt.Errorf("respond: append timeline event: %w", err)
	}
	return nil
}

func (s *Store) CreateStakeholderToken(ctx context.Context, db DBTX, token *StakeholderToken) error {
	if token.Scope == "" {
		token.Scope = "status"
	}
	err := db.QueryRow(ctx, `
INSERT INTO respond_stakeholder_token (
    tenant_id, incident_id, token_hash, scope, expires_at, next_update_at, created_by, created_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, created_at`,
		token.TenantID, token.IncidentID, token.TokenHash, token.Scope,
		token.ExpiresAt, token.NextUpdateAt, token.CreatedBy, token.CreatedAt,
	).Scan(&token.ID, &token.CreatedAt)
	if err != nil {
		return fmt.Errorf("respond: create stakeholder token: %w", err)
	}
	return nil
}

func (s *Store) GetStakeholderStatusByTokenHash(ctx context.Context, db DBTX, tokenHash []byte, now time.Time) (*StakeholderStatus, error) {
	var status StakeholderStatus
	var description string
	var servicesJSON []byte
	var lastUpdateAt time.Time
	err := db.QueryRow(ctx, `
SELECT i.reference, i.title, i.severity, i.status, i.description, i.impacted_services,
       i.updated_at, st.next_update_at
  FROM respond_stakeholder_token st
  JOIN respond_incident i
    ON i.tenant_id = st.tenant_id
   AND i.id = st.incident_id
 WHERE st.token_hash = $1
   AND st.revoked_at IS NULL
   AND (st.expires_at IS NULL OR st.expires_at > $2)
 LIMIT 1`, tokenHash, now).Scan(
		&status.IncidentReference,
		&status.Title,
		&status.Severity,
		&status.Status,
		&description,
		&servicesJSON,
		&lastUpdateAt,
		&status.NextUpdateAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrStakeholderNotFound
		}
		return nil, fmt.Errorf("respond: get stakeholder status: %w", err)
	}
	status.LastUpdateAt = &lastUpdateAt
	var services []string
	if len(servicesJSON) > 0 {
		if err := json.Unmarshal(servicesJSON, &services); err != nil {
			return nil, fmt.Errorf("respond: unmarshal stakeholder impacted services: %w", err)
		}
	}
	status.ImpactSummary = stakeholderImpactSummary(description, services)
	status.CurrentPhase = string(status.Status)
	return &status, nil
}

func stakeholderImpactSummary(description string, services []string) string {
	description = strings.TrimSpace(description)
	if description != "" {
		return description
	}
	services = normalizeServices(services)
	if len(services) == 0 {
		return "Impact summary has not been recorded for this incident."
	}
	return "Impacted services: " + strings.Join(services, ", ")
}

func (s *Store) ListTimelineEvents(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, f TimelineFilter) ([]TimelineEvent, error) {
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	args := []any{tenantID, incidentID}
	where := []string{"tenant_id = $1", "incident_id = $2"}
	if len(f.EventTypes) > 0 {
		args = append(args, f.EventTypes)
		where = append(where, fmt.Sprintf("event_type = ANY($%d)", len(args)))
	}
	if f.ActorID != nil {
		args = append(args, *f.ActorID)
		where = append(where, fmt.Sprintf("actor_id = $%d", len(args)))
	}
	if f.From != nil {
		args = append(args, *f.From)
		where = append(where, fmt.Sprintf("occurred_at >= $%d", len(args)))
	}
	if f.To != nil {
		args = append(args, *f.To)
		where = append(where, fmt.Sprintf("occurred_at <= $%d", len(args)))
	}
	if f.AfterID != nil {
		args = append(args, *f.AfterID)
		where = append(where, fmt.Sprintf(`(occurred_at, id) > (
		    SELECT occurred_at, id FROM respond_incident_timeline_event WHERE tenant_id = $1 AND incident_id = $2 AND id = $%d
		)`, len(args)))
	}
	args = append(args, limit)
	q := `SELECT id, tenant_id, incident_id, actor_id, occurred_at, event_type, payload
FROM respond_incident_timeline_event WHERE ` + strings.Join(where, " AND ") +
		fmt.Sprintf(` ORDER BY occurred_at ASC, id ASC LIMIT $%d`, len(args))
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("respond: list timeline events: %w", err)
	}
	defer rows.Close()

	var out []TimelineEvent
	for rows.Next() {
		var ev TimelineEvent
		var payloadJSON []byte
		if err := rows.Scan(&ev.ID, &ev.TenantID, &ev.IncidentID, &ev.ActorID, &ev.OccurredAt, &ev.EventType, &payloadJSON); err != nil {
			return nil, fmt.Errorf("respond: scan timeline event: %w", err)
		}
		if len(payloadJSON) > 0 {
			if err := json.Unmarshal(payloadJSON, &ev.Payload); err != nil {
				return nil, fmt.Errorf("respond: unmarshal timeline payload: %w", err)
			}
		}
		if ev.Payload == nil {
			ev.Payload = map[string]any{}
		}
		out = append(out, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read timeline events: %w", err)
	}
	return out, nil
}
