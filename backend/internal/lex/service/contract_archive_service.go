package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ContractArchiveService owns the archive lifecycle for contracts (CAP-122):
// flipping a contract's archive_status between 'active' and 'archived' and the
// advanced search over the archived set. The archive_status is a soft state
// distinct from the contract's business `status`; archiving never changes the
// contract's status, only stamps archive_date/archived_by/archive_reason and
// flips archive_status. Every query is tenant-scoped and skips soft-deleted rows.
type ContractArchiveService struct {
	db        *pgxpool.Pool
	publisher Publisher
	topic     string
	logger    zerolog.Logger
}

func NewContractArchiveService(db *pgxpool.Pool, publisher Publisher, topic string, logger zerolog.Logger) *ContractArchiveService {
	return &ContractArchiveService{
		db:        db,
		publisher: publisherOrNoop(publisher),
		topic:     topic,
		logger:    logger.With().Str("service", "lex-contract-archive").Logger(),
	}
}

// ArchiveStatusActive / ArchiveStatusArchived mirror the archive_status text
// values written by migration 000075 (column default 'active').
const (
	ArchiveStatusActive   = "active"
	ArchiveStatusArchived = "archived"
)

// ArchivedContract is the row projection returned by ListArchived. It carries the
// archive metadata alongside the core descriptive contract columns so the
// "Archived Contracts" view can render + filter without a second fetch. It is a
// read model, deliberately distinct from model.Contract (which the shared
// contractJSONSelect does not yet project the archive columns onto).
type ArchivedContract struct {
	ID             uuid.UUID            `json:"id"`
	TenantID       uuid.UUID            `json:"tenant_id"`
	Title          string               `json:"title"`
	ContractNumber *string              `json:"contract_number,omitempty"`
	Type           model.ContractType   `json:"type"`
	Status         model.ContractStatus `json:"status"`
	PartyBName     string               `json:"party_b_name"`
	Department     *string              `json:"department,omitempty"`
	OwnerUserID    uuid.UUID            `json:"owner_user_id"`
	OwnerName      string               `json:"owner_name"`
	RiskLevel      model.RiskLevel      `json:"risk_level"`
	RiskScore      *float64             `json:"risk_score,omitempty"`
	EffectiveDate  *time.Time           `json:"effective_date,omitempty"`
	ExpiryDate     *time.Time           `json:"expiry_date,omitempty"`
	Tags           []string             `json:"tags"`
	ArchiveStatus  string               `json:"archive_status"`
	ArchiveDate    *time.Time           `json:"archive_date,omitempty"`
	ArchivedBy     *uuid.UUID           `json:"archived_by,omitempty"`
	ArchiveReason  *string              `json:"archive_reason,omitempty"`
	CreatedAt      time.Time            `json:"created_at"`
	UpdatedAt      time.Time            `json:"updated_at"`
}

// ArchiveFilter is the advanced-search filter set for the archived-contracts view.
// archive_date is filtered as a [From, To] range; ArchivedBy, the original
// Status/Type/OwnerUserID and a single Tag mirror the existing list filters. When
// ArchiveStatus is empty the list defaults to 'archived' (the view's purpose);
// callers may pass 'active' to inspect the non-archived set through the same lens.
type ArchiveFilter struct {
	Page          int
	PerPage       int
	Search        string
	ArchiveStatus string
	ArchiveFrom   *time.Time
	ArchiveTo     *time.Time
	ArchivedBy    *uuid.UUID
	Status        *model.ContractStatus
	Type          *model.ContractType
	Department    string
	OwnerUserID   *uuid.UUID
	Tag           string
}

// ArchiveContract flips a contract to archive_status='archived', stamping
// archive_date (now), archived_by (the actor) and an optional reason. It is
// idempotent-safe: re-archiving an already-archived contract refreshes the stamp.
func (s *ContractArchiveService) ArchiveContract(ctx context.Context, tenantID, userID, contractID uuid.UUID, reason string) (*ArchivedContract, error) {
	reason = strings.TrimSpace(reason)
	var reasonArg *string
	if reason != "" {
		reasonArg = &reason
	}
	ct, err := s.db.Exec(ctx, `
		UPDATE contracts
		SET archive_status = $4,
		    archive_date = now(),
		    archived_by = $3,
		    archive_reason = $5,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, contractID, userID, ArchiveStatusArchived, reasonArg,
	)
	if err != nil {
		return nil, internalError("archive contract", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, notFoundError("contract not found")
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.archived", tenantID, &userID, map[string]any{
		"id": contractID, "contract_id": contractID, "archive_reason": reason,
	}, s.logger)
	return s.getArchived(ctx, tenantID, contractID)
}

// UnarchiveContract restores a contract to archive_status='active', clearing the
// archive metadata. The contract's business status is left untouched.
func (s *ContractArchiveService) UnarchiveContract(ctx context.Context, tenantID, userID, contractID uuid.UUID) (*ArchivedContract, error) {
	ct, err := s.db.Exec(ctx, `
		UPDATE contracts
		SET archive_status = $3,
		    archive_date = NULL,
		    archived_by = NULL,
		    archive_reason = NULL,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, contractID, ArchiveStatusActive,
	)
	if err != nil {
		return nil, internalError("unarchive contract", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, notFoundError("contract not found")
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.unarchived", tenantID, &userID, map[string]any{
		"id": contractID, "contract_id": contractID,
	}, s.logger)
	return s.getArchived(ctx, tenantID, contractID)
}

// ListArchived runs the advanced archived-contracts search: archive_status
// (default 'archived'), archive_date range, archived_by, plus the original
// status/type/owner/tag and a free-text query. Results are paginated and ordered
// by archive_date DESC (most-recently archived first), matching the supporting
// idx_contracts_archive index.
func (s *ContractArchiveService) ListArchived(ctx context.Context, tenantID uuid.UUID, filter ArchiveFilter) ([]ArchivedContract, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"c.tenant_id = $1", "c.deleted_at IS NULL"}

	archiveStatus := strings.TrimSpace(filter.ArchiveStatus)
	if archiveStatus == "" {
		archiveStatus = ArchiveStatusArchived
	}
	conditions = append(conditions, fmt.Sprintf("c.archive_status = $%d", arg))
	args = append(args, archiveStatus)
	arg++

	if search := strings.TrimSpace(filter.Search); search != "" {
		conditions = append(conditions, fmt.Sprintf(`(
			c.title ILIKE '%%' || $%d || '%%'
			OR c.party_b_name ILIKE '%%' || $%d || '%%'
			OR coalesce(c.contract_number, '') ILIKE '%%' || $%d || '%%'
		)`, arg, arg, arg))
		args = append(args, search)
		arg++
	}
	if filter.ArchiveFrom != nil {
		conditions = append(conditions, fmt.Sprintf("c.archive_date >= $%d", arg))
		args = append(args, *filter.ArchiveFrom)
		arg++
	}
	if filter.ArchiveTo != nil {
		conditions = append(conditions, fmt.Sprintf("c.archive_date <= $%d", arg))
		args = append(args, *filter.ArchiveTo)
		arg++
	}
	if filter.ArchivedBy != nil {
		conditions = append(conditions, fmt.Sprintf("c.archived_by = $%d", arg))
		args = append(args, *filter.ArchivedBy)
		arg++
	}
	if filter.Status != nil {
		conditions = append(conditions, fmt.Sprintf("c.status = $%d", arg))
		args = append(args, *filter.Status)
		arg++
	}
	if filter.Type != nil {
		conditions = append(conditions, fmt.Sprintf("c.type = $%d", arg))
		args = append(args, *filter.Type)
		arg++
	}
	if department := strings.TrimSpace(filter.Department); department != "" {
		conditions = append(conditions, fmt.Sprintf("LOWER(COALESCE(c.department, '')) = LOWER($%d)", arg))
		args = append(args, department)
		arg++
	}
	if filter.OwnerUserID != nil {
		conditions = append(conditions, fmt.Sprintf("c.owner_user_id = $%d", arg))
		args = append(args, *filter.OwnerUserID)
		arg++
	}
	if tag := strings.ToLower(strings.TrimSpace(filter.Tag)); tag != "" {
		conditions = append(conditions, fmt.Sprintf("EXISTS (SELECT 1 FROM unnest(COALESCE(c.tags, '{}')) AS archive_tag(value) WHERE LOWER(archive_tag.value) = $%d)", arg))
		args = append(args, tag)
		arg++
	}
	where := strings.Join(conditions, " AND ")

	var total int
	if err := s.db.QueryRow(ctx, "SELECT COUNT(*) FROM contracts c WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, internalError("count archived contracts", err)
	}
	if total == 0 {
		return []ArchivedContract{}, 0, nil
	}

	page := filter.Page
	if page < 1 {
		page = 1
	}
	perPage := filter.PerPage
	if perPage < 1 {
		perPage = 25
	}
	if perPage > 200 {
		perPage = 200
	}
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)

	query := archivedContractSelect(where) + fmt.Sprintf(" ORDER BY t.archive_date DESC NULLS LAST, t.updated_at DESC LIMIT $%d OFFSET $%d", limitIdx, offsetIdx)
	items, err := queryArchivedList(ctx, s.db, query, args...)
	if err != nil {
		return nil, 0, internalError("list archived contracts", err)
	}
	return items, total, nil
}

// getArchived re-fetches a single contract as an ArchivedContract projection so
// archive/unarchive can echo the post-mutation state back to the caller.
func (s *ContractArchiveService) getArchived(ctx context.Context, tenantID, contractID uuid.UUID) (*ArchivedContract, error) {
	query := archivedContractSelect("c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL")
	items, err := queryArchivedList(ctx, s.db, query, tenantID, contractID)
	if err != nil {
		return nil, internalError("load archived contract", err)
	}
	if len(items) == 0 {
		return nil, notFoundError("contract not found")
	}
	return &items[0], nil
}

// archivedContractSelect projects the archive read model. Unlike the shared
// contractJSONSelect it includes the archive_* columns and omits the encrypted
// fields (the archived view never renders document text / party contact).
func archivedContractSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT c.id, c.tenant_id, c.title, c.contract_number, c.type, c.status,
			       c.party_b_name, c.department, c.owner_user_id, c.owner_name,
			       COALESCE(c.risk_level, 'none') AS risk_level, c.risk_score::float8 AS risk_score,
			       c.effective_date::timestamptz AS effective_date,
			       c.expiry_date::timestamptz AS expiry_date,
			       COALESCE(c.tags, '{}') AS tags,
			       COALESCE(c.archive_status, 'active') AS archive_status,
			       c.archive_date::timestamptz AS archive_date, c.archived_by, c.archive_reason,
			       c.created_at, c.updated_at
			FROM contracts c
			WHERE ` + where + `
		) t`
}

// queryArchivedList scans row_to_json rows into ArchivedContract, mirroring the
// queryListJSON helper used by the contract repository.
func queryArchivedList(ctx context.Context, db *pgxpool.Pool, query string, args ...any) ([]ArchivedContract, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]ArchivedContract, 0)
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item ArchivedContract
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, fmt.Errorf("unmarshal archived contract json: %w", err)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
