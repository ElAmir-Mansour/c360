package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// IntakeMailboxRepository persists inbound email mailboxes (legal_intake_mailboxes).
// The ingest_secret_hash column stores the encrypted ("enc:v1:...") HMAC shared
// secret; it is selected explicitly (not via the json projection) so it never
// leaks into API responses through the model's json:"-" tag.
type IntakeMailboxRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewIntakeMailboxRepository(db *pgxpool.Pool, logger zerolog.Logger) *IntakeMailboxRepository {
	return &IntakeMailboxRepository{db: db, logger: logger}
}

func (r *IntakeMailboxRepository) Create(ctx context.Context, q Queryer, mailbox *model.IntakeMailbox) error {
	metaJSON, err := json.Marshal(orEmptyMap(mailbox.Metadata))
	if err != nil {
		return fmt.Errorf("marshal intake mailbox metadata: %w", err)
	}
	query := `
		INSERT INTO legal_intake_mailboxes (
			id, tenant_id, address, request_type, service_id, beneficiary_entity_id,
			ingest_secret_hash, active, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		mailbox.ID, mailbox.TenantID, mailbox.Address, mailbox.RequestType, mailbox.ServiceID,
		mailbox.BeneficiaryEntityID, mailbox.IngestSecretHash, mailbox.Active, metaJSON, mailbox.CreatedBy,
	).Scan(&mailbox.CreatedAt, &mailbox.UpdatedAt)
}

func (r *IntakeMailboxRepository) Update(ctx context.Context, q Queryer, mailbox *model.IntakeMailbox) error {
	metaJSON, err := json.Marshal(orEmptyMap(mailbox.Metadata))
	if err != nil {
		return fmt.Errorf("marshal intake mailbox metadata: %w", err)
	}
	query := `
		UPDATE legal_intake_mailboxes
		SET request_type = $3,
		    service_id = $4,
		    beneficiary_entity_id = $5,
		    ingest_secret_hash = $6,
		    active = $7,
		    metadata = $8::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		mailbox.TenantID, mailbox.ID, mailbox.RequestType, mailbox.ServiceID, mailbox.BeneficiaryEntityID,
		mailbox.IngestSecretHash, mailbox.Active, metaJSON,
	).Scan(&mailbox.UpdatedAt)
}

func (r *IntakeMailboxRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.IntakeMailbox, error) {
	return r.scanOne(ctx, r.db, `mb.tenant_id = $1 AND mb.id = $2 AND mb.deleted_at IS NULL`, tenantID, id)
}

// GetByAddressSystem resolves an active mailbox by address WITHOUT a tenant
// predicate. It is used by the public email webhook (CAP-002) to discover which
// tenant owns the addressed mailbox BEFORE the RLS tenant context can be set.
// It MUST run inside a system (RLS-bypass) transaction. Returns the tenant id so
// the caller can establish the tenant context for the rest of the pipeline.
func (r *IntakeMailboxRepository) GetByAddressSystem(ctx context.Context, q Queryer, address string) (*model.IntakeMailbox, error) {
	return r.scanOne(ctx, q, `lower(mb.address) = $1 AND mb.deleted_at IS NULL AND mb.active = true`, strings.ToLower(strings.TrimSpace(address)))
}

func (r *IntakeMailboxRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.IntakeMailboxListFilters) ([]model.IntakeMailbox, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"mb.tenant_id = $1", "mb.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(mb.address ILIKE '%%' || $%d || '%%' OR mb.request_type ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Active != nil {
		conditions = append(conditions, fmt.Sprintf("mb.active = $%d", arg))
		args = append(args, *filters.Active)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_intake_mailboxes mb WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.IntakeMailbox{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "mb.updated_at"
	switch filters.SortColumn {
	case "mb.address":
		orderCol = "mb.address"
	case "mb.created_at":
		orderCol = "mb.created_at"
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := intakeMailboxBaseSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	return r.scanMany(ctx, query, args...)
}

func (r *IntakeMailboxRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_intake_mailboxes SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func intakeMailboxBaseSelect(where string) string {
	return `
		SELECT mb.id, mb.tenant_id, mb.address, mb.request_type, mb.service_id,
		       mb.beneficiary_entity_id, mb.ingest_secret_hash, mb.active,
		       COALESCE(mb.metadata, '{}'::jsonb), mb.created_by,
		       mb.created_at, mb.updated_at, mb.deleted_at
		FROM legal_intake_mailboxes mb
		WHERE ` + where
}

func (r *IntakeMailboxRepository) scanOne(ctx context.Context, q Queryer, where string, args ...any) (*model.IntakeMailbox, error) {
	row := q.QueryRow(ctx, intakeMailboxBaseSelect(where), args...)
	return scanIntakeMailbox(row)
}

func (r *IntakeMailboxRepository) scanMany(ctx context.Context, query string, args ...any) ([]model.IntakeMailbox, int, error) {
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]model.IntakeMailbox, 0)
	for rows.Next() {
		mailbox, err := scanIntakeMailbox(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *mailbox)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, len(out), nil
}

// rowScanner abstracts pgx.Row / pgx.Rows for the shared mailbox scan.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanIntakeMailbox(row rowScanner) (*model.IntakeMailbox, error) {
	var mailbox model.IntakeMailbox
	var metaRaw []byte
	if err := row.Scan(
		&mailbox.ID, &mailbox.TenantID, &mailbox.Address, &mailbox.RequestType, &mailbox.ServiceID,
		&mailbox.BeneficiaryEntityID, &mailbox.IngestSecretHash, &mailbox.Active,
		&metaRaw, &mailbox.CreatedBy, &mailbox.CreatedAt, &mailbox.UpdatedAt, &mailbox.DeletedAt,
	); err != nil {
		return nil, err
	}
	if len(metaRaw) > 0 {
		if err := json.Unmarshal(metaRaw, &mailbox.Metadata); err != nil {
			return nil, fmt.Errorf("unmarshal intake mailbox metadata: %w", err)
		}
	}
	if mailbox.Metadata == nil {
		mailbox.Metadata = map[string]any{}
	}
	return &mailbox, nil
}
