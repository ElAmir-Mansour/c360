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

	"github.com/clario360/platform/internal/lex/calendar"
	"github.com/clario360/platform/internal/lex/drafting"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// ConsultationSLAConfig pins the CAP ack + response (turnaround) windows for the
// consultation self-contained SLA clock (WS3). The windows are expressed in
// working units and materialised through the frozen working-calendar Calculator
// (contract C-1), so the consultation SLA shares the request SLA's working-day
// basis. Urgent consultations acknowledge in working HOURS, normal in working
// DAYS — mirroring the request SLA's ack-unit rule (CAP-013/014).
type ConsultationSLAConfig struct {
	// AckWorkingHoursUrgent is the acknowledgement (routing) window for an
	// urgent/critical-priority consultation, in working hours.
	AckWorkingHoursUrgent int
	// AckWorkingDaysNormal is the acknowledgement window for a normal-priority
	// consultation, in working days.
	AckWorkingDaysNormal int
	// ResponseWorkingDaysUrgent / ResponseWorkingDaysNormal are the response
	// (turnaround) windows in working days by priority tier.
	ResponseWorkingDaysUrgent int
	ResponseWorkingDaysNormal int
}

// defaultConsultationSLAConfig is the out-of-the-box advisory SLA: urgent acks in
// 4 working hours / responds in 3 working days; normal acks in 1 working day /
// responds in 5 working days. Admin master data can override per tenant later; the
// constructor installs this so a clock always materialises.
var defaultConsultationSLAConfig = ConsultationSLAConfig{
	AckWorkingHoursUrgent:     4,
	AckWorkingDaysNormal:      1,
	ResponseWorkingDaysUrgent: 3,
	ResponseWorkingDaysNormal: 5,
}

// consultationCalendarProvider yields the frozen working-time Calculator the
// consultation SLA clock materialises its deadlines from. It is the narrow subset
// of CalculatorProvider the consultation path needs and is satisfied by
// *WorkingCalendarService. The seam keeps ConsultationService from importing the
// calendar repository and stays optional in tests.
type consultationCalendarProvider interface {
	DefaultCalculator(ctx context.Context, tenantID uuid.UUID) (calendar.Calculator, error)
}

// consultationDurationFactRecorder is the in-process processing-time fact seam
// (C-2). It is satisfied by *DurationFactService.UpsertFromSource, which
// reconstructs the consultation bounds (created_at → responded_at) from the source
// table and idempotently upserts the consultation_answer fact. Recording in-process
// makes the flagship KPI correct even when the Kafka event bus is off (the
// dev/single-node default); the reporting consumer remains an out-of-process
// backstop and both converge on the same keyed upsert.
type consultationDurationFactRecorder interface {
	UpsertFromSource(ctx context.Context, tenantID uuid.UUID, kind model.DurationFactKind, subjectID uuid.UUID, occurredAt time.Time) (*model.DurationFact, error)
	// AverageWorkingHours reads the average working-HOURS time-to-respond and the
	// sample size over the [from,to] window. Used by Stats (#9 analytics).
	AverageWorkingHours(ctx context.Context, tenantID uuid.UUID, kind model.DurationFactKind, filters model.ReportFilters) (avgHours float64, sample int, err error)
}

// legalHoldSubjectConsultation is the legal-hold subject discriminator for a
// consultation. A consultation under an active hold cannot be archived or have a
// document detached (preservation). This is a registered subject type: the model's
// Valid() and the legal_holds subject_type CHECK both admit "consultation" (the
// latter via migration 000084), so the GET /legal-hold status endpoint, the
// EnsureSubjectMutable guards, and hold creation all resolve consistently.
const legalHoldSubjectConsultation = model.LegalHoldSubjectConsultation

// consultationLegalHoldQuerier is the optional read seam for surfacing the active
// legal holds on a consultation (#7). It is the narrow subset of *LegalHoldService
// the consultation read path needs; *LegalHoldService satisfies it via
// GetActiveHoldsForSubject. A nil querier means "hold exposure not wired" and the
// Get response simply reports legal_hold=false (backward compatible).
type consultationLegalHoldQuerier interface {
	GetActiveHoldsForSubject(ctx context.Context, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) ([]model.LegalHold, error)
}

// consultationStatusTransitions is the allowed FSM edge set (CAP-126..132):
// submitted → classified → routed → responded → approved → archived. The approve
// edge is driven by the approval orchestrator FSM hook (see consultation_approval.go),
// every other edge is driven by an explicit action on this service.
var consultationStatusTransitions = map[model.ConsultationStatus]map[model.ConsultationStatus]struct{}{
	model.ConsultationStatusSubmitted: {
		model.ConsultationStatusClassified: {},
	},
	model.ConsultationStatusClassified: {
		model.ConsultationStatusRouted: {},
	},
	model.ConsultationStatusRouted: {
		model.ConsultationStatusResponded: {},
	},
	model.ConsultationStatusResponded: {
		model.ConsultationStatusApproved: {},
	},
	model.ConsultationStatusApproved: {
		model.ConsultationStatusArchived: {},
	},
}

// ConsultationService owns the legal-consultation aggregate (CAP-126..132): the
// submit→classify→route→respond→approve→archive FSM, the Files-service document
// links, and the immutable governance audit log. Every mutation appends an audit
// row in the SAME transaction and emits a CloudEvent on events.Topics.LexEvents.
// CAP-131 (approve response) is delegated to the subject-agnostic
// ApprovalOrchestrator via ConsultationApprovalService. CAP-132 (archive) and
// document detach are guarded by the legal-hold preservation guard.
type ConsultationService struct {
	db            *pgxpool.Pool
	consultations *repository.ConsultationRepository
	requests      *repository.LegalRequestRepository
	publisher     Publisher
	metrics       *metrics.Metrics
	topic         string
	logger        zerolog.Logger
	now           func() time.Time
	legalHolds    LegalHoldGuard
	holdQuerier   consultationLegalHoldQuerier
	drafter       *drafting.Drafter
	// WS3: self-contained consultation SLA clock.
	slaCalendars consultationCalendarProvider
	slaConfig    ConsultationSLAConfig
	// WS3 (optional): nudge the linked request's shared SLA clock when the
	// consultation back-links a legal request, so a request-spawned consultation
	// shares the request's ack/turnaround materialisation. Idempotent + best-effort.
	requestSLA SLAStarter
	// WS4: immutable audit_db ledger emitter for material transitions.
	auditEmitter *LexAuditEmitter
	// C-2: in-process processing-time fact recorder.
	durationFacts consultationDurationFactRecorder
}

func NewConsultationService(
	db *pgxpool.Pool,
	consultations *repository.ConsultationRepository,
	requests *repository.LegalRequestRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *ConsultationService {
	return &ConsultationService{
		db:            db,
		consultations: consultations,
		requests:      requests,
		publisher:     publisherOrNoop(publisher),
		metrics:       appMetrics,
		topic:         topic,
		logger:        logger.With().Str("service", "lex-consultations").Logger(),
		now:           time.Now,
		slaConfig:     defaultConsultationSLAConfig,
	}
}

// SetSLAService wires the self-contained consultation SLA clock (WS3). The
// provider yields the frozen working-calendar Calculator the ack + response
// deadlines are materialised from; once set, Submit/Route materialise the clock and
// resolve sla_outcome on approval/archive. A nil provider is ignored so the
// constructor default (no clock) is never clobbered. The optional ConsultationSLAConfig
// overrides the default CAP ack/response windows; pass nil to keep the default.
func (s *ConsultationService) SetSLAService(provider consultationCalendarProvider, cfg *ConsultationSLAConfig) *ConsultationService {
	if provider != nil {
		s.slaCalendars = provider
	}
	if cfg != nil {
		s.slaConfig = normalizeConsultationSLAConfig(*cfg)
	}
	return s
}

// SetRequestSLAStarter wires the shared request-keyed SLA clock bridge so a
// request-linked consultation also nudges its parent request's clock idempotently
// (best-effort). Standalone consultations are unaffected. A nil starter is ignored.
func (s *ConsultationService) SetRequestSLAStarter(starter SLAStarter) *ConsultationService {
	if starter != nil {
		s.requestSLA = starter
	}
	return s
}

// SetAuditEmitter wires the immutable audit_db ledger emitter (WS4). Once set,
// material consultation transitions (submit/classify/route/respond/archive) emit a
// tamper-evident audit_db record IN ADDITION to the in-tx governance audit row. A
// nil emitter is a no-op (the emitter itself tolerates a nil receiver).
func (s *ConsultationService) SetAuditEmitter(emitter *LexAuditEmitter) *ConsultationService {
	s.auditEmitter = emitter
	return s
}

// SetDurationFactRecorder wires the in-process processing-time fact recorder (C-2).
// Once set, a responded consultation records its consultation_answer duration fact
// in-process (the reporting consumer remains an out-of-process backstop). A nil
// recorder is ignored.
func (s *ConsultationService) SetDurationFactRecorder(recorder consultationDurationFactRecorder) *ConsultationService {
	if recorder != nil {
		s.durationFacts = recorder
	}
	return s
}

func normalizeConsultationSLAConfig(cfg ConsultationSLAConfig) ConsultationSLAConfig {
	if cfg.AckWorkingHoursUrgent <= 0 {
		cfg.AckWorkingHoursUrgent = defaultConsultationSLAConfig.AckWorkingHoursUrgent
	}
	if cfg.AckWorkingDaysNormal <= 0 {
		cfg.AckWorkingDaysNormal = defaultConsultationSLAConfig.AckWorkingDaysNormal
	}
	if cfg.ResponseWorkingDaysUrgent <= 0 {
		cfg.ResponseWorkingDaysUrgent = defaultConsultationSLAConfig.ResponseWorkingDaysUrgent
	}
	if cfg.ResponseWorkingDaysNormal <= 0 {
		cfg.ResponseWorkingDaysNormal = defaultConsultationSLAConfig.ResponseWorkingDaysNormal
	}
	return cfg
}

// consultationSLAUrgent maps the legal priority onto the two-tier SLA urgency: a
// critical/high consultation is urgent (working-hour ack), medium/low is normal.
func consultationSLAUrgent(priority model.LegalPriority) bool {
	switch priority {
	case model.LegalPriorityCritical, model.LegalPriorityHigh:
		return true
	default:
		return false
	}
}

// WithLegalHoldGuard wires the preservation guard (chainable).
func (s *ConsultationService) WithLegalHoldGuard(guard LegalHoldGuard) *ConsultationService {
	s.legalHolds = guard
	return s
}

// WithLegalHoldQuerier wires the read seam that surfaces active legal holds onto
// the Get response (#7, chainable). A nil querier leaves hold exposure off.
func (s *ConsultationService) WithLegalHoldQuerier(q consultationLegalHoldQuerier) *ConsultationService {
	if q != nil {
		s.holdQuerier = q
	}
	return s
}

// WithDrafter wires the shared AI drafting engine for first-response memos
// (chainable). A nil drafter disables AI drafting (callers must then supply the
// response text explicitly).
func (s *ConsultationService) WithDrafter(d *drafting.Drafter) *ConsultationService {
	s.drafter = d
	return s
}

// Submit opens a new consultation (CAP-126) in the submitted state, optionally
// back-linking a legal request (spine). The insert + first audit row commit in
// one transaction.
func (s *ConsultationService) Submit(ctx context.Context, tenantID, userID uuid.UUID, req dto.SubmitConsultationRequest) (*model.Consultation, error) {
	req.Normalize()
	if err := validateConsultationSubmit(req); err != nil {
		return nil, err
	}
	if req.LegalRequestID != nil {
		if _, err := s.requests.Get(ctx, tenantID, *req.LegalRequestID); err != nil {
			if err == pgx.ErrNoRows {
				return nil, validationError("linked legal request not found", map[string]string{"legal_request_id": "not found"})
			}
			return nil, internalError("load linked legal request", err)
		}
	}

	requesterUserID := userID
	if req.RequesterUserID != nil && *req.RequesterUserID != uuid.Nil {
		requesterUserID = *req.RequesterUserID
	}
	number := normalizeOptionalString(req.ConsultationNumber)
	if number == nil {
		generated := fmt.Sprintf("CONS-%s-%s", s.now().UTC().Format("20060102"), strings.ToUpper(uuid.NewString()[:8]))
		number = &generated
	}

	c := &model.Consultation{
		ID:                 uuid.New(),
		TenantID:           tenantID,
		ConsultationNumber: *number,
		Type:               req.Type,
		Title:              req.Title,
		Status:             model.ConsultationStatusSubmitted,
		Priority:           req.Priority,
		LegalRequestID:     req.LegalRequestID,
		RequesterUserID:    requesterUserID,
		RequesterName:      req.RequesterName,
		Department:         req.Department,
		Question:           req.Question,
		Tags:               req.Tags,
		Metadata:           req.Metadata,
		CreatedBy:          userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start consultation submit transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.consultations.Create(ctx, tx, c); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("consultation_number already exists")
		}
		return nil, internalError("create consultation", err)
	}
	if err := s.appendAudit(ctx, tx, c, userID, "consultation.submitted", nil, ptrString(string(c.Status)), map[string]any{
		"consultation_number": c.ConsultationNumber,
		"type":                c.Type,
	}); err != nil {
		return nil, err
	}
	// WS3: materialise the self-contained ack + response SLA clock in the same tx as
	// the insert, so a submitted consultation is immediately on the clock. Idempotent
	// + best-effort: a missing calendar logs and continues, the consultation still
	// commits.
	s.startSLAClock(ctx, tx, c, userID)
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit consultation submit", err)
	}
	// C-2 / WS3: refresh the linked request's shared clock (best-effort, post-commit).
	s.nudgeRequestSLA(ctx, tenantID, userID, c)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.consultation.submitted", tenantID, &userID, map[string]any{
		"id":                  c.ID,
		"consultation_number": c.ConsultationNumber,
		"type":                c.Type,
		"status":              c.Status,
		"legal_request_id":    c.LegalRequestID,
	}, s.logger)
	s.emitLedger(ctx, c, userID, "consultation.submitted", "info", nil, map[string]any{
		"status":              string(c.Status),
		"consultation_number": c.ConsultationNumber,
		"type":                string(c.Type),
		"priority":            string(c.Priority),
	})
	return s.Get(ctx, tenantID, c.ID)
}

func (s *ConsultationService) List(ctx context.Context, tenantID uuid.UUID, filters model.ConsultationListFilters) ([]model.Consultation, int, error) {
	return s.consultations.List(ctx, tenantID, filters, s.now().UTC())
}

// Stats returns the aggregate KPI rollup over the filtered population (CORE #3).
// It layers the in-process duration-fact average time-to-respond onto the grouped
// status/SLA counts; the fact average is best-effort (0 when unavailable).
func (s *ConsultationService) Stats(ctx context.Context, tenantID uuid.UUID, filters model.ConsultationListFilters) (*model.ConsultationStats, error) {
	stats, err := s.consultations.Stats(ctx, tenantID, filters, s.now().UTC())
	if err != nil {
		return nil, internalError("aggregate consultation stats", err)
	}
	// Layer the processing-time analytics (time-to-respond) from the duration-fact
	// store when wired. The window mirrors the list created_from/created_to bounds so
	// the average tracks the same period as the cards. Best-effort: a fact-store error
	// degrades to a zero average rather than failing the whole stats call.
	if s.durationFacts != nil {
		rf := model.ReportFilters{From: filters.CreatedFrom, To: filters.CreatedTo}
		if avgHours, sample, derr := s.durationFacts.AverageWorkingHours(ctx, tenantID, model.DurationFactConsultationAnswer, rf); derr != nil {
			s.logger.Warn().Err(derr).Msg("consultation stats: respond-duration average skipped")
		} else {
			stats.AvgRespondMinutes = avgHours * 60.0
			stats.ResponseSample = sample
		}
	}
	return stats, nil
}

// DistinctTags returns the sorted distinct tag set for the tenant (CORE #5).
func (s *ConsultationService) DistinctTags(ctx context.Context, tenantID uuid.UUID) ([]string, error) {
	tags, err := s.consultations.DistinctTags(ctx, tenantID)
	if err != nil {
		return nil, internalError("list consultation tags", err)
	}
	return tags, nil
}

// AdvisorWorkload returns open-consultation counts grouped by advisor (BEST-EFFORT #6).
func (s *ConsultationService) AdvisorWorkload(ctx context.Context, tenantID uuid.UUID) ([]model.ConsultationAdvisorWorkload, error) {
	rows, err := s.consultations.AdvisorWorkload(ctx, tenantID)
	if err != nil {
		return nil, internalError("list consultation advisor workload", err)
	}
	return rows, nil
}

// Get loads the consultation and hydrates its documents.
func (s *ConsultationService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.Consultation, error) {
	c, err := s.consultations.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("consultation not found")
		}
		return nil, internalError("load consultation", err)
	}
	if c.Documents, err = s.consultations.ListDocuments(ctx, tenantID, id); err != nil {
		return nil, internalError("load consultation documents", err)
	}
	// #7: surface active legal-hold state on the detail view (best-effort — a hold
	// lookup hiccup must not fail the Get). When unwired, legal_hold stays false.
	s.hydrateLegalHold(ctx, tenantID, c)
	return c, nil
}

// hydrateLegalHold populates c.LegalHold / LegalHoldID / LegalHoldReason from the
// optional hold querier. Best-effort and nil-safe: an unwired querier or a lookup
// error leaves the zero value (legal_hold=false).
func (s *ConsultationService) hydrateLegalHold(ctx context.Context, tenantID uuid.UUID, c *model.Consultation) {
	if s.holdQuerier == nil || c == nil {
		return
	}
	holds, err := s.holdQuerier.GetActiveHoldsForSubject(ctx, tenantID, legalHoldSubjectConsultation, c.ID)
	if err != nil {
		s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation legal-hold hydrate skipped")
		return
	}
	if len(holds) == 0 {
		return
	}
	c.LegalHold = true
	hold := holds[0]
	id := hold.ID
	c.LegalHoldID = &id
	if reason := strings.TrimSpace(hold.Reason); reason != "" {
		c.LegalHoldReason = &reason
	}
}

// LegalHoldStatus returns the active legal holds (if any) on the consultation, for
// the dedicated GET /consultations/{id}/legal-hold endpoint (#7). It first verifies
// the consultation exists (tenant-scoped) so a bad id is a 404. A nil querier yields
// an empty, not-held result.
func (s *ConsultationService) LegalHoldStatus(ctx context.Context, tenantID, id uuid.UUID) (bool, []model.LegalHold, error) {
	if _, err := s.consultations.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return false, nil, notFoundError("consultation not found")
		}
		return false, nil, internalError("load consultation", err)
	}
	if s.holdQuerier == nil {
		return false, []model.LegalHold{}, nil
	}
	holds, err := s.holdQuerier.GetActiveHoldsForSubject(ctx, tenantID, legalHoldSubjectConsultation, id)
	if err != nil {
		return false, nil, internalError("list consultation legal holds", err)
	}
	if holds == nil {
		holds = []model.LegalHold{}
	}
	return len(holds) > 0, holds, nil
}

// Classify assigns the consultation type (CAP-127): submitted → classified.
func (s *ConsultationService) Classify(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.ClassifyConsultationRequest) (*model.Consultation, error) {
	req.Normalize()
	if !req.Type.Valid() {
		return nil, validationError("invalid consultation type", map[string]string{"type": "invalid"})
	}
	if req.Priority != nil {
		if _, ok := allowedLegalPriorities[*req.Priority]; !ok {
			return nil, validationError("invalid priority", map[string]string{"priority": "invalid"})
		}
	}
	c, err := s.loadForTransition(ctx, tenantID, id, model.ConsultationStatusClassified)
	if err != nil {
		return nil, err
	}
	priority := c.Priority
	if req.Priority != nil {
		priority = *req.Priority
	}
	previous := string(c.Status)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start consultation classify transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.consultations.UpdateClassification(ctx, tx, tenantID, id, req.Type, priority, model.ConsultationStatusClassified); err != nil {
		return nil, s.mapMutationError("classify consultation", err)
	}
	c.Type, c.Priority, c.Status = req.Type, priority, model.ConsultationStatusClassified
	if err := s.appendAudit(ctx, tx, c, userID, "consultation.classified", &previous, ptrString(string(c.Status)), map[string]any{
		"type":     req.Type,
		"priority": priority,
		"notes":    req.Notes,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit consultation classify", err)
	}
	s.emitStatus(ctx, tenantID, userID, "com.clario360.lex.consultation.classified", id, previous, c.Status, map[string]any{"type": req.Type})
	s.emitLedger(ctx, c, userID, "consultation.classified", "info", &previous, map[string]any{
		"status":   string(c.Status),
		"type":     string(req.Type),
		"priority": string(priority),
	})
	return s.Get(ctx, tenantID, id)
}

// Route assigns the consultation to an advisor (CAP-129): classified → routed.
func (s *ConsultationService) Route(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.RouteConsultationRequest) (*model.Consultation, error) {
	req.Normalize()
	if req.AdvisorID == uuid.Nil {
		return nil, validationError("advisor_id is required", map[string]string{"advisor_id": "required"})
	}
	c, err := s.loadForTransition(ctx, tenantID, id, model.ConsultationStatusRouted)
	if err != nil {
		return nil, err
	}
	previous := string(c.Status)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start consultation route transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.consultations.UpdateRoute(ctx, tx, tenantID, id, req.AdvisorID, req.AdvisorName, model.ConsultationStatusRouted); err != nil {
		return nil, s.mapMutationError("route consultation", err)
	}
	c.AdvisorID, c.AdvisorName, c.Status = &req.AdvisorID, req.AdvisorName, model.ConsultationStatusRouted
	if err := s.appendAudit(ctx, tx, c, userID, "consultation.routed", &previous, ptrString(string(c.Status)), map[string]any{
		"advisor_id": req.AdvisorID.String(),
		"notes":      req.Notes,
	}); err != nil {
		return nil, err
	}
	// WS3: routing the consultation to an advisor satisfies the ACK rung of the SLA
	// clock (the advisory equivalent of acknowledgement). If the clock was never
	// started (e.g. pre-migration, or no calendar wired), startSLAClock lazily
	// materialises it here so a consultation that skipped submit-time start still
	// gets a response deadline. Both writes are in the same tx + audited.
	s.startSLAClock(ctx, tx, c, userID)
	s.acknowledgeSLAClock(ctx, tx, c, userID)
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit consultation route", err)
	}
	s.nudgeRequestSLA(ctx, tenantID, userID, c)
	s.emitStatus(ctx, tenantID, userID, "com.clario360.lex.consultation.routed", id, previous, c.Status, map[string]any{"advisor_id": req.AdvisorID})
	s.emitLedger(ctx, c, userID, "consultation.routed", "info", &previous, map[string]any{
		"status":     string(c.Status),
		"advisor_id": req.AdvisorID.String(),
	})
	return s.Get(ctx, tenantID, id)
}

// Respond records the advisor's answer (CAP-130): routed → responded. When UseAI
// is set and no explicit response is supplied, the shared drafting engine drafts a
// first-response memo body (Arabic supported via the locale hint).
func (s *ConsultationService) Respond(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.RespondConsultationRequest) (*model.Consultation, error) {
	req.Normalize()
	c, err := s.loadForTransition(ctx, tenantID, id, model.ConsultationStatusResponded)
	if err != nil {
		return nil, err
	}
	response := req.Response
	aiGenerated := false
	if response == "" && req.UseAI {
		drafted, derr := s.draftFirstResponse(ctx, tenantID, c, req.Locale)
		if derr != nil {
			return nil, derr
		}
		response = drafted
		aiGenerated = true
	}
	if strings.TrimSpace(response) == "" {
		return nil, validationError("response is required", map[string]string{"response": "required"})
	}

	now := s.now().UTC()
	lateJustification, err := validateLateJustification(c.SLAResponseDueAt, now, req.LateJustification)
	if err != nil {
		return nil, err
	}
	var managerRole *string
	if lateJustification != nil {
		role := legalContractsManagerRole
		managerRole = &role
	}
	previous := string(c.Status)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start consultation respond transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.consultations.UpdateResponse(ctx, tx, tenantID, id, response, userID, now, model.ConsultationStatusResponded, lateJustification, managerRole); err != nil {
		return nil, s.mapMutationError("respond consultation", err)
	}
	c.Response, c.RespondedBy, c.RespondedAt, c.Status = &response, &userID, &now, model.ConsultationStatusResponded
	c.LateJustification, c.LateJustificationSubmittedBy, c.LateJustificationSubmittedAt, c.LateJustificationManagerRole = lateJustification, nil, nil, managerRole
	if lateJustification != nil {
		c.LateJustificationSubmittedBy, c.LateJustificationSubmittedAt = &userID, &now
	}
	if err := s.appendAudit(ctx, tx, c, userID, "consultation.responded", &previous, ptrString(string(c.Status)), map[string]any{
		"ai_generated":                aiGenerated,
		"notes":                       req.Notes,
		"late_justification_recorded": lateJustification != nil,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit consultation respond", err)
	}
	// C-2: record the consultation_answer processing-time fact in-process (created_at
	// → responded_at). Idempotent keyed upsert; best-effort so a reporting hiccup never
	// fails the answer. The out-of-process reporting consumer remains a backstop.
	s.recordResponseDurationFact(ctx, tenantID, id, now)
	s.emitStatus(ctx, tenantID, userID, "com.clario360.lex.consultation.responded", id, previous, c.Status, map[string]any{
		"ai_generated": aiGenerated,
		"created_at":   c.CreatedAt,
		"started_at":   c.CreatedAt,
		"responded_at": now,
		"department":   c.Department,
		"type":         c.Type,
	})
	s.emitLedger(ctx, c, userID, "consultation.responded", "info", &previous, map[string]any{
		"status":       string(c.Status),
		"ai_generated": aiGenerated,
		"responded_at": now.Format(time.RFC3339Nano),
	})
	return s.Get(ctx, tenantID, id)
}

// DraftResponse returns an AI-suggested first-response memo body WITHOUT
// transitioning the consultation (#8). It reuses the same drafter the Respond flow
// uses (draftFirstResponse), so the UI can offer "Draft with AI → review/edit/
// regenerate" before committing. The consultation must be in a routed state (the
// point at which a response is being prepared); a nil drafter is a 422. No FSM edge
// is taken and no audit row is appended (this is a read-only preview).
func (s *ConsultationService) DraftResponse(ctx context.Context, tenantID, id uuid.UUID, locale string) (string, error) {
	c, err := s.consultations.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", notFoundError("consultation not found")
		}
		return "", internalError("load consultation", err)
	}
	if c.Status != model.ConsultationStatusRouted {
		return "", conflictError(fmt.Sprintf("consultation must be routed to draft a response (current: %s)", c.Status))
	}
	return s.draftFirstResponse(ctx, tenantID, c, strings.ToLower(strings.TrimSpace(locale)))
}

// Archive moves an approved consultation to archived (CAP-132). It is refused
// while the consultation is under an active legal hold (preservation).
func (s *ConsultationService) Archive(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.ArchiveConsultationRequest) (*model.Consultation, error) {
	req.Normalize()
	c, err := s.loadForTransition(ctx, tenantID, id, model.ConsultationStatusArchived)
	if err != nil {
		return nil, err
	}
	if err := ensureMutable(ctx, s.legalHolds, tenantID, legalHoldSubjectConsultation, id); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	previous := string(c.Status)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start consultation archive transaction", err)
	}
	defer tx.Rollback(ctx)
	// Concurrency: re-read the status under a row lock and re-check the FSM edge so
	// two concurrent archives cannot both pass the guard taken before the tx. The
	// lock is released on commit/rollback.
	locked, err := s.consultations.LockForStatus(ctx, tx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("consultation not found")
		}
		return nil, internalError("lock consultation for archive", err)
	}
	if locked != model.ConsultationStatusApproved {
		return nil, conflictError(fmt.Sprintf("illegal consultation transition %s -> %s", locked, model.ConsultationStatusArchived))
	}
	if err := s.consultations.Archive(ctx, tx, tenantID, id, now); err != nil {
		return nil, s.mapMutationError("archive consultation", err)
	}
	c.Status, c.ArchivedAt = model.ConsultationStatusArchived, &now
	if err := s.appendAudit(ctx, tx, c, userID, "consultation.archived", &previous, ptrString(string(c.Status)), map[string]any{
		"reason": req.Reason,
	}); err != nil {
		return nil, err
	}
	// WS3: archiving is a terminal state — resolve the SLA outcome if it is still
	// pending (an approved-then-archived consultation that never resolved on approval,
	// e.g. one with no approval workflow). Idempotent + in the same tx + audited.
	s.resolveSLAOutcome(ctx, tx, c, userID, now, "archive")
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit consultation archive", err)
	}
	s.emitStatus(ctx, tenantID, userID, "com.clario360.lex.consultation.archived", id, previous, c.Status, map[string]any{"reason": req.Reason})
	s.emitLedger(ctx, c, userID, "consultation.archived", "info", &previous, map[string]any{
		"status": string(c.Status),
		"reason": req.Reason,
	})
	return s.Get(ctx, tenantID, id)
}

func (s *ConsultationService) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	// A held consultation cannot be removed.
	if err := ensureMutable(ctx, s.legalHolds, tenantID, legalHoldSubjectConsultation, id); err != nil {
		return err
	}
	if err := s.consultations.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("consultation not found")
		}
		return internalError("delete consultation", err)
	}
	return nil
}

// --- documents (CAP-128) ----------------------------------------------------

// AttachDocument links a Files-service object to the consultation (CAP-128).
func (s *ConsultationService) AttachDocument(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.AttachConsultationDocumentRequest) (*model.ConsultationDocument, error) {
	req.Normalize()
	if req.FileID == uuid.Nil {
		return nil, validationError("file_id is required", map[string]string{"file_id": "required"})
	}
	if req.FileName == "" {
		return nil, validationError("file_name is required", map[string]string{"file_name": "required"})
	}
	c, err := s.consultations.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("consultation not found")
		}
		return nil, internalError("load consultation", err)
	}
	doc := &model.ConsultationDocument{
		ID:             uuid.New(),
		TenantID:       tenantID,
		ConsultationID: c.ID,
		FileID:         req.FileID,
		FileName:       req.FileName,
		FileSize:       req.FileSize,
		ContentType:    req.ContentType,
		Kind:           req.Kind,
		Metadata:       req.Metadata,
		CreatedBy:      userID,
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start consultation attach transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.consultations.AttachDocument(ctx, tx, doc); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("file is already attached to this consultation")
		}
		return nil, internalError("attach consultation document", err)
	}
	if err := s.appendAudit(ctx, tx, c, userID, "consultation.document_attached", nil, nil, map[string]any{
		"document_id": doc.ID.String(),
		"file_id":     doc.FileID.String(),
		"file_name":   doc.FileName,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit consultation attach", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.consultation.document_attached", tenantID, &userID, map[string]any{
		"id":          id,
		"document_id": doc.ID,
		"file_id":     doc.FileID,
	}, s.logger)
	return doc, nil
}

// DetachDocument removes a document link (CAP-128). Refused while the
// consultation is under an active legal hold (preservation).
func (s *ConsultationService) DetachDocument(ctx context.Context, tenantID, userID, id, documentID uuid.UUID) error {
	if err := ensureMutable(ctx, s.legalHolds, tenantID, legalHoldSubjectConsultation, id); err != nil {
		return err
	}
	c, err := s.consultations.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("consultation not found")
		}
		return internalError("load consultation", err)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start consultation detach transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.consultations.DetachDocument(ctx, tenantID, id, documentID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("consultation document not found")
		}
		return internalError("detach consultation document", err)
	}
	if err := s.appendAudit(ctx, tx, c, userID, "consultation.document_detached", nil, nil, map[string]any{
		"document_id": documentID.String(),
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit consultation detach", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.consultation.document_detached", tenantID, &userID, map[string]any{
		"id":          id,
		"document_id": documentID,
	}, s.logger)
	return nil
}

func (s *ConsultationService) ListDocuments(ctx context.Context, tenantID, id uuid.UUID) ([]model.ConsultationDocument, error) {
	if _, err := s.consultations.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("consultation not found")
		}
		return nil, internalError("load consultation", err)
	}
	docs, err := s.consultations.ListDocuments(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load consultation documents", err)
	}
	return docs, nil
}

// ListAudit returns the append-only governance audit trail.
func (s *ConsultationService) ListAudit(ctx context.Context, tenantID, id uuid.UUID) ([]model.ConsultationAuditEntry, error) {
	if _, err := s.consultations.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("consultation not found")
		}
		return nil, internalError("load consultation", err)
	}
	entries, err := s.consultations.ListAudit(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load consultation audit", err)
	}
	return entries, nil
}

// --- internals --------------------------------------------------------------

// loadForTransition loads the consultation and verifies the requested target is a
// legal FSM edge from its current status.
func (s *ConsultationService) loadForTransition(ctx context.Context, tenantID, id uuid.UUID, target model.ConsultationStatus) (*model.Consultation, error) {
	c, err := s.consultations.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("consultation not found")
		}
		return nil, internalError("load consultation", err)
	}
	if !consultationTransitionAllowed(c.Status, target) {
		return nil, conflictError(fmt.Sprintf("illegal consultation transition %s -> %s", c.Status, target))
	}
	return c, nil
}

// appendAudit appends the immutable governance audit row inside the caller's tx.
func (s *ConsultationService) appendAudit(ctx context.Context, tx pgx.Tx, c *model.Consultation, userID uuid.UUID, action string, fromStatus, toStatus *string, detail map[string]any) error {
	entry := &model.ConsultationAuditEntry{
		ID:             uuid.New(),
		TenantID:       c.TenantID,
		ConsultationID: c.ID,
		Action:         action,
		FromStatus:     fromStatus,
		ToStatus:       toStatus,
		Detail:         detail,
		ActorUserID:    userID,
	}
	if err := s.consultations.AppendAudit(ctx, tx, entry); err != nil {
		return internalError("append consultation audit", err)
	}
	return nil
}

// --- WS3: self-contained consultation SLA clock -----------------------------

// startSLAClock materialises the ack + response deadlines for the consultation
// from the frozen working calendar, inside the caller's tx, and appends a
// governance audit row in the SAME tx. It is idempotent: the repository guards on
// sla_started_at IS NULL, so a repeated start (submit then route) is a no-op. All
// failures are non-fatal: a missing calendar / unwired provider logs and the
// mutation still commits without a clock. Requires the SLA provider to be wired via
// SetSLAService; otherwise it is a no-op.
func (s *ConsultationService) startSLAClock(ctx context.Context, tx pgx.Tx, c *model.Consultation, userID uuid.UUID) {
	if s.slaCalendars == nil {
		return
	}
	calc, err := s.slaCalendars.DefaultCalculator(ctx, c.TenantID)
	if err != nil || calc == nil {
		if err != nil {
			s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation sla clock start skipped: calendar")
		}
		return
	}
	startedAt := s.now().UTC()
	urgent := consultationSLAUrgent(c.Priority)
	var ackDue time.Time
	if urgent {
		ackDue = calc.AddWorkingHours(startedAt, time.Duration(s.slaConfig.AckWorkingHoursUrgent)*time.Hour)
	} else {
		ackDue = calc.AddWorkingDays(startedAt, s.slaConfig.AckWorkingDaysNormal)
	}
	responseDays := s.slaConfig.ResponseWorkingDaysNormal
	if urgent {
		responseDays = s.slaConfig.ResponseWorkingDaysUrgent
	}
	responseDue := calc.AddWorkingDays(startedAt, responseDays)
	targetMinutes := calc.WorkingMinutesBetween(startedAt, responseDue)

	snap := repository.ConsultationSLASnapshot{
		StartedAt:     &startedAt,
		AckDueAt:      &ackDue,
		ResponseDueAt: &responseDue,
		TargetMinutes: &targetMinutes,
	}
	if err := s.consultations.StartSLAClock(ctx, tx, c.TenantID, c.ID, snap); err != nil {
		if err == pgx.ErrNoRows {
			// Already started — idempotent no-op.
			return
		}
		s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation sla clock start skipped")
		return
	}
	if err := s.appendAudit(ctx, tx, c, userID, "consultation.sla_clock_started", nil, nil, map[string]any{
		"sla_started_at":      startedAt.Format(time.RFC3339Nano),
		"sla_ack_due_at":      ackDue.Format(time.RFC3339Nano),
		"sla_response_due_at": responseDue.Format(time.RFC3339Nano),
		"sla_target_minutes":  targetMinutes,
		"urgent":              urgent,
	}); err != nil {
		s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation sla clock start audit skipped")
	}
}

// acknowledgeSLAClock satisfies the ack rung when the consultation is routed to an
// advisor, inside the caller's tx, appending a governance audit row in the same tx.
// Idempotent (the repository guards on sla_ack_done = FALSE) and non-fatal.
func (s *ConsultationService) acknowledgeSLAClock(ctx context.Context, tx pgx.Tx, c *model.Consultation, userID uuid.UUID) {
	ackedAt := s.now().UTC()
	if err := s.consultations.MarkSLAAcknowledged(ctx, tx, c.TenantID, c.ID, ackedAt); err != nil {
		if err == pgx.ErrNoRows {
			// No clock, or already acknowledged — idempotent no-op.
			return
		}
		s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation sla acknowledge skipped")
		return
	}
	if err := s.appendAudit(ctx, tx, c, userID, "consultation.sla_acknowledged", nil, nil, map[string]any{
		"sla_ack_done_at": ackedAt.Format(time.RFC3339Nano),
	}); err != nil {
		s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation sla acknowledge audit skipped")
	}
}

// resolveSLAOutcome stamps the terminal on_time/breached verdict on the
// consultation's SLA clock, inside the caller's tx, appending a governance audit
// row in the same tx. The verdict is the answer instant (responded_at) vs the
// materialised response deadline; if there is no answer yet (resolved at archive of
// an answered-then-approved consultation), responded_at is authoritative. Idempotent
// (repository guards on sla_outcome = 'pending') and non-fatal. trigger labels the
// resolving transition ("approval" | "archive").
func (s *ConsultationService) resolveSLAOutcome(ctx context.Context, tx pgx.Tx, c *model.Consultation, userID uuid.UUID, now time.Time, trigger string) {
	snap, err := s.consultations.GetSLASnapshot(ctx, tx, c.TenantID, c.ID)
	if err != nil {
		if err != pgx.ErrNoRows {
			s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation sla resolve skipped: snapshot")
		}
		return
	}
	if snap.StartedAt == nil || snap.Outcome != model.SLAClockOutcomePending {
		// No clock, or already terminal — idempotent no-op.
		return
	}
	// The measured completion instant is the response time; fall back to now if the
	// consultation reached a terminal state without a recorded response.
	completedAt := now
	if c.RespondedAt != nil {
		completedAt = c.RespondedAt.UTC()
	}
	outcome := model.SLAClockOutcomeOnTime
	if snap.ResponseDueAt != nil && completedAt.After(*snap.ResponseDueAt) {
		outcome = model.SLAClockOutcomeBreached
	}
	if err := s.consultations.ResolveSLAOutcome(ctx, tx, c.TenantID, c.ID, outcome, now); err != nil {
		if err == pgx.ErrNoRows {
			return
		}
		s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation sla resolve skipped")
		return
	}
	if err := s.appendAudit(ctx, tx, c, userID, "consultation.sla_resolved", nil, nil, map[string]any{
		"sla_outcome":     string(outcome),
		"sla_resolved_at": now.Format(time.RFC3339Nano),
		"trigger":         trigger,
	}); err != nil {
		s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation sla resolve audit skipped")
	}
}

// nudgeRequestSLA refreshes the shared request-keyed SLA clock when the
// consultation back-links a legal request and the request-SLA bridge is wired.
// StartClock is idempotent (returns the existing clock for the request), so this is
// a safe best-effort post-commit nudge that never affects the consultation result.
func (s *ConsultationService) nudgeRequestSLA(ctx context.Context, tenantID, userID uuid.UUID, c *model.Consultation) {
	if s.requestSLA == nil || c.LegalRequestID == nil || *c.LegalRequestID == uuid.Nil {
		return
	}
	priority := model.SLATargetPriorityNormal
	if consultationSLAUrgent(c.Priority) {
		priority = model.SLATargetPriorityUrgent
	}
	req := dto.StartSLAClockRequest{
		LegalRequestID: *c.LegalRequestID,
		ServiceCode:    "legal_consultation",
		Priority:       priority,
		Metadata: map[string]any{
			"requester_user_id": c.RequesterUserID.String(),
			"requester_name":    c.RequesterName,
			"source":            "lex_consultation",
		},
	}
	if _, err := s.requestSLA.StartClock(ctx, tenantID, userID, req); err != nil {
		s.logger.Debug().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation request-sla nudge skipped")
	}
}

// --- C-2: processing-time duration facts ------------------------------------

// recordResponseDurationFact records the consultation_answer processing-time fact
// in-process (created_at → responded_at). Best-effort and non-fatal: the fact store
// is reporting-side, never load-bearing for the answer. A nil recorder is a no-op.
func (s *ConsultationService) recordResponseDurationFact(ctx context.Context, tenantID, consultationID uuid.UUID, occurredAt time.Time) {
	if s.durationFacts == nil {
		return
	}
	if _, err := s.durationFacts.UpsertFromSource(ctx, tenantID, model.DurationFactConsultationAnswer, consultationID, occurredAt); err != nil {
		s.logger.Warn().Err(err).Str("consultation_id", consultationID.String()).Msg("consultation duration fact skipped")
	}
}

// --- WS4: immutable audit_db ledger emission --------------------------------

// emitLedger routes a material consultation transition to the immutable
// hash-chained audit_db ledger (best-effort, never blocks/fails the business op).
// The in-tx governance audit row (appendAudit) remains the authoritative lex-side
// trail; this is the cross-suite tamper-evident ledger record.
func (s *ConsultationService) emitLedger(ctx context.Context, c *model.Consultation, userID uuid.UUID, action, severity string, fromStatus *string, detail map[string]any) {
	if s.auditEmitter == nil || c == nil {
		return
	}
	actor := userID
	var actorPtr *uuid.UUID
	if actor != uuid.Nil {
		actorPtr = &actor
	}
	if fromStatus != nil {
		detail["from_status"] = *fromStatus
	}
	detail["consultation_number"] = c.ConsultationNumber
	if c.LegalRequestID != nil {
		detail["legal_request_id"] = c.LegalRequestID.String()
	}
	s.auditEmitter.Emit(ctx, LexAuditRecord{
		TenantID:     c.TenantID,
		ActorUserID:  actorPtr,
		Action:       action,
		ResourceType: "lex.consultation",
		ResourceID:   c.ID.String(),
		Severity:     severity,
		Detail:       detail,
	})
}

func (s *ConsultationService) emitStatus(ctx context.Context, tenantID, userID uuid.UUID, eventType string, id uuid.UUID, previous string, status model.ConsultationStatus, extra map[string]any) {
	payload := map[string]any{
		"id":                id,
		"previous_status":   previous,
		"status":            status,
		"status_changed_at": s.now().UTC(),
	}
	for k, v := range extra {
		payload[k] = v
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, eventType, tenantID, &userID, payload, s.logger)
}

// mapMutationError translates a no-rows result from a status-guarded update into a
// 404 (the row was removed concurrently), otherwise wraps it.
func (s *ConsultationService) mapMutationError(message string, err error) error {
	if err == pgx.ErrNoRows {
		return notFoundError("consultation not found")
	}
	return internalError(message, err)
}

// draftFirstResponse uses the shared drafting engine to produce a first-response
// memo body for the consultation (Arabic supported). A nil drafter is a 422.
func (s *ConsultationService) draftFirstResponse(ctx context.Context, tenantID uuid.UUID, c *model.Consultation, locale string) (string, error) {
	if s.drafter == nil {
		return "", validationError("AI drafting is not configured; supply response explicitly", map[string]string{"use_ai": "unsupported"})
	}
	if locale == "" {
		locale = "ar"
	}
	system := "You are a senior in-house legal counsel drafting a concise, well-structured first-response advisory memo for an internal legal consultation. Cite the relevant legal basis at a high level, flag risks, and give an actionable recommendation. Do not fabricate statutes."
	if locale == "ar" {
		system = "أنت مستشار قانوني داخلي أول تقوم بصياغة مذكرة استشارية أولية موجزة ومنظمة ردًا على استشارة قانونية داخلية. اذكر الأساس القانوني بشكل عام، ونبّه إلى المخاطر، وقدّم توصية قابلة للتنفيذ. لا تختلق أنظمة."
	}
	title := c.Title.Localize(locale)
	user := fmt.Sprintf("Consultation type: %s\nTitle: %s\nQuestion:\n%s\n\nDraft the first-response memo body in %s.", c.Type, title, c.Question, locale)
	res, err := s.drafter.RunPrompt(ctx, tenantID, system, user)
	if err != nil {
		return "", internalError("draft consultation response", err)
	}
	if res == nil || strings.TrimSpace(res.Output) == "" {
		return "", internalError("draft consultation response", fmt.Errorf("empty draft output"))
	}
	return strings.TrimSpace(res.Output), nil
}

func consultationTransitionAllowed(from, to model.ConsultationStatus) bool {
	targets, ok := consultationStatusTransitions[from]
	if !ok {
		return false
	}
	_, ok = targets[to]
	return ok
}

func validateConsultationSubmit(req dto.SubmitConsultationRequest) error {
	if req.Title.IsEmpty() {
		return validationError("title is required", map[string]string{"title": "required"})
	}
	if req.RequesterName == "" {
		return validationError("requester_name is required", map[string]string{"requester_name": "required"})
	}
	if req.Question == "" {
		return validationError("question is required", map[string]string{"question": "required"})
	}
	if !req.Type.Valid() {
		return validationError("invalid consultation type", map[string]string{"type": "invalid"})
	}
	if _, ok := allowedLegalPriorities[req.Priority]; !ok {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	return nil
}
