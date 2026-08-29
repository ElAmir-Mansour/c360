package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// AppendAudit appends one immutable spine status-transition audit row (WS4).
// Accepts a Queryer so it runs INSIDE the mutating transaction: the audit row and
// the status flip commit (or roll back) atomically. The append-only table has no
// update/delete policy, so the trail is tamper-evident.
func (r *LegalRequestRepository) AppendAudit(ctx context.Context, q Queryer, entry *model.LegalRequestAuditEntry) error {
	detailJSON, err := json.Marshal(orEmptyMap(entry.Detail))
	if err != nil {
		return fmt.Errorf("marshal legal request audit detail: %w", err)
	}
	query := `
		INSERT INTO legal_request_audit_log (
			id, tenant_id, request_id, action, from_status, to_status, reason, detail, actor_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.RequestID, entry.Action,
		entry.FromStatus, entry.ToStatus, entry.Reason, detailJSON, entry.ActorUserID,
	).Scan(&entry.CreatedAt)
}

// ListAudit returns the spine status-transition trail for a request, oldest-first.
func (r *LegalRequestRepository) ListAudit(ctx context.Context, tenantID, requestID uuid.UUID) ([]model.LegalRequestAuditEntry, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT al.id, al.tenant_id, al.request_id, al.action, al.from_status, al.to_status,
			       al.reason, COALESCE(al.detail, '{}'::jsonb) AS detail, al.actor_user_id, al.created_at
			FROM legal_request_audit_log al
			WHERE al.tenant_id = $1 AND al.request_id = $2
			ORDER BY al.created_at ASC
		) t`
	return queryListJSON[model.LegalRequestAuditEntry](ctx, r.db, query, tenantID, requestID)
}

// ListAuditEntries returns the spine status-transition trail for a request,
// newest-first, for the read-only activity timeline (feature #8). The underlying
// table is append-only/immutable; this is a pure read.
func (r *LegalRequestRepository) ListAuditEntries(ctx context.Context, tenantID, requestID uuid.UUID) ([]model.LegalRequestAuditEntry, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT al.id, al.tenant_id, al.request_id, al.action, al.from_status, al.to_status,
			       al.reason, COALESCE(al.detail, '{}'::jsonb) AS detail, al.actor_user_id, al.created_at
			FROM legal_request_audit_log al
			WHERE al.tenant_id = $1 AND al.request_id = $2
			ORDER BY al.created_at DESC
		) t`
	return queryListJSON[model.LegalRequestAuditEntry](ctx, r.db, query, tenantID, requestID)
}

// AppendAudit appends one immutable SLA-clock lifecycle audit row (WS4). Accepts a
// Queryer so it runs INSIDE the SLA mutation transaction.
func (r *SLAClockRepository) AppendAudit(ctx context.Context, q Queryer, entry *model.LegalSLAAuditEntry) error {
	detailJSON, err := json.Marshal(orEmptyMap(entry.Detail))
	if err != nil {
		return fmt.Errorf("marshal legal sla audit detail: %w", err)
	}
	query := `
		INSERT INTO legal_sla_audit_log (
			id, tenant_id, sla_clock_id, legal_request_id, action, from_status, to_status,
			reason, escalation_level, detail, actor_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.SLAClockID, entry.LegalRequestID, entry.Action,
		entry.FromStatus, entry.ToStatus, entry.Reason, entry.EscalationLevel, detailJSON, entry.ActorUserID,
	).Scan(&entry.CreatedAt)
}

// ListAudit returns the SLA-clock lifecycle trail for a clock, oldest-first.
func (r *SLAClockRepository) ListAudit(ctx context.Context, tenantID, clockID uuid.UUID) ([]model.LegalSLAAuditEntry, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT al.id, al.tenant_id, al.sla_clock_id, al.legal_request_id, al.action,
			       al.from_status, al.to_status, al.reason, al.escalation_level,
			       COALESCE(al.detail, '{}'::jsonb) AS detail, al.actor_user_id, al.created_at
			FROM legal_sla_audit_log al
			WHERE al.tenant_id = $1 AND al.sla_clock_id = $2
			ORDER BY al.created_at ASC
		) t`
	return queryListJSON[model.LegalSLAAuditEntry](ctx, r.db, query, tenantID, clockID)
}
