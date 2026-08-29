package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// LitigationJudgmentService owns judgment recording + study (CAP-063..066). On an
// objection recommendation it creates a linked legal_obligation (with the staged
// case_id column) inside the SAME transaction so the EXISTING obligation reminder
// outbox (EnqueueDueReminderOutbox/DispatchReminderOutbox + monitor) fires the
// objection deadline — no new timer is introduced. Every mutation emits a
// CloudEvent on events.Topics.LexEvents.
type LitigationJudgmentService struct {
	db         *pgxpool.Pool
	judgments  *repository.LegalJudgmentRepository
	cases      *repository.LegalCaseRepository
	tasks      *repository.CaseTaskRepository
	publisher  Publisher
	metrics    *metrics.Metrics
	topic      string
	logger     zerolog.Logger
	now        func() time.Time
	legalHolds LegalHoldGuard
	audit      *LexAuditEmitter
}

func NewLitigationJudgmentService(
	db *pgxpool.Pool,
	judgments *repository.LegalJudgmentRepository,
	cases *repository.LegalCaseRepository,
	tasks *repository.CaseTaskRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *LitigationJudgmentService {
	return &LitigationJudgmentService{
		db:        db,
		judgments: judgments,
		cases:     cases,
		tasks:     tasks,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-litigation-judgments").Logger(),
		now:       time.Now,
	}
}

// WithLegalHoldGuard wires the legal-hold enforcement guard (chainable).
func (s *LitigationJudgmentService) WithLegalHoldGuard(guard LegalHoldGuard) *LitigationJudgmentService {
	s.legalHolds = guard
	return s
}

// SetAuditEmitter wires the immutable audit_db ledger emitter (chainable). When set,
// every judgment transition Emit()s a tamper-evident audit record in addition to the
// in-tx append-only legal_litigation_audit_log row. Safe to leave nil.
func (s *LitigationJudgmentService) SetAuditEmitter(audit *LexAuditEmitter) *LitigationJudgmentService {
	s.audit = audit
	return s
}

// RecordJudgment records a court judgment on a case (CAP-063).
func (s *LitigationJudgmentService) RecordJudgment(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.CreateJudgmentRequest) (*model.LegalJudgment, error) {
	req.Normalize()
	if req.JudgmentRef == "" {
		return nil, validationError("judgment_ref is required", map[string]string{"judgment_ref": "required"})
	}
	if req.Outcome != nil && !req.Outcome.Valid() {
		return nil, validationError("invalid outcome", map[string]string{"outcome": "invalid"})
	}
	if !req.DecisionType.Valid() {
		return nil, validationError("invalid decision type", map[string]string{"decision_type": "invalid"})
	}
	if req.Impact != nil && !req.Impact.Valid() {
		return nil, validationError("invalid impact", map[string]string{"impact": "invalid"})
	}
	c, err := s.cases.Get(ctx, tenantID, caseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	j := &model.LegalJudgment{
		ID:                   uuid.New(),
		TenantID:             tenantID,
		CaseID:               caseID,
		JudgmentRef:          req.JudgmentRef,
		JudgmentDate:         req.JudgmentDate,
		DecisionType:         req.DecisionType,
		Impact:               req.Impact,
		JudgeName:            req.JudgeName,
		CourtName:            req.CourtName,
		Outcome:              req.Outcome,
		Summary:              req.Summary,
		Implications:         req.Implications,
		Recommendation:       model.JudgmentRecommendationPending,
		FileID:               req.FileID,
		DocumentReference:    req.DocumentReference,
		NextExpectedRulingAt: req.NextExpectedRulingAt,
		NextExpectedRuling:   req.NextExpectedRuling,
		Metadata:             req.Metadata,
		CreatedBy:            userID,
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start judgment record transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.judgments.Create(ctx, tx, j); err != nil {
		return nil, internalError("record judgment", err)
	}
	if err := s.appendJudgmentAudit(ctx, tx, j, userID, "judgment.recorded", nil, ptrString(string(j.Recommendation)), nil, map[string]any{
		"judgment_ref": j.JudgmentRef,
		"outcome":      judgmentOutcomeDetail(j.Outcome),
	}, nil, judgmentAuditState(j)); err != nil {
		return nil, err
	}
	if err := createAutomatedCaseTasks(ctx, tx, s.cases, s.tasks, tenantID, userID, caseID, judgmentRecordedAutomationTasks(c, j, s.now().UTC())); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit judgment record", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.judgment.recorded", tenantID, &userID, map[string]any{
		"id": j.ID, "case_id": caseID, "judgment_ref": j.JudgmentRef, "outcome": j.Outcome,
	}, s.logger)
	s.emitJudgmentAudit(ctx, j, &userID, "judgment.recorded", "info", nil, judgmentAuditState(j), map[string]any{
		"judgment_ref": j.JudgmentRef,
	})
	return s.GetJudgment(ctx, tenantID, caseID, j.ID)
}

func (s *LitigationJudgmentService) ListJudgments(ctx context.Context, tenantID, caseID uuid.UUID, filters model.LegalJudgmentListFilters) ([]model.LegalJudgment, int, error) {
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, 0, err
	}
	return s.judgments.List(ctx, tenantID, caseID, filters)
}

func (s *LitigationJudgmentService) GetJudgment(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.LegalJudgment, error) {
	j, err := s.judgments.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("judgment not found")
		}
		return nil, internalError("load judgment", err)
	}
	return j, nil
}

// StudyJudgment records the study + objection/non-objection recommendation
// (CAP-064..066). When the recommendation is "object", it sets the objection
// deadline AND creates a linked legal_obligation in the same transaction so the
// existing reminder outbox dispatches the deadline reminder.
func (s *LitigationJudgmentService) StudyJudgment(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.StudyJudgmentRequest) (*model.LegalJudgment, error) {
	req.Normalize()
	if !req.Recommendation.Valid() || req.Recommendation == model.JudgmentRecommendationPending {
		return nil, validationError("recommendation must be object or accept", map[string]string{"recommendation": "invalid"})
	}
	// Validate the objection inputs BEFORE opening the tx so a bad request never
	// takes the row lock.
	if req.Recommendation == model.JudgmentRecommendationObject {
		if req.ObjectionDeadline == nil || req.ObjectionDeadline.IsZero() {
			return nil, validationError("objection_deadline is required when objecting", map[string]string{"objection_deadline": "required"})
		}
		if req.OwnerUserID == nil || *req.OwnerUserID == uuid.Nil {
			return nil, validationError("owner_user_id is required when objecting", map[string]string{"owner_user_id": "required"})
		}
		if req.OwnerName == "" {
			return nil, validationError("owner_name is required when objecting", map[string]string{"owner_name": "required"})
		}
	}

	j, err := s.judgments.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("judgment not found")
		}
		return nil, internalError("load judgment", err)
	}
	before := judgmentAuditState(j)
	beforeRecommendation := string(j.Recommendation)
	var c *model.LegalCase
	if req.Recommendation == model.JudgmentRecommendationObject {
		c, err = s.cases.Get(ctx, tenantID, caseID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil, notFoundError("legal case not found")
			}
			return nil, internalError("load legal case", err)
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start judgment study transaction", err)
	}
	defer tx.Rollback(ctx)

	// Lock the judgment row FOR UPDATE so concurrent StudyJudgment calls serialize.
	// Idempotency: if the judgment was already studied, return it unchanged rather
	// than racing a second objection obligation (no duplicate reminder storm).
	lock, err := s.judgments.LockForStudy(ctx, tx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("judgment not found")
		}
		return nil, internalError("lock judgment for study", err)
	}
	if lock.StudiedAt != nil {
		// Already studied: no-op. Roll the (read-only) tx back and return current state.
		_ = tx.Rollback(ctx)
		s.logger.Debug().Str("judgment_id", id.String()).Msg("judgment already studied; StudyJudgment is a no-op")
		return s.GetJudgment(ctx, tenantID, caseID, id)
	}

	now := s.now().UTC()
	j.StudyNotes = req.StudyNotes
	j.Recommendation = req.Recommendation
	j.StudiedBy = &userID
	j.StudiedAt = &now
	if req.Metadata != nil {
		j.Metadata = req.Metadata
	}
	if req.Implications != nil {
		j.Implications = *req.Implications
	}
	if req.NextExpectedRulingAt != nil {
		j.NextExpectedRulingAt = req.NextExpectedRulingAt
	}
	if req.NextExpectedRuling != nil {
		j.NextExpectedRuling = req.NextExpectedRuling
	}

	var newObligationID *uuid.UUID
	if req.Recommendation == model.JudgmentRecommendationObject {
		deadline := normalizeDate(*req.ObjectionDeadline)
		j.ObjectionDeadline = &deadline
		obligation := s.buildObjectionObligation(tenantID, userID, j, *req.OwnerUserID, req.OwnerName)
		if err := s.judgments.CreateLinkedObligation(ctx, tx, obligation, caseID, j.ID); err != nil {
			// The partial-unique index (uq_legal_obligations_judgment_live) guarantees
			// at most one live objection obligation per judgment; a duplicate that
			// raced past the lock surfaces here as a unique violation and is mapped to
			// the idempotent already-studied conflict.
			if isUniqueViolation(err) {
				return nil, conflictError("an objection obligation already exists for this judgment")
			}
			return nil, internalError("create objection obligation", err)
		}
		newObligationID = &obligation.ID
		j.ObligationID = newObligationID
	} else {
		j.ObjectionDeadline = nil
	}
	if err := s.judgments.UpdateStudy(ctx, tx, j); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("judgment not found")
		}
		return nil, internalError("update judgment study", err)
	}

	// C-2: judgment-study turnaround fact (judgment.created -> studied), in-tx.
	if err := s.judgments.UpsertDurationFact(ctx, tx, &repository.LitigationDurationFact{
		TenantID:   tenantID,
		Kind:       judgmentStudyDurationKind,
		SubjectID:  j.ID,
		Category:   ptrString(string(j.Recommendation)),
		StartedAt:  j.CreatedAt,
		EndedAt:    now,
		OccurredAt: now,
	}); err != nil {
		return nil, internalError("record judgment study duration fact", err)
	}

	after := judgmentAuditState(j)
	if err := s.appendJudgmentAudit(ctx, tx, j, userID, "judgment.studied",
		ptrString(beforeRecommendation), ptrString(string(j.Recommendation)),
		optionalReason(req.StudyNotes), before, after, map[string]any{
			"obligation_id":      uuidPtrDetail(newObligationID),
			"objection_deadline": dateDetail(j.ObjectionDeadline),
		}); err != nil {
		return nil, err
	}
	if req.Recommendation == model.JudgmentRecommendationObject {
		if err := createAutomatedCaseTasks(ctx, tx, s.cases, s.tasks, tenantID, userID, caseID, objectionRecommendedAutomationTasks(c, j, req.OwnerUserID, now)); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit judgment study", err)
	}

	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.judgment.studied", tenantID, &userID, map[string]any{
		"id":                 j.ID,
		"case_id":            caseID,
		"recommendation":     j.Recommendation,
		"objection_deadline": j.ObjectionDeadline,
		"obligation_id":      newObligationID,
	}, s.logger)
	s.emitJudgmentAudit(ctx, j, &userID, "judgment.studied", "info", before, after, map[string]any{
		"obligation_id": uuidPtrDetail(newObligationID),
	})
	return s.GetJudgment(ctx, tenantID, caseID, id)
}

func (s *LitigationJudgmentService) DeleteJudgment(ctx context.Context, tenantID, caseID, id uuid.UUID) error {
	if err := s.judgments.SoftDelete(ctx, tenantID, caseID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("judgment not found")
		}
		return internalError("delete judgment", err)
	}
	return nil
}

// buildObjectionObligation builds the case-linked obligation that the existing
// reminder outbox dispatches for the objection deadline (CAP-066). Reminder lead
// days are conservative (14/7/3/1 days before the deadline) since objection windows
// are short.
func (s *LitigationJudgmentService) buildObjectionObligation(tenantID, userID uuid.UUID, j *model.LegalJudgment, ownerUserID uuid.UUID, ownerName string) *model.Obligation {
	return &model.Obligation{
		ID:               uuid.New(),
		TenantID:         tenantID,
		Title:            fmt.Sprintf("الموعد النهائي للاعتراض على الحكم %s", j.JudgmentRef),
		Description:      strings.TrimSpace("قدّم الاعتراض أو الاستئناف قبل انقضاء الموعد النهائي. " + j.StudyNotes),
		Type:             model.ObligationTypeOther,
		Status:           model.ObligationStatusOpen,
		Priority:         model.LegalPriorityCritical,
		OwnerUserID:      ownerUserID,
		OwnerName:        ownerName,
		DueDate:          *j.ObjectionDeadline,
		ReminderEnabled:  true,
		ReminderLeadDays: []int{14, 7, 3, 1},
		Tags:             []string{"litigation", "objection_deadline"},
		Metadata: map[string]any{
			"source":       "lex_litigation_judgment",
			"judgment_id":  j.ID.String(),
			"case_id":      j.CaseID.String(),
			"judgment_ref": j.JudgmentRef,
		},
		CreatedBy: userID,
	}
}

func (s *LitigationJudgmentService) ensureCaseExists(ctx context.Context, tenantID, caseID uuid.UUID) error {
	if _, err := s.cases.Get(ctx, tenantID, caseID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("legal case not found")
		}
		return internalError("load legal case", err)
	}
	return nil
}

// judgmentStudyDurationKind is the C-2 duration-fact kind for the
// judgment.created -> judgment.studied turnaround (widened in the staged migration).
const judgmentStudyDurationKind = "judgment_study"

// appendJudgmentAudit writes the in-tx append-only governance audit row for a
// judgment transition. Immutable: legal_litigation_audit_log has no UPDATE/DELETE.
func (s *LitigationJudgmentService) appendJudgmentAudit(ctx context.Context, tx pgx.Tx, j *model.LegalJudgment, actorID uuid.UUID, action string, from, to, reason *string, before, after, detail map[string]any) error {
	caseID := j.CaseID
	entry := &repository.LitigationAuditEntry{
		ID:          uuid.New(),
		TenantID:    j.TenantID,
		SubjectType: "legal_judgment",
		SubjectID:   j.ID,
		CaseID:      &caseID,
		Action:      action,
		FromStatus:  from,
		ToStatus:    to,
		Reason:      reason,
		Before:      before,
		After:       after,
		Detail:      detail,
		ActorUserID: actorID,
	}
	if err := s.judgments.AppendAudit(ctx, tx, entry); err != nil {
		return internalError("append judgment audit", err)
	}
	return nil
}

// emitJudgmentAudit routes a tamper-evident record to the immutable audit_db ledger
// (best-effort; never blocks the business operation).
func (s *LitigationJudgmentService) emitJudgmentAudit(ctx context.Context, j *model.LegalJudgment, actorID *uuid.UUID, action, severity string, before, after, detail map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.Emit(ctx, LexAuditRecord{
		TenantID:     j.TenantID,
		ActorUserID:  actorID,
		Action:       action,
		ResourceType: "legal_judgment",
		ResourceID:   j.ID.String(),
		Severity:     severity,
		OldValue:     before,
		NewValue:     after,
		Detail:       detail,
	})
}

// judgmentAuditState is the before/after snapshot recorded in the audit trail.
func judgmentAuditState(j *model.LegalJudgment) map[string]any {
	return map[string]any{
		"judgment_ref":            j.JudgmentRef,
		"decision_type":           string(j.DecisionType),
		"impact":                  judgmentImpactDetail(j.Impact),
		"judge_name":              j.JudgeName,
		"court_name":              j.CourtName,
		"implications":            j.Implications,
		"document_reference":      j.DocumentReference,
		"next_expected_ruling_at": dateDetail(j.NextExpectedRulingAt),
		"next_expected_ruling":    j.NextExpectedRuling,
		"recommendation":          string(j.Recommendation),
		"outcome":                 judgmentOutcomeDetail(j.Outcome),
		"objection_deadline":      dateDetail(j.ObjectionDeadline),
		"obligation_id":           uuidPtrDetail(j.ObligationID),
		"studied_by":              uuidPtrDetail(j.StudiedBy),
	}
}

func judgmentOutcomeDetail(o *model.JudgmentOutcome) any {
	if o == nil {
		return nil
	}
	return string(*o)
}

func judgmentImpactDetail(impact *model.JudgmentImpact) any {
	if impact == nil {
		return nil
	}
	return string(*impact)
}

// dateDetail renders an optional time as an RFC3339 string for audit detail.
func dateDetail(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

// optionalReason trims a free-text reason to a pointer, dropping empties.
func optionalReason(s string) *string {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
