package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// LegalRequestRepository persists the canonical request spine (CAP-009) and its
// append-only priority-change audit trail (CAP-011). Queries filter by tenant_id
// (primary predicate) with table RLS as a backstop, mirroring the other lex
// repositories. Reads project rows through row_to_json so the bilingual title
// (forms.LocalizedText) round-trips via json.Unmarshal. Writes that participate
// in a transaction accept a Queryer so the spine row and its workflow/priority
// side-effects can be committed atomically.
type LegalRequestRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewLegalRequestRepository(db *pgxpool.Pool, logger zerolog.Logger) *LegalRequestRepository {
	return &LegalRequestRepository{db: db, logger: logger}
}

func (r *LegalRequestRepository) Create(ctx context.Context, q Queryer, req *model.LegalRequest) error {
	titleJSON, err := json.Marshal(req.Title)
	if err != nil {
		return fmt.Errorf("marshal legal request title: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(req.Metadata))
	if err != nil {
		return fmt.Errorf("marshal legal request metadata: %w", err)
	}
	query := `
		INSERT INTO legal_requests (
			id, tenant_id, request_number, request_type, service_id, title, description,
			requester_user_id, requester_name, beneficiary_entity_id, department,
			priority, status, urgency_justification, requester_approval_required,
			provider_approval_required, subject_type, subject_id, workflow_instance_id,
			metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6::jsonb,$7,
			$8,$9,$10,$11,
			$12,$13,$14,$15,
			$16,$17,$18,$19,
			$20::jsonb,$21
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		req.ID, req.TenantID, req.RequestNumber, req.RequestType, req.ServiceID, titleJSON, req.Description,
		req.RequesterUserID, req.RequesterName, req.BeneficiaryEntityID, req.Department,
		req.Priority, req.Status, req.UrgencyJustification, req.RequesterApprovalReqd,
		req.ProviderApprovalReqd, req.SubjectType, req.SubjectID, req.WorkflowInstanceID,
		metaJSON, req.CreatedBy,
	).Scan(&req.CreatedAt, &req.UpdatedAt)
}

func (r *LegalRequestRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalRequest, error) {
	query := legalRequestJSONSelect(`lr.tenant_id = $1 AND lr.id = $2 AND lr.deleted_at IS NULL`)
	return queryRowJSON[model.LegalRequest](ctx, r.db, query, tenantID, id)
}

func (r *LegalRequestRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.LegalRequestListFilters) ([]model.LegalRequest, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"lr.tenant_id = $1", "lr.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, legalRequestSearchPredicate(arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("lr.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if len(filters.Statuses) > 0 {
		statuses := make([]string, 0, len(filters.Statuses))
		for _, status := range filters.Statuses {
			statuses = append(statuses, string(status))
		}
		conditions = append(conditions, fmt.Sprintf("lr.status = ANY($%d)", arg))
		args = append(args, statuses)
		arg++
	}
	if filters.UpdatedFrom != nil {
		conditions = append(conditions, fmt.Sprintf("lr.updated_at >= $%d", arg))
		args = append(args, *filters.UpdatedFrom)
		arg++
	}
	if filters.UpdatedTo != nil {
		conditions = append(conditions, fmt.Sprintf("lr.updated_at < $%d", arg))
		args = append(args, *filters.UpdatedTo)
		arg++
	}
	if filters.Priority != nil {
		conditions = append(conditions, fmt.Sprintf("lr.priority = $%d", arg))
		args = append(args, *filters.Priority)
		arg++
	}
	if filters.RequestType != "" {
		conditions = append(conditions, fmt.Sprintf("lr.request_type = $%d", arg))
		args = append(args, filters.RequestType)
		arg++
	}
	if filters.RequesterUserID != nil {
		conditions = append(conditions, fmt.Sprintf("lr.requester_user_id = $%d", arg))
		args = append(args, *filters.RequesterUserID)
		arg++
	}
	if filters.VisibilityActorID != nil {
		conditions = append(conditions, fmt.Sprintf("(lr.created_by = $%d OR lr.requester_user_id = $%d)", arg, arg))
		args = append(args, *filters.VisibilityActorID)
		arg++
	}
	if filters.BeneficiaryEntityID != nil {
		conditions = append(conditions, fmt.Sprintf("lr.beneficiary_entity_id = $%d", arg))
		args = append(args, *filters.BeneficiaryEntityID)
		arg++
	}
	if filters.ServiceID != nil {
		conditions = append(conditions, fmt.Sprintf("lr.service_id = $%d", arg))
		args = append(args, *filters.ServiceID)
		arg++
	}
	if filters.Department != "" {
		conditions = append(conditions, fmt.Sprintf("lr.department = $%d", arg))
		args = append(args, filters.Department)
		arg++
	}
	if filters.SubjectType != "" {
		conditions = append(conditions, fmt.Sprintf("lr.subject_type = $%d", arg))
		args = append(args, filters.SubjectType)
		arg++
	}
	if filters.ApprovalActorID != nil {
		actorIdx := arg
		args = append(args, *filters.ApprovalActorID)
		arg++
		rolesIdx := arg
		args = append(args, filters.ApprovalActorRoles)
		arg++
		bypassRoleIdx := arg
		args = append(args, filters.ApprovalActorRoleBypass)
		arg++
		conditions = append(conditions, fmt.Sprintf(`
			lr.status IN ('pending_requester_approval', 'pending_provider_approval')
			AND lr.workflow_instance_id IS NOT NULL
			AND lr.created_by IS NOT NULL
			AND lr.created_by <> $%d
			AND EXISTS (
				SELECT 1
				FROM workflow_tasks wt
				WHERE wt.tenant_id = lr.tenant_id
				  AND wt.instance_id = lr.workflow_instance_id
				  AND wt.step_id = 'request_approval'
				  AND wt.status IN ('pending', 'claimed', 'escalated')
				  AND (wt.claimed_by IS NULL OR wt.claimed_by = $%d)
				  AND (wt.assignee_id IS NULL OR wt.assignee_id = $%d)
				  AND (
				    $%d
				    OR NULLIF(BTRIM(wt.assignee_role), '') IS NULL
				    OR REPLACE(LOWER(BTRIM(wt.assignee_role)), '-', '_') = ANY($%d::text[])
				  )
			)`, actorIdx, actorIdx, actorIdx, bypassRoleIdx, rolesIdx))
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_requests lr WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.LegalRequest{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := legalRequestSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := legalRequestJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.LegalRequest](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// legalRequestSearchPredicate is kept in one helper so the inbox's documented
// search contract (request ID OR client/requester name) cannot silently regress.
// Every branch reuses the same parameter placeholder; the tenant/deleted guards
// are applied by List outside this parenthesized OR group.
func legalRequestSearchPredicate(arg int) string {
	return fmt.Sprintf(`(
		lr.title->>'ar' ILIKE '%%' || $%[1]d || '%%'
		OR lr.title->>'en' ILIKE '%%' || $%[1]d || '%%'
		OR lr.description ILIKE '%%' || $%[1]d || '%%'
		OR lr.request_number ILIKE '%%' || $%[1]d || '%%'
		OR lr.requester_name ILIKE '%%' || $%[1]d || '%%'
	)`, arg)
}

func (r *LegalRequestRepository) Update(ctx context.Context, q Queryer, req *model.LegalRequest) error {
	titleJSON, err := json.Marshal(req.Title)
	if err != nil {
		return fmt.Errorf("marshal legal request title: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(req.Metadata))
	if err != nil {
		return fmt.Errorf("marshal legal request metadata: %w", err)
	}
	query := `
		UPDATE legal_requests
		SET request_type = $3,
		    service_id = $4,
		    title = $5::jsonb,
		    description = $6,
		    requester_name = $7,
		    beneficiary_entity_id = $8,
		    department = $9,
		    requester_approval_required = $10,
		    provider_approval_required = $11,
		    subject_type = $12,
		    subject_id = $13,
		    metadata = $14::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		req.TenantID, req.ID, req.RequestType, req.ServiceID, titleJSON, req.Description,
		req.RequesterName, req.BeneficiaryEntityID, req.Department,
		req.RequesterApprovalReqd, req.ProviderApprovalReqd, req.SubjectType, req.SubjectID,
		metaJSON,
	).Scan(&req.UpdatedAt)
}

// UpdateStatus advances the request FSM. workflowInstanceID is set when the
// transition spawns/links an approval workflow instance (nil leaves it
// unchanged via COALESCE).
func (r *LegalRequestRepository) UpdateStatus(ctx context.Context, q Queryer, tenantID, id uuid.UUID, status model.RequestStatus, workflowInstanceID *uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_requests
		SET status = $3,
		    workflow_instance_id = COALESCE($4, workflow_instance_id),
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, status, workflowInstanceID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ErrStatusConflict is returned by the optimistic-concurrency-guarded status
// transition path when the row exists but its current status (and/or
// lock_version) no longer matches the caller's expectation — i.e. a concurrent
// writer moved the request out from under this transition. Callers map this to a
// 409 Conflict rather than a silent no-op or a 404. It is sentinel-checked with
// errors.Is.
var ErrStatusConflict = errors.New("legal request status precondition failed")

// ErrRequestFeedbackExists reports the append-only one-response-per-request
// constraint without leaking a database-specific unique-violation to callers.
var ErrRequestFeedbackExists = errors.New("legal request feedback already exists")

// GetFeedback returns the requester's satisfaction response, or pgx.ErrNoRows
// when no response has been submitted yet.
func (r *LegalRequestRepository) GetFeedback(ctx context.Context, tenantID, requestID uuid.UUID) (*model.LegalRequestFeedback, error) {
	return queryRowJSON[model.LegalRequestFeedback](ctx, r.db, `
		SELECT row_to_json(f)
		FROM legal_request_feedback f
		WHERE f.tenant_id = $1 AND f.request_id = $2`, tenantID, requestID)
}

// CreateFeedback appends a single satisfaction response. ON CONFLICT is used
// instead of an update so the persistence path preserves the append-only
// contract even under concurrent duplicate submissions.
func (r *LegalRequestRepository) CreateFeedback(ctx context.Context, feedback *model.LegalRequestFeedback) error {
	err := r.db.QueryRow(ctx, `
		INSERT INTO legal_request_feedback (
			id, tenant_id, request_id, rating, comment, submitted_by
		) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (tenant_id, request_id) DO NOTHING
		RETURNING submitted_at`,
		feedback.ID, feedback.TenantID, feedback.RequestID, feedback.Rating,
		feedback.Comment, feedback.SubmittedBy,
	).Scan(&feedback.SubmittedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRequestFeedbackExists
	}
	return err
}

// UpdateStatusGuarded performs an optimistic-concurrency / status-precondition
// transition: it advances status to `to` ONLY when the row is still at
// `expectedFrom` and (when supplied) still at `expectedLockVersion`, bumping
// lock_version atomically. It distinguishes three outcomes:
//
//   - row updated → nil
//   - row absent (wrong id/tenant, soft-deleted) → pgx.ErrNoRows (→ 404)
//   - row present but precondition failed (status/lock_version drifted) →
//     ErrStatusConflict (→ 409)
//
// The two failure cases are told apart with a follow-up existence probe inside
// the same Queryer (tx), so a concurrent transition reported as a 409 instead of
// a misleading 404. workflowInstanceID, when non-nil, is COALESCE-set alongside
// the status (nil leaves the link unchanged).
func (r *LegalRequestRepository) UpdateStatusGuarded(ctx context.Context, q Queryer, tenantID, id uuid.UUID, expectedFrom, to model.RequestStatus, expectedLockVersion *int64, workflowInstanceID *uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_requests
		SET status = $4,
		    workflow_instance_id = COALESCE($5, workflow_instance_id),
		    lock_version = lock_version + 1,
		    updated_at = now()
		WHERE tenant_id = $1
		  AND id = $2
		  AND status = $3
		  AND ($6::bigint IS NULL OR lock_version = $6)
		  AND deleted_at IS NULL`,
		tenantID, id, expectedFrom, to, workflowInstanceID, expectedLockVersion,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		// Disambiguate not-found from precondition-failed: probe for the live row.
		var exists bool
		probeErr := q.QueryRow(ctx, `
			SELECT true
			FROM legal_requests
			WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
			tenantID, id,
		).Scan(&exists)
		if probeErr == pgx.ErrNoRows {
			return pgx.ErrNoRows
		}
		if probeErr != nil {
			return probeErr
		}
		return ErrStatusConflict
	}
	return nil
}

// LinkSubject back-links a spawned domain row (case/consultation) onto the
// request spine inside the caller's transaction (CAP-009 subject_type/subject_id).
// It is status-agnostic but tenant-scoped and soft-delete aware. 0 rows affected
// surfaces as pgx.ErrNoRows.
func (r *LegalRequestRepository) LinkSubject(ctx context.Context, q Queryer, tenantID, id uuid.UUID, subjectType string, subjectID uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_requests
		SET subject_type = $3,
		    subject_id = $4,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, subjectType, subjectID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// FindCaseByRequest returns the id of a non-deleted legal_case already spawned
// from this request, if any. Used to make routed→spawn idempotent (a retried
// route must not create a duplicate case). pgx.ErrNoRows means none exists.
func (r *LegalRequestRepository) FindCaseByRequest(ctx context.Context, q Queryer, tenantID, requestID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := q.QueryRow(ctx, `
		SELECT id FROM legal_cases
		WHERE tenant_id = $1 AND request_id = $2 AND deleted_at IS NULL
		ORDER BY created_at ASC
		LIMIT 1`,
		tenantID, requestID,
	).Scan(&id)
	return id, err
}

// FindConsultationByRequest returns the id of a non-deleted consultation already
// spawned from this request, if any. Mirrors FindCaseByRequest for the opinion
// path. pgx.ErrNoRows means none exists.
func (r *LegalRequestRepository) FindConsultationByRequest(ctx context.Context, q Queryer, tenantID, requestID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := q.QueryRow(ctx, `
		SELECT id FROM legal_consultations
		WHERE tenant_id = $1 AND legal_request_id = $2 AND deleted_at IS NULL
		ORDER BY created_at ASC
		LIMIT 1`,
		tenantID, requestID,
	).Scan(&id)
	return id, err
}

// FindContractByRequest returns the id of a non-deleted contract already spawned
// from this request. Contracts predate the typed spine FK, so the exact request
// UUID is retained in metadata until a dedicated column is introduced.
func (r *LegalRequestRepository) FindContractByRequest(ctx context.Context, q Queryer, tenantID, requestID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := q.QueryRow(ctx, `
		SELECT id FROM contracts
		WHERE tenant_id = $1
		  AND metadata->>'legal_request_id' = $2
		  AND deleted_at IS NULL
		ORDER BY created_at ASC
		LIMIT 1`,
		tenantID, requestID.String(),
	).Scan(&id)
	return id, err
}

// ActorAssignedToSubject reports whether actorID is explicitly assigned to the
// downstream work item linked from a legal request. This lets a handling lawyer
// review the originating evidence without granting every tenant-wide provider
// who can see the request list access to its files.
func (r *LegalRequestRepository) ActorAssignedToSubject(ctx context.Context, tenantID, actorID uuid.UUID, subjectType string, subjectID uuid.UUID) (bool, error) {
	if actorID == uuid.Nil || subjectID == uuid.Nil {
		return false, nil
	}
	var allowed bool
	switch strings.ToLower(strings.TrimSpace(subjectType)) {
	case "legal_case", "case", "litigation":
		err := r.db.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM legal_cases
				WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
				  AND $3 IN (section_manager_id, supervisor_id, handling_officer_id)
			)`, tenantID, subjectID, actorID).Scan(&allowed)
		return allowed, err
	case "consultation", "legal_consultation":
		err := r.db.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM legal_consultations
				WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
				  AND advisor_id = $3
			)`, tenantID, subjectID, actorID).Scan(&allowed)
		return allowed, err
	case "contract", "legal_contract":
		err := r.db.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM legal_contracts
				WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
				  AND legal_reviewer_id = $3
			)`, tenantID, subjectID, actorID).Scan(&allowed)
		return allowed, err
	default:
		return false, nil
	}
}

// UpdatePriority writes the new priority + urgency justification on the request
// row. The audited history row is appended separately via InsertPriorityChange,
// typically in the same transaction.
func (r *LegalRequestRepository) UpdatePriority(ctx context.Context, q Queryer, tenantID, id uuid.UUID, priority model.RequestPriority, urgencyJustification *string) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_requests
		SET priority = $3,
		    urgency_justification = $4,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, priority, urgencyJustification,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LegalRequestRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_requests SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// InsertPriorityChange appends an immutable CAP-011 reclassification audit row.
// Accepts a Queryer so it can run inside the reclassify transaction alongside
// the request-row priority update.
func (r *LegalRequestRepository) InsertPriorityChange(ctx context.Context, q Queryer, change *model.LegalRequestPriorityChange) error {
	query := `
		INSERT INTO legal_request_priority_changes (
			id, tenant_id, request_id, from_priority, to_priority, reason, changed_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING changed_at`
	return q.QueryRow(ctx, query,
		change.ID, change.TenantID, change.RequestID, change.FromPriority, change.ToPriority,
		change.Reason, change.ChangedBy,
	).Scan(&change.ChangedAt)
}

// ListPriorityChanges returns the full reclassification history for a request,
// newest first.
func (r *LegalRequestRepository) ListPriorityChanges(ctx context.Context, tenantID, requestID uuid.UUID) ([]model.LegalRequestPriorityChange, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT pc.id, pc.tenant_id, pc.request_id, pc.from_priority, pc.to_priority,
			       pc.reason, pc.changed_by, pc.changed_at
			FROM legal_request_priority_changes pc
			WHERE pc.tenant_id = $1 AND pc.request_id = $2
			ORDER BY pc.changed_at DESC
		) t`
	return queryListJSON[model.LegalRequestPriorityChange](ctx, r.db, query, tenantID, requestID)
}

func legalRequestJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT lr.id, lr.tenant_id, lr.request_number, lr.request_type, lr.service_id,
			       lr.title, lr.description, lr.requester_user_id, lr.requester_name,
			       lr.beneficiary_entity_id, lr.department, lr.priority, lr.status, lr.cycle,
			       lr.urgency_justification, lr.requester_approval_required,
			       lr.provider_approval_required, lr.subject_type, lr.subject_id,
			       lr.workflow_instance_id, COALESCE(lr.metadata, '{}'::jsonb) AS metadata,
			       lr.created_by, lr.created_at, lr.updated_at, lr.deleted_at
			FROM legal_requests lr
			WHERE ` + where + `
		) t`
}

func legalRequestSortColumn(column string) (string, bool) {
	switch column {
	case "lr.request_number":
		return "t.request_number", true
	case "lr.status":
		return "t.status", true
	case "lr.priority":
		return "t.priority", true
	case "lr.request_type":
		return "t.request_type", true
	case "lr.updated_at":
		return "t.updated_at", true
	case "lr.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
