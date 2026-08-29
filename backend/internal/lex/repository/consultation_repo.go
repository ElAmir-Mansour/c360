package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ConsultationRepository persists legal consultations (CAP-126..132), their
// Files-service document links, and the immutable governance audit log. Queries
// filter by tenant_id (primary predicate) with table RLS as a backstop, mirroring
// the other lex repositories. Reads project rows through row_to_json so the
// bilingual title (forms.LocalizedText) and jsonb metadata round-trip via
// json.Unmarshal. Writes that participate in a transaction accept a Queryer so the
// consultation row, its document/audit side-effects, and any spine update commit
// atomically.
type ConsultationRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewConsultationRepository(db *pgxpool.Pool, logger zerolog.Logger) *ConsultationRepository {
	return &ConsultationRepository{db: db, logger: logger}
}

func (r *ConsultationRepository) Create(ctx context.Context, q Queryer, c *model.Consultation) error {
	titleJSON, err := json.Marshal(c.Title)
	if err != nil {
		return fmt.Errorf("marshal consultation title: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal consultation metadata: %w", err)
	}
	query := `
		INSERT INTO legal_consultations (
			id, tenant_id, consultation_number, type, title, status, priority,
			legal_request_id, requester_user_id, requester_name, department,
			advisor_id, advisor_name, question, response, workflow_instance_id,
			responded_by, responded_at, approved_by, approved_at, archived_at,
			tags, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5::jsonb,$6,$7,
			$8,$9,$10,$11,
			$12,$13,$14,$15,$16,
			$17,$18,$19,$20,$21,
			$22,$23::jsonb,$24
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		c.ID, c.TenantID, c.ConsultationNumber, c.Type, titleJSON, c.Status, c.Priority,
		c.LegalRequestID, c.RequesterUserID, c.RequesterName, c.Department,
		c.AdvisorID, c.AdvisorName, c.Question, c.Response, c.WorkflowInstanceID,
		c.RespondedBy, c.RespondedAt, c.ApprovedBy, c.ApprovedAt, c.ArchivedAt,
		c.Tags, metaJSON, c.CreatedBy,
	).Scan(&c.CreatedAt, &c.UpdatedAt)
}

func (r *ConsultationRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.Consultation, error) {
	query := consultationJSONSelect(`lc.tenant_id = $1 AND lc.id = $2 AND lc.deleted_at IS NULL`)
	return queryRowJSON[model.Consultation](ctx, r.db, query, tenantID, id)
}

// consultationFilterClauses translates the list filters into a parameterised WHERE
// clause (without the WHERE keyword) plus its positional args. It is shared by
// List, Count, and Stats so all three see the identical filtered population. The
// returned args always begin with tenantID at $1; nextArg is the next free
// placeholder index (for callers that append LIMIT/OFFSET).
func consultationFilterClauses(tenantID uuid.UUID, filters model.ConsultationListFilters, now time.Time) (where string, args []any, nextArg int) {
	args = []any{tenantID}
	arg := 2
	conditions := []string{"lc.tenant_id = $1", "lc.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(lc.title->>'ar' ILIKE '%%' || $%d || '%%' OR lc.title->>'en' ILIKE '%%' || $%d || '%%' OR lc.question ILIKE '%%' || $%d || '%%' OR lc.consultation_number ILIKE '%%' || $%d || '%%')", arg, arg, arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("lc.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if len(filters.Statuses) > 0 {
		statuses := make([]string, 0, len(filters.Statuses))
		for _, status := range filters.Statuses {
			statuses = append(statuses, string(status))
		}
		conditions = append(conditions, fmt.Sprintf("lc.status = ANY($%d)", arg))
		args = append(args, statuses)
		arg++
	}
	if filters.Type != nil {
		conditions = append(conditions, fmt.Sprintf("lc.type = $%d", arg))
		args = append(args, *filters.Type)
		arg++
	}
	if filters.Priority != nil {
		conditions = append(conditions, fmt.Sprintf("lc.priority = $%d", arg))
		args = append(args, *filters.Priority)
		arg++
	}
	if filters.RequesterUserID != nil {
		conditions = append(conditions, fmt.Sprintf("lc.requester_user_id = $%d", arg))
		args = append(args, *filters.RequesterUserID)
		arg++
	}
	if filters.AdvisorID != nil {
		conditions = append(conditions, fmt.Sprintf("lc.advisor_id = $%d", arg))
		args = append(args, *filters.AdvisorID)
		arg++
	}
	if filters.LegalRequestID != nil {
		conditions = append(conditions, fmt.Sprintf("lc.legal_request_id = $%d", arg))
		args = append(args, *filters.LegalRequestID)
		arg++
	}
	if filters.Department != "" {
		conditions = append(conditions, fmt.Sprintf("lc.department = $%d", arg))
		args = append(args, filters.Department)
		arg++
	}
	if filters.Tag != "" {
		conditions = append(conditions, fmt.Sprintf("$%d = ANY(lc.tags)", arg))
		args = append(args, strings.ToLower(strings.TrimSpace(filters.Tag)))
		arg++
	}
	if filters.CreatedFrom != nil {
		conditions = append(conditions, fmt.Sprintf("lc.created_at >= $%d", arg))
		args = append(args, *filters.CreatedFrom)
		arg++
	}
	if filters.CreatedTo != nil {
		conditions = append(conditions, fmt.Sprintf("lc.created_at <= $%d", arg))
		args = append(args, *filters.CreatedTo)
		arg++
	}
	if filters.RespondedFrom != nil {
		conditions = append(conditions, fmt.Sprintf("lc.responded_at >= $%d", arg))
		args = append(args, *filters.RespondedFrom)
		arg++
	}
	if filters.RespondedTo != nil {
		conditions = append(conditions, fmt.Sprintf("lc.responded_at <= $%d", arg))
		args = append(args, *filters.RespondedTo)
		arg++
	}
	// SLA-risk filter. due_soon/on_track key off `now` (a clock-hours window); the
	// $now placeholder is reused across the breached/due_soon predicates.
	switch model.ConsultationSLARisk(filters.SLARisk) {
	case model.ConsultationSLARiskBreached:
		conditions = append(conditions, "(lc.sla_breached = TRUE OR lc.sla_outcome = 'breached')")
	case model.ConsultationSLARiskDueSoon:
		nowIdx := arg
		args = append(args, now)
		arg++
		conditions = append(conditions, fmt.Sprintf(consultationDueSoonPredicate, nowIdx, nowIdx, nowIdx))
	case model.ConsultationSLARiskOnTrack:
		nowIdx := arg
		args = append(args, now)
		arg++
		// On-track = on-clock, unresolved, not breached, and NOT due_soon.
		conditions = append(conditions, "lc.sla_started_at IS NOT NULL AND lc.sla_outcome = 'pending' AND lc.sla_breached = FALSE")
		conditions = append(conditions, fmt.Sprintf("NOT ("+consultationDueSoonPredicate+")", nowIdx, nowIdx, nowIdx))
	}
	return strings.Join(conditions, " AND "), args, arg
}

// consultationDueSoonPredicate is the "due_soon" SLA window: the clock is started,
// the outcome is still pending, the consultation is not already breached, and the
// response deadline falls in (now, now + 24h]. The three %d are all the `now`
// placeholder index. Window is 24 CLOCK hours (not working hours) by design — the
// SLA monitor for working-hour escalation is out of scope here.
const consultationDueSoonPredicate = `lc.sla_started_at IS NOT NULL
	AND lc.sla_outcome = 'pending'
	AND lc.sla_breached = FALSE
	AND lc.sla_response_due_at IS NOT NULL
	AND lc.sla_response_due_at > $%d
	AND lc.sla_response_due_at <= ($%d::timestamptz + INTERVAL '24 hours')
	AND $%d IS NOT NULL`

func (r *ConsultationRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.ConsultationListFilters, now time.Time) ([]model.Consultation, int, error) {
	where, args, arg := consultationFilterClauses(tenantID, filters, now)
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_consultations lc WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.Consultation{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := consultationSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := consultationJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.Consultation](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// Stats returns the aggregate KPI rollup over the SAME filtered population as
// List (one grouped scan + a due_soon count). It honours every list filter so the
// cards reflect the active filter set, not the unfiltered tenant total. The
// duration-fact averages (time-to-respond) are layered in by the service.
func (r *ConsultationRepository) Stats(ctx context.Context, tenantID uuid.UUID, filters model.ConsultationListFilters, now time.Time) (*model.ConsultationStats, error) {
	where, args, arg := consultationFilterClauses(tenantID, filters, now)
	nowIdx := arg
	args = append(args, now)
	query := fmt.Sprintf(`
		SELECT
		  COUNT(*) AS total,
		  COUNT(*) FILTER (WHERE lc.status IN ('submitted','classified','routed')) AS open,
		  COUNT(*) FILTER (WHERE lc.status = 'responded') AS responded,
		  COUNT(*) FILTER (WHERE lc.status IN ('approved','archived')) AS approved,
		  COUNT(*) FILTER (WHERE lc.sla_breached = TRUE OR lc.sla_outcome = 'breached') AS breached,
		  COUNT(*) FILTER (WHERE %s) AS due_soon
		FROM legal_consultations lc
		WHERE %s`,
		fmt.Sprintf(consultationDueSoonPredicate, nowIdx, nowIdx, nowIdx), where)
	var stats model.ConsultationStats
	if err := r.db.QueryRow(ctx, query, args...).Scan(
		&stats.Total, &stats.Open, &stats.Responded, &stats.Approved, &stats.Breached, &stats.DueSoon,
	); err != nil {
		return nil, err
	}
	return &stats, nil
}

// DistinctTags returns the sorted, de-duplicated set of tags used across the
// tenant's (non-deleted) consultations, for autocomplete + filter chips.
func (r *ConsultationRepository) DistinctTags(ctx context.Context, tenantID uuid.UUID) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT tag
		FROM legal_consultations lc, unnest(lc.tags) AS tag
		WHERE lc.tenant_id = $1 AND lc.deleted_at IS NULL AND tag <> ''
		ORDER BY tag ASC`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, err
		}
		out = append(out, tag)
	}
	return out, rows.Err()
}

// AdvisorWorkload returns the open-consultation counts grouped by advisor (open =
// not approved/archived and not deleted). Consultations with no advisor are
// excluded. Ordered by open_count desc, then advisor name.
func (r *ConsultationRepository) AdvisorWorkload(ctx context.Context, tenantID uuid.UUID) ([]model.ConsultationAdvisorWorkload, error) {
	rows, err := r.db.Query(ctx, `
		SELECT lc.advisor_id,
		       COALESCE(MAX(lc.advisor_name), '') AS advisor_name,
		       COUNT(*) AS open_count
		FROM legal_consultations lc
		WHERE lc.tenant_id = $1
		  AND lc.deleted_at IS NULL
		  AND lc.advisor_id IS NOT NULL
		  AND lc.status NOT IN ('approved','archived')
		GROUP BY lc.advisor_id
		ORDER BY open_count DESC, advisor_name ASC`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.ConsultationAdvisorWorkload, 0)
	for rows.Next() {
		var w model.ConsultationAdvisorWorkload
		if err := rows.Scan(&w.AdvisorID, &w.AdvisorName, &w.OpenCount); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// UpdateClassification advances submitted → classified, setting type + priority.
func (r *ConsultationRepository) UpdateClassification(ctx context.Context, q Queryer, tenantID, id uuid.UUID, cType model.ConsultationType, priority model.LegalPriority, status model.ConsultationStatus) error {
	return r.execOne(ctx, q, `
		UPDATE legal_consultations
		SET type = $3, priority = $4, status = $5, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, cType, priority, status)
}

// UpdateRoute advances classified → routed, assigning the advisor.
func (r *ConsultationRepository) UpdateRoute(ctx context.Context, q Queryer, tenantID, id uuid.UUID, advisorID uuid.UUID, advisorName *string, status model.ConsultationStatus) error {
	return r.execOne(ctx, q, `
		UPDATE legal_consultations
		SET advisor_id = $3, advisor_name = $4, status = $5, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, advisorID, advisorName, status)
}

// UpdateResponse advances routed → responded, recording the answer + author.
func (r *ConsultationRepository) UpdateResponse(ctx context.Context, q Queryer, tenantID, id uuid.UUID, response string, respondedBy uuid.UUID, respondedAt time.Time, status model.ConsultationStatus, lateJustification, managerRole *string) error {
	return r.execOne(ctx, q, `
		UPDATE legal_consultations
		SET response = $3, responded_by = $4, responded_at = $5, status = $6,
		    late_justification = $7,
		    late_justification_submitted_by = CASE WHEN $7::text IS NULL THEN NULL ELSE $4 END,
		    late_justification_submitted_at = CASE WHEN $7::text IS NULL THEN NULL ELSE $5 END,
		    late_justification_manager_role = $8,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, response, respondedBy, respondedAt, status, lateJustification, managerRole)
}

// SetWorkflowInstance links the approval workflow onto the consultation (CAP-131).
func (r *ConsultationRepository) SetWorkflowInstance(ctx context.Context, q Queryer, tenantID, id uuid.UUID, workflowInstanceID *uuid.UUID) error {
	return r.execOne(ctx, q, `
		UPDATE legal_consultations
		SET workflow_instance_id = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, workflowInstanceID)
}

// UpdateStatus sets the status (used by the approval FSM hook to move responded →
// approved on sign-off, clearing the workflow link).
func (r *ConsultationRepository) UpdateStatus(ctx context.Context, q Queryer, tenantID, id uuid.UUID, status model.ConsultationStatus, approvedBy *uuid.UUID, approvedAt *time.Time, clearWorkflow bool) error {
	return r.execOne(ctx, q, `
		UPDATE legal_consultations
		SET status = $3,
		    approved_by = COALESCE($4, approved_by),
		    approved_at = COALESCE($5, approved_at),
		    workflow_instance_id = CASE WHEN $6 THEN NULL ELSE workflow_instance_id END,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, status, approvedBy, approvedAt, clearWorkflow)
}

// Archive advances approved → archived (CAP-132), stamping archived_at.
func (r *ConsultationRepository) Archive(ctx context.Context, q Queryer, tenantID, id uuid.UUID, archivedAt time.Time) error {
	return r.execOne(ctx, q, `
		UPDATE legal_consultations
		SET status = 'archived', archived_at = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, archivedAt)
}

// UpdateTags overwrites the consultation's tag set (the service computes the final
// set for add/replace before calling). Tag changes are metadata, not an FSM edge, so
// no status guard is applied.
func (r *ConsultationRepository) UpdateTags(ctx context.Context, q Queryer, tenantID, id uuid.UUID, tags []string) error {
	return r.execOne(ctx, q, `
		UPDATE legal_consultations
		SET tags = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, tags)
}

func (r *ConsultationRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_consultations SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// LockForStatus locks the consultation row FOR UPDATE inside the caller's tx and
// returns its current status. It is the concurrency guard for approve/archive:
// callers re-read the status under the row lock so two concurrent mutations cannot
// both pass the FSM gate. pgx.ErrNoRows means the row is missing or soft-deleted.
func (r *ConsultationRepository) LockForStatus(ctx context.Context, q Queryer, tenantID, id uuid.UUID) (model.ConsultationStatus, error) {
	var status model.ConsultationStatus
	err := q.QueryRow(ctx, `
		SELECT status
		FROM legal_consultations
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, id,
	).Scan(&status)
	return status, err
}

// --- consultation SLA clock (WS3) -------------------------------------------

// ConsultationSLASnapshot is the self-contained ack + response clock state stored
// on the consultation aggregate (migration _staging/000039). It is read/written by
// dedicated SLA methods so the consultation model struct stays untouched; reads
// tolerate the columns being absent on a not-yet-migrated DB (see GetSLASnapshot).
type ConsultationSLASnapshot struct {
	StartedAt       *time.Time
	AckDueAt        *time.Time
	ResponseDueAt   *time.Time
	AckDone         bool
	AckDoneAt       *time.Time
	EscalationLevel int
	Breached        bool
	BreachedAt      *time.Time
	Outcome         model.SLAClockOutcome
	ResolvedAt      *time.Time
	TargetMinutes   *int
}

// GetSLASnapshot reads the consultation's SLA clock state. A consultation that has
// never had a clock materialised reports Outcome=pending with nil deadlines.
func (r *ConsultationRepository) GetSLASnapshot(ctx context.Context, q Queryer, tenantID, id uuid.UUID) (*ConsultationSLASnapshot, error) {
	var snap ConsultationSLASnapshot
	var outcome *string
	err := q.QueryRow(ctx, `
		SELECT sla_started_at, sla_ack_due_at, sla_response_due_at, sla_ack_done,
		       sla_ack_done_at, sla_escalation_level, sla_breached, sla_breached_at,
		       sla_outcome, sla_resolved_at, sla_target_minutes
		FROM legal_consultations
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id,
	).Scan(
		&snap.StartedAt, &snap.AckDueAt, &snap.ResponseDueAt, &snap.AckDone,
		&snap.AckDoneAt, &snap.EscalationLevel, &snap.Breached, &snap.BreachedAt,
		&outcome, &snap.ResolvedAt, &snap.TargetMinutes,
	)
	if err != nil {
		return nil, err
	}
	if outcome != nil {
		snap.Outcome = model.SLAClockOutcome(*outcome)
	} else {
		snap.Outcome = model.SLAClockOutcomePending
	}
	return &snap, nil
}

// StartSLAClock materialises (once) the ack + response deadlines for the
// consultation. The guard `sla_started_at IS NULL` makes a repeated start a no-op
// (0 rows affected → pgx.ErrNoRows), so submit and a later route never double-start.
func (r *ConsultationRepository) StartSLAClock(ctx context.Context, q Queryer, tenantID, id uuid.UUID, snap ConsultationSLASnapshot) error {
	return r.execOne(ctx, q, `
		UPDATE legal_consultations
		SET sla_started_at      = $3,
		    sla_ack_due_at       = $4,
		    sla_response_due_at  = $5,
		    sla_target_minutes   = $6,
		    sla_outcome          = 'pending',
		    updated_at           = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		  AND sla_started_at IS NULL`,
		tenantID, id, snap.StartedAt, snap.AckDueAt, snap.ResponseDueAt, snap.TargetMinutes)
}

// MarkSLAAcknowledged satisfies the ack rung (advisor routed). Idempotent: the
// guard `sla_ack_done = FALSE` makes a repeat a no-op (pgx.ErrNoRows). A clock that
// was never started is a no-op too (sla_started_at NULL guard).
func (r *ConsultationRepository) MarkSLAAcknowledged(ctx context.Context, q Queryer, tenantID, id uuid.UUID, ackedAt time.Time) error {
	return r.execOne(ctx, q, `
		UPDATE legal_consultations
		SET sla_ack_done    = TRUE,
		    sla_ack_done_at  = $3,
		    updated_at       = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		  AND sla_started_at IS NOT NULL
		  AND sla_ack_done = FALSE`,
		tenantID, id, ackedAt)
}

// ResolveSLAOutcome stamps the terminal on_time/breached verdict. Idempotent: the
// guard `sla_outcome = 'pending'` makes a second resolution a no-op (pgx.ErrNoRows),
// so a re-archive or re-approve never re-stamps. A consultation that never started a
// clock is skipped by the `sla_started_at IS NOT NULL` guard.
func (r *ConsultationRepository) ResolveSLAOutcome(ctx context.Context, q Queryer, tenantID, id uuid.UUID, outcome model.SLAClockOutcome, resolvedAt time.Time) error {
	return r.execOne(ctx, q, `
		UPDATE legal_consultations
		SET sla_outcome     = $3,
		    sla_resolved_at  = $4,
		    sla_breached     = (sla_breached OR $3 = 'breached'),
		    sla_breached_at  = CASE WHEN $3 = 'breached' AND sla_breached_at IS NULL THEN $4 ELSE sla_breached_at END,
		    updated_at       = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		  AND sla_started_at IS NOT NULL
		  AND sla_outcome = 'pending'`,
		tenantID, id, outcome, resolvedAt)
}

func (r *ConsultationRepository) execOne(ctx context.Context, q Queryer, sql string, args ...any) error {
	ct, err := q.Exec(ctx, sql, args...)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- documents (CAP-128) ----------------------------------------------------

func (r *ConsultationRepository) AttachDocument(ctx context.Context, q Queryer, doc *model.ConsultationDocument) error {
	metaJSON, err := json.Marshal(orEmptyMap(doc.Metadata))
	if err != nil {
		return fmt.Errorf("marshal consultation document metadata: %w", err)
	}
	query := `
		INSERT INTO legal_consultation_documents (
			id, tenant_id, consultation_id, file_id, file_name, file_size,
			content_type, kind, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		doc.ID, doc.TenantID, doc.ConsultationID, doc.FileID, doc.FileName, doc.FileSize,
		doc.ContentType, doc.Kind, metaJSON, doc.CreatedBy,
	).Scan(&doc.CreatedAt)
}

func (r *ConsultationRepository) DetachDocument(ctx context.Context, tenantID, consultationID, documentID uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `DELETE FROM legal_consultation_documents WHERE tenant_id = $1 AND consultation_id = $2 AND id = $3`, tenantID, consultationID, documentID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ConsultationRepository) ListDocuments(ctx context.Context, tenantID, consultationID uuid.UUID) ([]model.ConsultationDocument, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT d.id, d.tenant_id, d.consultation_id, d.file_id, d.file_name, d.file_size,
			       d.content_type, d.kind, COALESCE(d.metadata, '{}'::jsonb) AS metadata,
			       d.created_by, d.created_at
			FROM legal_consultation_documents d
			WHERE d.tenant_id = $1 AND d.consultation_id = $2
			ORDER BY d.created_at DESC
		) t`
	return queryListJSON[model.ConsultationDocument](ctx, r.db, query, tenantID, consultationID)
}

// --- governance audit (append-only) -----------------------------------------

func (r *ConsultationRepository) AppendAudit(ctx context.Context, q Queryer, entry *model.ConsultationAuditEntry) error {
	detailJSON, err := json.Marshal(orEmptyMap(entry.Detail))
	if err != nil {
		return fmt.Errorf("marshal consultation audit detail: %w", err)
	}
	query := `
		INSERT INTO legal_consultation_audit_log (
			id, tenant_id, consultation_id, action, from_status, to_status, detail, actor_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.ConsultationID, entry.Action,
		entry.FromStatus, entry.ToStatus, detailJSON, entry.ActorUserID,
	).Scan(&entry.CreatedAt)
}

func (r *ConsultationRepository) ListAudit(ctx context.Context, tenantID, consultationID uuid.UUID) ([]model.ConsultationAuditEntry, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT a.id, a.tenant_id, a.consultation_id, a.action, a.from_status, a.to_status,
			       COALESCE(a.detail, '{}'::jsonb) AS detail, a.actor_user_id, a.created_at
			FROM legal_consultation_audit_log a
			WHERE a.tenant_id = $1 AND a.consultation_id = $2
			ORDER BY a.created_at DESC
		) t`
	return queryListJSON[model.ConsultationAuditEntry](ctx, r.db, query, tenantID, consultationID)
}

func consultationJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT lc.id, lc.tenant_id, lc.consultation_number, lc.type, lc.title, lc.status,
			       lc.priority, lc.legal_request_id, lc.requester_user_id, lc.requester_name,
			       lc.department, lc.advisor_id, lc.advisor_name, lc.question, lc.response,
			       lc.workflow_instance_id, lc.responded_by, lc.responded_at, lc.approved_by,
			       lc.approved_at, lc.archived_at, COALESCE(lc.tags, '{}') AS tags,
			       COALESCE(lc.metadata, '{}'::jsonb) AS metadata,
			       lc.created_by, lc.created_at, lc.updated_at, lc.deleted_at,
			       lc.sla_started_at, lc.sla_ack_due_at, lc.sla_response_due_at, lc.sla_ack_done,
			       lc.sla_ack_done_at, lc.sla_escalation_level, lc.sla_breached, lc.sla_breached_at,
			       lc.sla_outcome, lc.sla_resolved_at, lc.sla_target_minutes
			       , lc.late_justification, lc.late_justification_submitted_by,
			       lc.late_justification_submitted_at, lc.late_justification_manager_role
			FROM legal_consultations lc
			WHERE ` + where + `
		) t`
}

func consultationSortColumn(column string) (string, bool) {
	switch column {
	case "lc.consultation_number":
		return "t.consultation_number", true
	case "lc.status":
		return "t.status", true
	case "lc.type":
		return "t.type", true
	case "lc.priority":
		return "t.priority", true
	case "lc.updated_at":
		return "t.updated_at", true
	case "lc.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
