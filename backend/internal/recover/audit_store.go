package recover

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/repository"
)

// SQLAuditStore is the APPEND-ONLY SQL implementation of AuditStore over
// recover_audit_event. It contains exactly ONE write statement — an INSERT — and
// two read statements. There is NO UPDATE or DELETE SQL anywhere in this file by
// design: that, together with the migration's INSERT-only RLS policy, makes the
// audit log immutable at both the service and database layers. It holds no
// state; the caller supplies the tenant-scoped DBTX so every statement is
// RLS-isolated.
type SQLAuditStore struct{}

// NewAuditStore constructs the append-only SQL audit store.
func NewAuditStore() *SQLAuditStore { return &SQLAuditStore{} }

var _ AuditStore = (*SQLAuditStore)(nil)

// appendAuditSQL is the ONLY write the audit log accepts — a single immutable
// INSERT. RETURNING surfaces the stamped id and recorded_at so the caller has the
// canonical row without a re-read.
const appendAuditSQL = `
INSERT INTO recover_audit_event
    (tenant_id, event_id, sub_solution, action, actor_id, actor_email,
     application_id, runbook_id, summary, detail, occurred_at, recorded_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
RETURNING id, recorded_at`

// Append inserts one immutable audit row.
func (s *SQLAuditStore) Append(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, rec AuditRecord, now time.Time) (AuditEvent, error) {
	detail := rec.Detail
	if detail == nil {
		detail = map[string]any{}
	}
	detailJSON, err := json.Marshal(detail)
	if err != nil {
		return AuditEvent{}, err
	}
	occurredAt := rec.OccurredAt
	if occurredAt.IsZero() {
		occurredAt = now
	}

	out := AuditEvent{
		EventID:       rec.EventID,
		SubSolution:   rec.SubSolution,
		Action:        rec.Action,
		ActorID:       rec.Actor.ID,
		ActorEmail:    rec.Actor.Email,
		ApplicationID: rec.ApplicationID,
		RunbookID:     rec.RunbookID,
		Summary:       rec.Summary,
		Detail:        rec.Detail,
		OccurredAt:    occurredAt,
	}
	err = db.QueryRow(ctx, appendAuditSQL,
		tenantID, rec.EventID, rec.SubSolution, rec.Action,
		auditNullUUID(rec.Actor.ID), rec.Actor.Email,
		auditNullUUID(rec.ApplicationID), auditNullUUID(rec.RunbookID),
		rec.Summary, detailJSON, occurredAt,
	).Scan(&out.ID, &out.RecordedAt)
	if err != nil {
		return AuditEvent{}, err
	}
	return out, nil
}

const listForEventSQL = `
SELECT id, event_id, sub_solution, action, actor_id, actor_email,
       application_id, runbook_id, summary, detail, occurred_at, recorded_at
  FROM recover_audit_event
 WHERE tenant_id = $1 AND event_id = $2
 ORDER BY occurred_at ASC, id ASC`

// ListForEvent returns one recovery event's audit timeline, oldest first.
func (s *SQLAuditStore) ListForEvent(ctx context.Context, db repository.DBTX, tenantID, eventID uuid.UUID) ([]AuditEvent, error) {
	rows, err := db.Query(ctx, listForEventSQL, tenantID, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AuditEvent{}
	for rows.Next() {
		ev, serr := scanAuditEvent(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// listRecentEventsSQL rolls the append-only log up to one row per recovery
// event, newest first: the action count, the time span, and (via a correlated
// pick of the newest row) the latest action and actor. It is ONE query — the
// grouping and the lateral newest-row pick run server-side, no N+1.
const listRecentEventsSQL = `
SELECT g.event_id,
       g.sub_solution,
       g.action_count,
       latest.action      AS latest_action,
       latest.actor_email AS latest_actor,
       g.first_at,
       g.last_at
  FROM (
        SELECT event_id,
               min(sub_solution) AS sub_solution,
               count(*)          AS action_count,
               min(occurred_at)  AS first_at,
               max(occurred_at)  AS last_at
          FROM recover_audit_event
         WHERE tenant_id = $1
         GROUP BY event_id
       ) g
  JOIN LATERAL (
        SELECT action, actor_email
          FROM recover_audit_event e
         WHERE e.tenant_id = $1 AND e.event_id = g.event_id
         ORDER BY e.occurred_at DESC, e.id DESC
         LIMIT 1
       ) latest ON true
 ORDER BY g.last_at DESC
 LIMIT $2`

// ListRecentEvents returns the tenant's audited recovery events, newest first.
func (s *SQLAuditStore) ListRecentEvents(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, limit int) ([]AuditEventSummary, error) {
	if limit < 1 {
		limit = 1
	}
	rows, err := db.Query(ctx, listRecentEventsSQL, tenantID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AuditEventSummary{}
	for rows.Next() {
		var sum AuditEventSummary
		if err := rows.Scan(&sum.EventID, &sum.SubSolution, &sum.ActionCount,
			&sum.LatestAction, &sum.LatestActor, &sum.FirstAt, &sum.LastAt); err != nil {
			return nil, err
		}
		out = append(out, sum)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// scanAuditEvent maps one recover_audit_event row to an AuditEvent.
func scanAuditEvent(row interface{ Scan(...any) error }) (AuditEvent, error) {
	var (
		ev      AuditEvent
		actorID sql.NullString
		appID   sql.NullString
		rbID    sql.NullString
		blob    []byte
	)
	if err := row.Scan(
		&ev.ID, &ev.EventID, &ev.SubSolution, &ev.Action, &actorID, &ev.ActorEmail,
		&appID, &rbID, &ev.Summary, &blob, &ev.OccurredAt, &ev.RecordedAt,
	); err != nil {
		return AuditEvent{}, err
	}
	ev.ActorID = parseAuditUUID(actorID)
	ev.ApplicationID = parseAuditUUID(appID)
	ev.RunbookID = parseAuditUUID(rbID)
	if len(blob) > 0 {
		_ = json.Unmarshal(blob, &ev.Detail)
	}
	return ev, nil
}

func auditNullUUID(id *uuid.UUID) any {
	if id == nil {
		return nil
	}
	return *id
}

func parseAuditUUID(s sql.NullString) *uuid.UUID {
	if !s.Valid || s.String == "" {
		return nil
	}
	id, err := uuid.Parse(s.String)
	if err != nil {
		return nil
	}
	return &id
}
