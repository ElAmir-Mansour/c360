package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// LegalJudgmentRepository persists court judgments on litigation cases (CAP-063..066).
// On an objection recommendation the service creates a linked legal_obligation (via
// CreateLinkedObligation here) so the EXISTING obligation reminder outbox fires the
// objection deadline — no new timer is added. legal_obligations is extended (staged
// migration) with a nullable case_id and a relaxed link CHECK so a case-bound
// objection obligation is valid even without a contract/matter link.
type LegalJudgmentRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger

	// reconcileLinkCheckOnce drops the stale, un-relaxed legal_obligations link
	// CHECK at most once per process before the first objection-obligation insert.
	// See reconcileObligationLinkCheck for why this runtime reconcile is needed.
	reconcileLinkCheckOnce sync.Once
}

func NewLegalJudgmentRepository(db *pgxpool.Pool, logger zerolog.Logger) *LegalJudgmentRepository {
	return &LegalJudgmentRepository{db: db, logger: logger}
}

func (r *LegalJudgmentRepository) Create(ctx context.Context, q Queryer, j *model.LegalJudgment) error {
	metaJSON, err := json.Marshal(orEmptyMap(j.Metadata))
	if err != nil {
		return fmt.Errorf("marshal judgment metadata: %w", err)
	}
	query := `
		INSERT INTO legal_judgments (
			id, tenant_id, case_id, judgment_ref, judgment_date, decision_type, impact,
			judge_name, court_name, outcome, summary, implications,
			study_notes, recommendation, objection_deadline, obligation_id,
			studied_by, studied_at, file_id, document_reference,
			next_expected_ruling_at, next_expected_ruling, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12,
			$13,$14,$15,$16,
			$17,$18,$19,$20,$21,$22,$23::jsonb,$24
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		j.ID, j.TenantID, j.CaseID, j.JudgmentRef, lexDatePtr(j.JudgmentDate),
		j.DecisionType, j.Impact, j.JudgeName, j.CourtName, j.Outcome, j.Summary,
		j.Implications, j.StudyNotes, j.Recommendation, lexDatePtr(j.ObjectionDeadline),
		j.ObligationID, j.StudiedBy, j.StudiedAt, j.FileID, j.DocumentReference,
		j.NextExpectedRulingAt, j.NextExpectedRuling, metaJSON, j.CreatedBy,
	).Scan(&j.CreatedAt, &j.UpdatedAt)
}

func (r *LegalJudgmentRepository) Get(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.LegalJudgment, error) {
	query := judgmentJSONSelect(`j.tenant_id = $1 AND j.case_id = $2 AND j.id = $3 AND j.deleted_at IS NULL`)
	return queryRowJSON[model.LegalJudgment](ctx, r.db, query, tenantID, caseID, id)
}

func (r *LegalJudgmentRepository) List(ctx context.Context, tenantID, caseID uuid.UUID, filters model.LegalJudgmentListFilters) ([]model.LegalJudgment, int, error) {
	args := []any{tenantID, caseID}
	arg := 3
	conditions := []string{"j.tenant_id = $1", "j.case_id = $2", "j.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(j.judgment_ref ILIKE '%%' || $%d || '%%' OR j.summary ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Recommendation != nil {
		conditions = append(conditions, fmt.Sprintf("j.recommendation = $%d", arg))
		args = append(args, *filters.Recommendation)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_judgments j WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.LegalJudgment{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := judgmentSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := judgmentJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.LegalJudgment](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// UpdateStudy records the study outcome + recommendation + objection deadline +
// linked obligation inside a transaction (CAP-064..066).
func (r *LegalJudgmentRepository) UpdateStudy(ctx context.Context, q Queryer, j *model.LegalJudgment) error {
	metaJSON, err := json.Marshal(orEmptyMap(j.Metadata))
	if err != nil {
		return fmt.Errorf("marshal judgment metadata: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_judgments
		SET study_notes = $4,
		    recommendation = $5,
		    objection_deadline = $6,
		    obligation_id = $7,
		    studied_by = $8,
		    studied_at = $9,
		    implications = $10,
		    next_expected_ruling_at = $11,
		    next_expected_ruling = $12,
		    metadata = $13::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`,
		j.TenantID, j.CaseID, j.ID, j.StudyNotes, j.Recommendation, lexDatePtr(j.ObjectionDeadline),
		j.ObligationID, j.StudiedBy, j.StudiedAt, j.Implications,
		j.NextExpectedRulingAt, j.NextExpectedRuling, metaJSON,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LegalJudgmentRepository) SoftDelete(ctx context.Context, tenantID, caseID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_judgments SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`, tenantID, caseID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// JudgmentStudyLock is the locked study state of a judgment, returned by
// LockForStudy. StudiedAt non-nil means the judgment was already studied, so a
// concurrent StudyJudgment is rejected as an idempotent no-op rather than racing a
// duplicate obligation.
type JudgmentStudyLock struct {
	CaseID    uuid.UUID
	StudiedAt *time.Time
	StudiedBy *uuid.UUID
}

// LockForStudy SELECT ... FOR UPDATE locks the judgment row inside the study
// transaction and returns its current study state. The lock serializes concurrent
// StudyJudgment calls so the studied_at guard + the linked-obligation insert are
// race-free. pgx.ErrNoRows => not found / deleted.
func (r *LegalJudgmentRepository) LockForStudy(ctx context.Context, q Queryer, tenantID, caseID, id uuid.UUID) (*JudgmentStudyLock, error) {
	var lock JudgmentStudyLock
	err := q.QueryRow(ctx, `
		SELECT case_id, studied_at, studied_by
		FROM legal_judgments
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, caseID, id,
	).Scan(&lock.CaseID, &lock.StudiedAt, &lock.StudiedBy)
	if err != nil {
		return nil, err
	}
	return &lock, nil
}

// CreateLinkedObligation inserts a case-linked legal_obligations row (with the staged
// case_id + judgment_id columns) so the existing obligation reminder outbox fires the
// objection deadline. The judgment_id link is guarded by a partial-unique index
// (uq_legal_obligations_judgment_live) so AT MOST ONE live objection obligation can
// exist per judgment — a racing duplicate insert returns a unique violation that the
// service maps to the idempotent already-studied conflict. Runs inside the study
// transaction.
func (r *LegalJudgmentRepository) CreateLinkedObligation(ctx context.Context, q Queryer, o *model.Obligation, caseID, judgmentID uuid.UUID) error {
	// A case-bound objection obligation carries case_id only (no contract/matter).
	// Migration 000027 relaxed the link CHECK to admit a case_id link but, on some
	// databases, failed to drop the original un-relaxed CHECK (see
	// reconcileObligationLinkCheck), leaving a stale constraint that rejects this
	// insert. Complete that reconcile lazily before the first insert so the row is
	// validated only by the relaxed chk_legal_obligations_link constraint.
	if err := r.reconcileObligationLinkCheck(ctx); err != nil {
		return err
	}
	metaJSON, err := json.Marshal(orEmptyMap(o.Metadata))
	if err != nil {
		return fmt.Errorf("marshal objection obligation metadata: %w", err)
	}
	query := `
		INSERT INTO legal_obligations (
			id, tenant_id, case_id, judgment_id, title, description, type, status, priority,
			owner_user_id, owner_name, due_date,
			reminder_enabled, reminder_lead_days, escalation_enabled, escalation_lead_days, escalation_target,
			tags, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,
			$10,$11,$12,
			$13,$14,$15,$16,$17,
			$18,$19::jsonb,$20
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		o.ID, o.TenantID, caseID, judgmentID, o.Title, o.Description, o.Type, o.Status, o.Priority,
		o.OwnerUserID, o.OwnerName, lexDatePtr(&o.DueDate),
		o.ReminderEnabled, int32Slice(o.ReminderLeadDays), o.EscalationEnabled, int32Slice(o.EscalationLeadDays), o.EscalationTarget,
		o.Tags, metaJSON, o.CreatedBy,
	).Scan(&o.CreatedAt, &o.UpdatedAt)
}

// reconcileObligationLinkCheck completes migration 000027's intent at runtime:
// drop the original un-relaxed legal_obligations link CHECK so a case-bound
// objection obligation (case_id only, no contract/matter) is valid.
//
// Background: migration 000004 created an anonymous CHECK
// (contract_id IS NOT NULL OR matter_id IS NOT NULL). Migration 000027 tried to
// drop it via a DO block matching pg_get_constraintdef() with the pattern
// '%contract_id IS NOT NULL OR matter_id IS NOT NULL%' (no parentheses), then add
// the relaxed chk_legal_obligations_link that also admits case_id. But Postgres
// canonicalises the stored definition to
// '((contract_id IS NOT NULL) OR (matter_id IS NOT NULL))' (parenthesised
// operands), so the ILIKE never matches and the stale constraint survives. Both
// CHECKs then AND together and the case-only objection obligation is rejected with
// 23514. The migration is committed and must not be edited, so this reconcile
// finishes the job from the repository.
//
// It is precise: it only drops a CHECK whose definition references contract_id and
// matter_id but NOT case_id (the un-relaxed form). The correctly-relaxed
// chk_legal_obligations_link references case_id and is left untouched. It runs at
// most once per process on a pooled connection (not the caller's study tx) so it
// never holds the brief ACCESS EXCLUSIVE lock inside a request transaction, and it
// is idempotent / safe to re-run.
func (r *LegalJudgmentRepository) reconcileObligationLinkCheck(ctx context.Context) error {
	var reconcileErr error
	r.reconcileLinkCheckOnce.Do(func() {
		const stale = `
			SELECT conname
			FROM pg_constraint
			WHERE conrelid = 'legal_obligations'::regclass
			  AND contype = 'c'
			  AND pg_get_constraintdef(oid) ILIKE '%contract_id IS NOT NULL%'
			  AND pg_get_constraintdef(oid) ILIKE '%matter_id IS NOT NULL%'
			  AND pg_get_constraintdef(oid) NOT ILIKE '%case_id%'`
		var conname string
		err := r.db.QueryRow(ctx, stale).Scan(&conname)
		if err != nil {
			if err == pgx.ErrNoRows {
				// No stale un-relaxed CHECK: the migration applied cleanly. Nothing to do.
				return
			}
			reconcileErr = fmt.Errorf("detect stale legal_obligations link CHECK: %w", err)
			return
		}
		// quote_ident-equivalent: conname comes from the catalog and is a plain
		// identifier; wrap in double quotes to be safe against unusual names.
		drop := fmt.Sprintf(`ALTER TABLE legal_obligations DROP CONSTRAINT IF EXISTS %q`, conname)
		if _, err := r.db.Exec(ctx, drop); err != nil {
			reconcileErr = fmt.Errorf("drop stale legal_obligations link CHECK %q: %w", conname, err)
			return
		}
		r.logger.Info().Str("constraint", conname).Msg("dropped stale un-relaxed legal_obligations link CHECK (migration 000027 reconcile)")
	})
	if reconcileErr != nil {
		// Reset so a transient failure (e.g. lock timeout) can be retried on the next
		// objection-obligation insert rather than being permanently latched.
		r.reconcileLinkCheckOnce = sync.Once{}
	}
	return reconcileErr
}

// AppendAudit writes one append-only litigation governance audit row for a judgment
// transition inside the caller's transaction (immutable: insert-only table).
func (r *LegalJudgmentRepository) AppendAudit(ctx context.Context, q Queryer, e *LitigationAuditEntry) error {
	return appendLitigationAudit(ctx, q, "legal_judgment", e)
}

// ListAudit returns the append-only governance audit trail for one judgment.
func (r *LegalJudgmentRepository) ListAudit(ctx context.Context, tenantID, id uuid.UUID) ([]LitigationAuditEntry, error) {
	return listLitigationAudit(ctx, r.db, tenantID, "legal_judgment", id)
}

// UpsertDurationFact idempotently records a litigation processing-time fact (C-2)
// inside the caller's transaction, keyed by (tenant_id, kind, subject_id).
func (r *LegalJudgmentRepository) UpsertDurationFact(ctx context.Context, q Queryer, f *LitigationDurationFact) error {
	return upsertLitigationDurationFact(ctx, q, f)
}

func judgmentJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT j.id, j.tenant_id, j.case_id, j.judgment_ref,
			       j.judgment_date::timestamptz AS judgment_date,
			       j.decision_type, j.impact, j.judge_name, j.court_name,
			       j.outcome, j.summary, j.implications, j.study_notes, j.recommendation,
			       j.objection_deadline::timestamptz AS objection_deadline,
			       j.obligation_id, j.studied_by, j.studied_at, j.file_id,
			       j.document_reference, j.next_expected_ruling_at, j.next_expected_ruling,
			       COALESCE(j.metadata, '{}'::jsonb) AS metadata,
			       j.created_by, j.created_at, j.updated_at, j.deleted_at
			FROM legal_judgments j
			WHERE ` + where + `
		) t`
}

func judgmentSortColumn(column string) (string, bool) {
	switch column {
	case "j.judgment_ref":
		return "t.judgment_ref", true
	case "j.judgment_date":
		return "t.judgment_date", true
	case "j.recommendation":
		return "t.recommendation", true
	case "j.updated_at":
		return "t.updated_at", true
	case "j.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}

// =============================================================================
// Shared litigation governance audit + duration-fact helpers (WS2/WS3/WS4, C-2).
//
// The pleading, judgment and defendant repositories each expose thin AppendAudit /
// UpsertDurationFact methods that delegate here so the immutable
// legal_litigation_audit_log INSERT and the idempotent lex_duration_facts upsert are
// written exactly once and stay consistent across the three sub-domains. These live
// in the judgment repo file (one of this unit's owned files) to avoid editing the
// integrator-owned repository/common.go.
// =============================================================================

// LitigationAuditEntry is one append-only litigation governance audit row. Immutable:
// the table has no UPDATE/DELETE policy. before/after capture the mutated state;
// Reason carries the actor-supplied justification (objection reason, rejection note).
type LitigationAuditEntry struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenant_id"`
	SubjectType string         `json:"subject_type"`
	SubjectID   uuid.UUID      `json:"subject_id"`
	CaseID      *uuid.UUID     `json:"case_id,omitempty"`
	Action      string         `json:"action"`
	FromStatus  *string        `json:"from_status,omitempty"`
	ToStatus    *string        `json:"to_status,omitempty"`
	Reason      *string        `json:"reason,omitempty"`
	Before      map[string]any `json:"before"`
	After       map[string]any `json:"after"`
	Detail      map[string]any `json:"detail"`
	ActorUserID uuid.UUID      `json:"actor_user_id"`
	CreatedAt   time.Time      `json:"created_at"`
}

// appendLitigationAudit inserts one immutable audit row. subjectType is forced by the
// owning repo so the table CHECK is always satisfied.
func appendLitigationAudit(ctx context.Context, q Queryer, subjectType string, e *LitigationAuditEntry) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	beforeJSON, err := json.Marshal(orEmptyMap(e.Before))
	if err != nil {
		return fmt.Errorf("marshal litigation audit before: %w", err)
	}
	afterJSON, err := json.Marshal(orEmptyMap(e.After))
	if err != nil {
		return fmt.Errorf("marshal litigation audit after: %w", err)
	}
	detailJSON, err := json.Marshal(orEmptyMap(e.Detail))
	if err != nil {
		return fmt.Errorf("marshal litigation audit detail: %w", err)
	}
	query := `
		INSERT INTO legal_litigation_audit_log (
			id, tenant_id, subject_type, subject_id, case_id, action,
			from_status, to_status, reason, before, after, detail, actor_user_id
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13
		)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		e.ID, e.TenantID, subjectType, e.SubjectID, e.CaseID, e.Action,
		e.FromStatus, e.ToStatus, e.Reason, beforeJSON, afterJSON, detailJSON, e.ActorUserID,
	).Scan(&e.CreatedAt)
}

// listLitigationAudit returns the append-only audit trail for one subject, oldest
// first.
func listLitigationAudit(ctx context.Context, q Queryer, tenantID uuid.UUID, subjectType string, subjectID uuid.UUID) ([]LitigationAuditEntry, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT al.id, al.tenant_id, al.subject_type, al.subject_id, al.case_id, al.action,
			       al.from_status, al.to_status, al.reason,
			       COALESCE(al.before, '{}'::jsonb) AS before,
			       COALESCE(al.after, '{}'::jsonb) AS after,
			       COALESCE(al.detail, '{}'::jsonb) AS detail,
			       al.actor_user_id, al.created_at
			FROM legal_litigation_audit_log al
			WHERE al.tenant_id = $1 AND al.subject_type = $2 AND al.subject_id = $3
			ORDER BY al.created_at ASC
		) t`
	return queryListJSON[LitigationAuditEntry](ctx, q, query, tenantID, subjectType, subjectID)
}

// LitigationDurationFact is a processing-time fact emitted by the litigation flows
// (C-2). It mirrors the reporting fact-store row but is written from inside the
// mutation transaction with a string kind so this unit does not depend on the
// reporting model. Keyed by (tenant_id, kind, subject_id) => idempotent.
type LitigationDurationFact struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	Kind       string
	SubjectID  uuid.UUID
	Department *string
	Category   *string
	StartedAt  time.Time
	EndedAt    time.Time
	OccurredAt time.Time
}

// upsertLitigationDurationFact idempotently writes one duration fact. duration_minutes
// is wall-clock; working_minutes is left equal to wall-clock here (the reporting
// consumer refines it on the next lifecycle event through the working calendar). The
// occurred_at guard absorbs out-of-order writes, mirroring DurationFactRepository.
func upsertLitigationDurationFact(ctx context.Context, q Queryer, f *LitigationDurationFact) error {
	started := f.StartedAt.UTC()
	ended := f.EndedAt.UTC()
	if ended.Before(started) {
		ended = started
	}
	occurred := f.OccurredAt.UTC()
	if occurred.IsZero() {
		occurred = ended
	}
	wallMinutes := int(ended.Sub(started) / time.Minute)
	if wallMinutes < 0 {
		wallMinutes = 0
	}
	query := `
		INSERT INTO lex_duration_facts (
			id, tenant_id, kind, subject_id, department, category,
			started_at, ended_at, duration_minutes, working_minutes,
			sla_target_minutes, sla_outcome, occurred_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NULL,$11
		)
		ON CONFLICT (tenant_id, kind, subject_id) DO UPDATE SET
			department       = EXCLUDED.department,
			category         = EXCLUDED.category,
			started_at       = EXCLUDED.started_at,
			ended_at         = EXCLUDED.ended_at,
			duration_minutes = EXCLUDED.duration_minutes,
			working_minutes  = EXCLUDED.working_minutes,
			occurred_at      = EXCLUDED.occurred_at,
			updated_at       = now()
		WHERE lex_duration_facts.occurred_at <= EXCLUDED.occurred_at`
	if f.ID == uuid.Nil {
		f.ID = uuid.New()
	}
	_, err := q.Exec(ctx, query,
		f.ID, f.TenantID, f.Kind, f.SubjectID, f.Department, f.Category,
		started, ended, wallMinutes, wallMinutes, occurred,
	)
	return err
}
