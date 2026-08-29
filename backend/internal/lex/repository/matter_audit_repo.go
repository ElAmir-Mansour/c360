package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// MatterAuditRepository owns the append-only legal_matter_audit_log store: the
// chronological governance trail for a matter. It mirrors the settlement/case
// audit repos (AppendAudit inside a tx, ListAudit oldest-first).
//
// NOTE: at the time this read path was built, NO matter mutation (create /
// triage / status / update / contract link) wrote rows to this table — the
// emitting handlers/services are shared files that this build does not edit.
// AppendAudit is provided so a follow-up can wire emission inside the existing
// matter transactions without touching the read layer.
type MatterAuditRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewMatterAuditRepository(db *pgxpool.Pool, logger zerolog.Logger) *MatterAuditRepository {
	return &MatterAuditRepository{db: db, logger: logger}
}

// AppendAudit inserts one immutable matter governance audit row. Accepts a
// Queryer so a follow-up can run it INSIDE the mutating matter transaction (the
// audit row and the matter mutation then commit/roll back atomically).
func (r *MatterAuditRepository) AppendAudit(ctx context.Context, q Queryer, entry *model.MatterAuditEntry) error {
	detailJSON, err := json.Marshal(orEmptyMap(entry.Detail))
	if err != nil {
		return fmt.Errorf("marshal matter audit detail: %w", err)
	}
	query := `
		INSERT INTO legal_matter_audit_log (
			id, tenant_id, matter_id, action, from_status, to_status, detail, actor_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.MatterID, entry.Action,
		entry.FromStatus, entry.ToStatus, detailJSON, entry.ActorUserID,
	).Scan(&entry.CreatedAt)
}

// ListAudit returns the append-only governance trail for a matter, oldest-first.
func (r *MatterAuditRepository) ListAudit(ctx context.Context, tenantID, matterID uuid.UUID) ([]model.MatterAuditEntry, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT a.id, a.tenant_id, a.matter_id, a.action, a.from_status, a.to_status,
			       COALESCE(a.detail, '{}'::jsonb) AS detail, a.actor_user_id, a.created_at
			FROM legal_matter_audit_log a
			WHERE a.tenant_id = $1 AND a.matter_id = $2
			ORDER BY a.created_at ASC
		) t`
	return queryListJSON[model.MatterAuditEntry](ctx, r.db, query, tenantID, matterID)
}
