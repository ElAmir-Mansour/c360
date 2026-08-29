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

// AttachmentPolicyRepository persists lex_attachment_policies (CAP-165..170).
// Bilingual labels and the slots array are stored as JSONB and round-trip via
// row_to_json + queryRowJSON/queryListJSON, mirroring OrgEntityRepository.
type AttachmentPolicyRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewAttachmentPolicyRepository(db *pgxpool.Pool, logger zerolog.Logger) *AttachmentPolicyRepository {
	return &AttachmentPolicyRepository{db: db, logger: logger}
}

func (r *AttachmentPolicyRepository) Create(ctx context.Context, q Queryer, policy *model.AttachmentPolicy) error {
	nameJSON, err := json.Marshal(policy.Name)
	if err != nil {
		return fmt.Errorf("marshal attachment policy name: %w", err)
	}
	descJSON, err := json.Marshal(policy.Description)
	if err != nil {
		return fmt.Errorf("marshal attachment policy description: %w", err)
	}
	slotsJSON, err := json.Marshal(orEmptySlots(policy.Slots))
	if err != nil {
		return fmt.Errorf("marshal attachment policy slots: %w", err)
	}
	metadataJSON, err := json.Marshal(orEmptyMap(policy.Metadata))
	if err != nil {
		return fmt.Errorf("marshal attachment policy metadata: %w", err)
	}
	query := `
		INSERT INTO lex_attachment_policies (
			id, tenant_id, request_type, service_code, name, description,
			min_attachment_count, max_attachment_count, slots, allowed_content_types,
			max_file_size_bytes, active, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5::jsonb,$6::jsonb,
			$7,$8,$9::jsonb,$10,
			$11,$12,$13::jsonb,$14
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		policy.ID, policy.TenantID, policy.RequestType, policy.ServiceCode, nameJSON, descJSON,
		policy.MinAttachmentCount, policy.MaxAttachmentCount, slotsJSON, policy.AllowedContentTypes,
		policy.MaxFileSizeBytes, policy.Active, metadataJSON, policy.CreatedBy,
	).Scan(&policy.CreatedAt, &policy.UpdatedAt)
}

func (r *AttachmentPolicyRepository) Update(ctx context.Context, q Queryer, policy *model.AttachmentPolicy) error {
	nameJSON, err := json.Marshal(policy.Name)
	if err != nil {
		return fmt.Errorf("marshal attachment policy name: %w", err)
	}
	descJSON, err := json.Marshal(policy.Description)
	if err != nil {
		return fmt.Errorf("marshal attachment policy description: %w", err)
	}
	slotsJSON, err := json.Marshal(orEmptySlots(policy.Slots))
	if err != nil {
		return fmt.Errorf("marshal attachment policy slots: %w", err)
	}
	metadataJSON, err := json.Marshal(orEmptyMap(policy.Metadata))
	if err != nil {
		return fmt.Errorf("marshal attachment policy metadata: %w", err)
	}
	query := `
		UPDATE lex_attachment_policies
		SET request_type = $3,
		    service_code = $4,
		    name = $5::jsonb,
		    description = $6::jsonb,
		    min_attachment_count = $7,
		    max_attachment_count = $8,
		    slots = $9::jsonb,
		    allowed_content_types = $10,
		    max_file_size_bytes = $11,
		    active = $12,
		    metadata = $13::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		policy.TenantID, policy.ID, policy.RequestType, policy.ServiceCode, nameJSON, descJSON,
		policy.MinAttachmentCount, policy.MaxAttachmentCount, slotsJSON, policy.AllowedContentTypes,
		policy.MaxFileSizeBytes, policy.Active, metadataJSON,
	).Scan(&policy.UpdatedAt)
}

func (r *AttachmentPolicyRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.AttachmentPolicy, error) {
	query := attachmentPolicyJSONSelect(`p.tenant_id = $1 AND p.id = $2 AND p.deleted_at IS NULL`, "")
	return queryRowJSON[model.AttachmentPolicy](ctx, r.db, query, tenantID, id)
}

func (r *AttachmentPolicyRepository) List(ctx context.Context, tenantID uuid.UUID, requestType, serviceCode string, activeOnly bool, page, perPage int) ([]model.AttachmentPolicy, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"p.tenant_id = $1", "p.deleted_at IS NULL"}
	if requestType != "" {
		conditions = append(conditions, fmt.Sprintf("p.request_type = $%d", arg))
		args = append(args, requestType)
		arg++
	}
	if serviceCode != "" {
		conditions = append(conditions, fmt.Sprintf("p.service_code = $%d", arg))
		args = append(args, serviceCode)
		arg++
	}
	if activeOnly {
		conditions = append(conditions, "p.active = true")
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM lex_attachment_policies p WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.AttachmentPolicy{}, 0, nil
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 25
	}
	suffix := fmt.Sprintf(" ORDER BY p.updated_at DESC LIMIT $%d OFFSET $%d", arg, arg+1)
	args = append(args, perPage, (page-1)*perPage)
	items, err := queryListJSON[model.AttachmentPolicy](ctx, r.db, attachmentPolicyJSONSelect(where, suffix), args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// FindApplicable resolves the active policy that matches a request_type and/or
// service_code, preferring an exact service_code match over a request_type match.
// Returns pgx.ErrNoRows when no active policy applies (caller treats as "no
// requirement configured").
func (r *AttachmentPolicyRepository) FindApplicable(ctx context.Context, tenantID uuid.UUID, requestType, serviceCode string) (*model.AttachmentPolicy, error) {
	query := attachmentPolicyJSONSelect(
		`p.tenant_id = $1 AND p.deleted_at IS NULL AND p.active = true
		 AND ( ($2 <> '' AND p.service_code = $2) OR ($3 <> '' AND p.request_type = $3) )`,
		` ORDER BY (CASE WHEN p.service_code = $2 AND $2 <> '' THEN 0 ELSE 1 END), p.updated_at DESC LIMIT 1`,
	)
	return queryRowJSON[model.AttachmentPolicy](ctx, r.db, query, tenantID, serviceCode, requestType)
}

func (r *AttachmentPolicyRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE lex_attachment_policies SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func attachmentPolicyJSONSelect(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT p.id, p.tenant_id, p.request_type, p.service_code,
			       COALESCE(p.name, '{}'::jsonb) AS name,
			       COALESCE(p.description, '{}'::jsonb) AS description,
			       p.min_attachment_count, p.max_attachment_count,
			       COALESCE(p.slots, '[]'::jsonb) AS slots,
			       COALESCE(p.allowed_content_types, '{}') AS allowed_content_types,
			       p.max_file_size_bytes, p.active,
			       COALESCE(p.metadata, '{}'::jsonb) AS metadata,
			       p.created_by, p.created_at, p.updated_at, p.deleted_at
			FROM lex_attachment_policies p
			WHERE ` + where + suffix + `
		) t`
}

func orEmptySlots(slots []model.AttachmentSlot) []model.AttachmentSlot {
	if slots == nil {
		return []model.AttachmentSlot{}
	}
	return slots
}
