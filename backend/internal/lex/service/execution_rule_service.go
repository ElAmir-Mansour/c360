package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/calendar"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// defaultMaxReviewRounds is the CAP-026 cap: after this many returned review
// rounds the engine auto-closes the request and spawns a clone treated as a new
// request under a fresh SLA.
const defaultMaxReviewRounds = 2

// defaultExecutionSLATargetSeconds is the fallback execution target emitted on
// the clock-start event when neither the caller nor the request metadata pins
// one. The SLA module owns deadline policy; this is only a sensible default so a
// target is always present on the event the SLA module consumes.
const defaultExecutionSLATargetSeconds int64 = 5 * 8 * 60 * 60 // 5 working days @ 8h

// CalculatorProvider yields a frozen working-time calendar.Calculator (contract
// C-1). It is satisfied by *WorkingCalendarService (CalculatorFor /
// DefaultCalculator); the execution engine depends on this seam rather than the
// repository so all working-time math has one implementation (CAP-029).
type CalculatorProvider interface {
	CalculatorFor(ctx context.Context, tenantID, id uuid.UUID) (calendar.Calculator, error)
	DefaultCalculator(ctx context.Context, tenantID uuid.UUID) (calendar.Calculator, error)
}

// SLAStarter is the narrow seam Execution uses to materialise the SLA clock
// in-process the instant completeness is confirmed (the audit's "execution.clock_started
// has no subscriber" gap). It is satisfied by *SLAService.StartClock, which is
// idempotent (a repeated start for the same request returns the existing clock).
// Execution depends on this interface, not on *SLAService, so the two domains stay
// decoupled and the bridge is optional in tests.
type SLAStarter interface {
	StartClock(ctx context.Context, tenantID, userID uuid.UUID, req dto.StartSLAClockRequest) (*model.SLAClock, error)
}

// RequirementCatalog resolves the routed service's required-attachment/data
// configuration so EnsureState can SEED the per-request requirement checklist from
// admin master data (closing the zero-requirement completeness bypass). It is
// satisfied by *repository.AttachmentPolicyRepository.FindApplicable. The seam
// keeps Execution from importing the attachment-policy repository directly and
// stays optional: when not configured, EnsureState seeds nothing and behaviour
// is unchanged from today.
type RequirementCatalog interface {
	FindApplicable(ctx context.Context, tenantID uuid.UUID, requestType, serviceCode string) (*model.AttachmentPolicy, error)
}

// ExecutionRuleService owns the Execution-Rules engine (CAP-022..029). It owns
// the per-request execution clock (clock_started_at, sla_target_seconds,
// completeness): the clock only starts on provider confirmation of a COMPLETE
// request, at which point a clock-start CloudEvent is emitted for the SLA module
// to consume — the two domains coordinate via legal_requests columns + events,
// never by importing each other's Go packages. After two returned review rounds
// the request auto-closes and a clone is spawned via request_clone.go.
type ExecutionRuleService struct {
	db            *pgxpool.Pool
	repo          *repository.ExecutionRepository
	requests      *LegalRequestService
	clone         *RequestCloner
	calendars     CalculatorProvider
	publisher     Publisher
	metrics       *metrics.Metrics
	topic         string
	logger        zerolog.Logger
	now           func() time.Time
	detector      *ChangeDetector
	sla           SLAStarter
	catalog       RequirementCatalog
	attachments   *repository.LegalRequestAttachmentRepository
	domainMetrics *LexDomainMetrics
}

func NewExecutionRuleService(
	db *pgxpool.Pool,
	repo *repository.ExecutionRepository,
	requests *LegalRequestService,
	calendars CalculatorProvider,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *ExecutionRuleService {
	return &ExecutionRuleService{
		db:        db,
		repo:      repo,
		requests:  requests,
		clone:     NewRequestCloner(requests, logger),
		calendars: calendars,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-execution").Logger(),
		now:       time.Now,
		detector:  NewRequestChangeDetector(),
	}
}

// SetChangeDetector overrides the CAP-024 substantial-edit detector (e.g. to
// inject a non-default requirement-churn threshold derived from config). It is a
// seam, mirroring the SetEmailDispatcher pattern: the constructor installs a
// sensible default so callers that do not configure it still get correct
// behaviour. A nil detector is ignored so the default is never clobbered.
func (s *ExecutionRuleService) SetChangeDetector(detector *ChangeDetector) {
	if detector != nil {
		s.detector = detector
	}
}

// SetSLAService installs the in-process SLA clock bridge. Once set, ConfirmCompleteness
// starts the SLA clock the instant the completeness gate passes, so the ack /
// turnaround / escalation deadlines materialise from the working calendar even when
// the Kafka event bus is off (the dev/single-node default). A nil starter is ignored
// so the constructor default (no bridge) is never clobbered; without it Execution
// still emits the clock_started CloudEvent for an out-of-process subscriber.
func (s *ExecutionRuleService) SetSLAService(sla SLAStarter) {
	if sla != nil {
		s.sla = sla
	}
}

// SetRequirementCatalog installs the requirement-seeding source. When set,
// EnsureState seeds the per-request requirement checklist from the routed service's
// attachment-policy slots, so ConfirmCompleteness can enforce a real gate instead of
// passing a zero-requirement request. A nil catalog is ignored.
func (s *ExecutionRuleService) SetRequirementCatalog(catalog RequirementCatalog) {
	if catalog != nil {
		s.catalog = catalog
	}
}

// SetRequestAttachments connects intake documents to the execution
// completeness checklist. Matching clean slot attachments seed requirements as
// already satisfied, so a provider never has to upload the same evidence twice.
func (s *ExecutionRuleService) SetRequestAttachments(attachments *repository.LegalRequestAttachmentRepository) {
	s.attachments = attachments
}

// SetDomainMetrics installs the WS7 runtime collectors so the execution engine
// records clock_started / returned{auto_closed} / two_round_clone counters. A nil
// value is ignored; the record helpers are nil-safe so an unwired engine behaves
// exactly as before (pure observability, no behavioural change).
func (s *ExecutionRuleService) SetDomainMetrics(m *LexDomainMetrics) {
	if m != nil {
		s.domainMetrics = m
	}
}

// RequirementsFor returns the current requirement items for a request. It lets a
// caller (e.g. LegalRequestService.Revise) capture the pre-edit requirement set
// to hand to EvaluateSubstantialEdit as `before`.
func (s *ExecutionRuleService) RequirementsFor(ctx context.Context, tenantID, legalRequestID uuid.UUID) ([]model.RequirementItem, error) {
	return s.repo.ListRequirements(ctx, tenantID, legalRequestID)
}

// EnsureState lazily materializes the execution-state singleton for a request
// that has entered execution. It is idempotent: a second call returns the
// existing row. Requirement items are seeded from the request metadata's
// required-attachment config (the service-catalog seam) on first creation.
func (s *ExecutionRuleService) EnsureState(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID) (*model.ExecutionState, error) {
	request, err := s.requests.Get(ctx, tenantID, legalRequestID)
	if err != nil {
		return nil, err
	}
	if existing, err := s.repo.GetStateByRequest(ctx, tenantID, legalRequestID); err == nil {
		return existing, nil
	} else if err != pgx.ErrNoRows {
		return nil, internalError("load execution state", err)
	}

	state := &model.ExecutionState{
		ID:                  uuid.New(),
		TenantID:            tenantID,
		LegalRequestID:      legalRequestID,
		Status:              model.ExecutionStatusAwaitingCompleteness,
		ReviewRoundCount:    0,
		MaxReviewRounds:     defaultMaxReviewRounds,
		ClonedFromRequestID: clonedFromRequestIDFromMetadata(request.Metadata),
		Metadata:            map[string]any{},
		CreatedBy:           userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start execution state transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.repo.CreateState(ctx, tx, state); err != nil {
		if isUniqueViolation(err) {
			// Concurrent creation: fall back to the persisted row.
			if existing, gerr := s.repo.GetStateByRequest(ctx, tenantID, legalRequestID); gerr == nil {
				return existing, nil
			}
			return nil, conflictError("execution state already exists")
		}
		return nil, internalError("create execution state", err)
	}
	// Seed the requirement checklist from the routed service's attachment-policy
	// config IN THE SAME TX so the completeness gate has real items the moment the
	// state exists (closing the zero-requirement bypass). Seeding is best-effort:
	// a catalog lookup failure must not block opening execution, so it is logged
	// and the request proceeds with whatever items exist (manual ones, or none).
	seededCount, err := s.seedRequirementsFromCatalog(ctx, tx, tenantID, userID, request)
	if err != nil {
		s.logger.Warn().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("seed requirement items from catalog skipped")
	}
	if err := s.appendAuditTx(ctx, tx, tenantID, legalRequestID, userID, "execution.opened", nil, ptrString(string(model.ExecutionStatusAwaitingCompleteness)),
		map[string]any{"seeded_requirement_count": seededCount}); err != nil {
		return nil, internalError("record execution audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit execution state create", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.opened", tenantID, &userID, map[string]any{
		"id":               state.ID,
		"legal_request_id": legalRequestID,
		"status":           state.Status,
	}, s.logger)
	return state, nil
}

// GetState returns the aggregate read model (state + requirements + review
// rounds + delivery confirmations).
func (s *ExecutionRuleService) GetState(ctx context.Context, tenantID, legalRequestID uuid.UUID) (*dto.ExecutionStateView, error) {
	request, err := s.requests.Get(ctx, tenantID, legalRequestID)
	if err != nil {
		return nil, err
	}
	if err := enforceBaseRequesterOwnRequest(ctx, request); err != nil {
		return nil, err
	}
	state, err := s.repo.GetStateByRequest(ctx, tenantID, legalRequestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			// The execution state is lazily opened by the first execution write.
			// A request can therefore exist before its execution row does; return
			// the nullable read model instead of making the frontend discover this
			// normal lifecycle state through a noisy 404.
			return &dto.ExecutionStateView{
				State:                 nil,
				Requirements:          []model.RequirementItem{},
				ReviewRounds:          []model.ReviewRound{},
				DeliveryConfirmations: []model.DeliveryConfirmation{},
			}, nil
		}
		return nil, internalError("load execution state", err)
	}
	requirements, err := s.repo.ListRequirements(ctx, tenantID, legalRequestID)
	if err != nil {
		return nil, internalError("load requirement items", err)
	}
	rounds, err := s.repo.ListReviewRounds(ctx, tenantID, legalRequestID)
	if err != nil {
		return nil, internalError("load review rounds", err)
	}
	confirmations, err := s.repo.ListDeliveryConfirmations(ctx, tenantID, legalRequestID)
	if err != nil {
		return nil, internalError("load delivery confirmations", err)
	}
	return &dto.ExecutionStateView{
		State:                 state,
		Requirements:          requirements,
		ReviewRounds:          rounds,
		DeliveryConfirmations: confirmations,
	}, nil
}

// --- requirement items -----------------------------------------------------

func (s *ExecutionRuleService) AddRequirement(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID, req dto.CreateRequirementItemRequest) (*model.RequirementItem, error) {
	req.Normalize()
	if req.Code == "" {
		return nil, validationError("code is required", map[string]string{"code": "required"})
	}
	if !req.Kind.Valid() {
		return nil, validationError("invalid requirement kind", map[string]string{"kind": "invalid"})
	}
	if _, err := s.EnsureState(ctx, tenantID, userID, legalRequestID); err != nil {
		return nil, err
	}
	required := true
	if req.Required != nil {
		required = *req.Required
	}
	item := &model.RequirementItem{
		ID:             uuid.New(),
		TenantID:       tenantID,
		LegalRequestID: legalRequestID,
		Code:           req.Code,
		Label:          req.Label,
		Kind:           req.Kind,
		Required:       required,
		Satisfied:      false,
		SortOrder:      req.SortOrder,
		Metadata:       req.Metadata,
		CreatedBy:      userID,
	}
	if err := s.repo.CreateRequirement(ctx, s.db, item); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a requirement with this code already exists for the request")
		}
		return nil, internalError("create requirement item", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.requirement_added", tenantID, &userID, map[string]any{
		"id":               item.ID,
		"legal_request_id": legalRequestID,
		"code":             item.Code,
		"required":         item.Required,
	}, s.logger)
	return item, nil
}

func (s *ExecutionRuleService) UpdateRequirement(ctx context.Context, tenantID, userID, legalRequestID, itemID uuid.UUID, req dto.UpdateRequirementItemRequest, canManage bool) (*model.RequirementItem, error) {
	req.Normalize()
	request, err := s.requests.Get(ctx, tenantID, legalRequestID)
	if err != nil {
		// LegalRequestService.Get already maps repository misses and failures to
		// their public service errors. Preserve that classification so a stale
		// requester link returns 404 instead of being rewritten to a 500.
		return nil, err
	}
	if !canManage {
		if request.RequesterUserID != userID {
			return nil, forbiddenError("only the request owner may satisfy this requirement")
		}
		if !requesterCanFulfillRequirement(req) {
			return nil, forbiddenError("request owners may only supply requirement evidence")
		}
	}
	item, err := s.repo.GetRequirement(ctx, tenantID, itemID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("requirement item not found")
		}
		return nil, internalError("load requirement item", err)
	}
	if item.LegalRequestID != legalRequestID {
		return nil, notFoundError("requirement item not found")
	}
	applyRequirementUpdate(item, req, userID, s.now().UTC())
	if !item.Kind.Valid() {
		return nil, validationError("invalid requirement kind", map[string]string{"kind": "invalid"})
	}
	if err := s.repo.UpdateRequirement(ctx, s.db, item); err != nil {
		return nil, internalError("update requirement item", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.requirement_updated", tenantID, &userID, map[string]any{
		"id":               item.ID,
		"legal_request_id": legalRequestID,
		"satisfied":        item.Satisfied,
	}, s.logger)
	return item, nil
}

func requesterCanFulfillRequirement(req dto.UpdateRequirementItemRequest) bool {
	if req.Code != nil || req.Label != nil || req.Kind != nil || req.Required != nil ||
		req.SortOrder != nil || req.Metadata != nil {
		return false
	}
	if req.Satisfied == nil || !*req.Satisfied {
		return false
	}
	return req.FileID != nil || req.DataValue != nil
}

func (s *ExecutionRuleService) DeleteRequirement(ctx context.Context, tenantID, legalRequestID, itemID uuid.UUID) error {
	item, err := s.repo.GetRequirement(ctx, tenantID, itemID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("requirement item not found")
		}
		return internalError("load requirement item", err)
	}
	if item.LegalRequestID != legalRequestID {
		return notFoundError("requirement item not found")
	}
	if err := s.repo.DeleteRequirement(ctx, tenantID, itemID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("requirement item not found")
		}
		return internalError("delete requirement item", err)
	}
	return nil
}

// --- completeness + clock start (CAP-022/CAP-023) --------------------------

// ConfirmCompleteness is the provider's confirmation that the request is COMPLETE
// (all required items satisfied). This is the ONLY action that starts the
// execution clock. It records clock_started_at + sla_target_seconds + the
// completeness flag (Execution-owned), transitions the spine to in_execution and
// emits the clock-start event the SLA module consumes (CAP-022/CAP-023/CAP-029).
func (s *ExecutionRuleService) ConfirmCompleteness(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID, req dto.ConfirmCompletenessRequest) (*model.ExecutionState, error) {
	req.Normalize()
	if _, err := s.EnsureState(ctx, tenantID, userID, legalRequestID); err != nil {
		return nil, err
	}
	// Resolve the calendar (CAP-029) BEFORE opening the transaction so a missing
	// calendar fails fast and is not held under the row lock.
	calc, calendarID, err := s.resolveCalculator(ctx, tenantID, req.WorkingCalendarID)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start completeness transaction", err)
	}
	defer tx.Rollback(ctx)

	state, err := s.repo.GetStateByRequestForUpdate(ctx, tx, tenantID, legalRequestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("execution state not found")
		}
		return nil, internalError("lock execution state", err)
	}
	if state.ClockStartedAt != nil {
		return nil, conflictError("execution clock already started")
	}
	if executionStateTerminal(state.Status) {
		return nil, conflictError("execution is already closed")
	}
	requirements, err := s.repo.ListRequirementsForRequest(ctx, tx, tenantID, legalRequestID)
	if err != nil {
		return nil, internalError("load requirement items", err)
	}
	// Completeness gate (CAP-022): close the zero-requirement bypass. When the
	// routed service MANDATES requirements (an active attachment policy with
	// required slots / a minimum count) but the checklist has no required items —
	// e.g. seeding was unavailable or the items were deleted — the request cannot be
	// confirmed complete. Without this a service with mandatory attachments would
	// pass vacuously the instant it has zero items.
	if mandated, mandateErr := s.serviceMandatesRequirements(ctx, tenantID, legalRequestID); mandateErr != nil {
		s.logger.Warn().Err(mandateErr).Str("legal_request_id", legalRequestID.String()).Msg("requirement-mandate check skipped")
	} else if mandated && !hasRequiredRequirement(requirements) {
		return nil, validationError("request is not complete: this service requires supporting items but none are configured", map[string]string{"requirements": "missing_required_items"})
	}
	if missing := unsatisfiedRequirementCodes(requirements); len(missing) > 0 {
		return nil, validationError("request is not complete: required items are unsatisfied", map[string]string{"requirements": joinCodes(missing)})
	}

	now := s.now().UTC()
	target := defaultExecutionSLATargetSeconds
	if req.SLATargetSeconds != nil && *req.SLATargetSeconds > 0 {
		target = *req.SLATargetSeconds
	}
	// Compute the working-calendar-aware deadline so the SLA module receives a
	// concrete due instant on the clock-start event (CAP-029).
	dueAt := calc.AddWorkingHours(now, time.Duration(target)*time.Second)

	prevStatus := state.Status
	state.Status = model.ExecutionStatusInProgress
	state.ClockStartedAt = &now
	completeness := now
	state.CompletenessConfirmed = &completeness
	state.SLATargetSeconds = &target
	state.WorkingCalendarID = calendarID

	if err := s.repo.UpdateState(ctx, tx, state); err != nil {
		return nil, internalError("start execution clock", err)
	}
	if err := s.appendAuditTx(ctx, tx, tenantID, legalRequestID, userID, "execution.clock_started",
		ptrString(string(prevStatus)), ptrString(string(model.ExecutionStatusInProgress)),
		map[string]any{"sla_target_seconds": target, "due_at": dueAt.UTC()},
	); err != nil {
		return nil, internalError("record execution audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit completeness", err)
	}

	// Advance the spine via the shared request service (no SLA package import).
	if _, err := s.requests.Transition(ctx, tenantID, userID, legalRequestID, model.RequestStatusInExecution); err != nil {
		// Spine may already be in_execution; log and continue — the execution
		// state + clock-start event are authoritative for the clock.
		s.logger.Warn().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("spine transition to in_execution skipped")
	}

	// CAP-023: the clock-start event SLA consumes. Carries the calendar + target
	// + computed due instant so SLA never recomputes working-time itself.
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.clock_started", tenantID, &userID, map[string]any{
		"id":                  state.ID,
		"legal_request_id":    legalRequestID,
		"clock_started_at":    now,
		"sla_target_seconds":  target,
		"working_calendar_id": calendarID,
		"due_at":              dueAt.UTC(),
	}, s.logger)
	s.domainMetrics.RecordExecutionClockStarted()

	// In-process SLA bridge: materialise the ack/turnaround/escalation deadlines now
	// instead of relying on an out-of-process subscriber to react to the event above
	// (which is a no-op in the dev/single-node default). StartClock is idempotent and
	// best-effort: a missing SLA target / calendar logs and continues — the execution
	// clock + clock-start event remain authoritative, and an out-of-process consumer
	// can still materialise the clock later.
	s.startSLAClock(ctx, tenantID, userID, legalRequestID, now, calendarID)
	return state, nil
}

// startSLAClock drives the in-process SLA clock bridge. It loads the spine row to
// lift service_code/priority/beneficiary (SLA never imports the request package),
// stamps the requester + calendar onto the clock metadata so the monitor can
// address ack/breach notifications and resolution can measure the target budget,
// then calls the idempotent StartClock. All failures are non-fatal.
func (s *ExecutionRuleService) startSLAClock(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID, startedAt time.Time, calendarID *uuid.UUID) {
	if s.sla == nil {
		return
	}
	request, err := s.requests.Get(ctx, tenantID, legalRequestID)
	if err != nil {
		s.logger.Warn().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("sla clock auto-start skipped: load request")
		return
	}
	metadata := map[string]any{
		"requester_user_id": request.RequesterUserID.String(),
		"requester_name":    request.RequesterName,
	}
	if calendarID != nil && *calendarID != uuid.Nil {
		metadata["working_calendar_id"] = calendarID.String()
	}
	started := startedAt.UTC()
	req := dto.StartSLAClockRequest{
		LegalRequestID:      legalRequestID,
		ServiceCode:         executionRequestServiceCode(request),
		Priority:            executionRequestSLAPriority(request),
		BeneficiaryEntityID: request.BeneficiaryEntityID,
		CalendarID:          calendarID,
		StartedAt:           &started,
		Metadata:            metadata,
	}
	if _, err := s.sla.StartClock(ctx, tenantID, userID, req); err != nil {
		s.logger.Warn().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("sla clock auto-start skipped")
	}
}

// executionRequestSLAPriority maps the request spine priority onto the SLA target
// priority tier (both are urgent|normal); an unknown value defaults to normal so a
// target can still resolve.
func executionRequestSLAPriority(request *model.LegalRequest) model.SLATargetPriority {
	if request.Priority == model.RequestPriorityUrgent {
		return model.SLATargetPriorityUrgent
	}
	return model.SLATargetPriorityNormal
}

// ReturnIncomplete returns the request to the requester as incomplete (CAP-025),
// opening a review round. On the configured Nth return (default 2, CAP-026) the
// engine auto-closes the request and spawns a clone treated as a brand-new
// request under a fresh SLA.
func (s *ExecutionRuleService) ReturnIncomplete(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID, req dto.ReturnIncompleteRequest) (*model.ExecutionState, error) {
	req.Normalize()
	// PRD 6.3: a return MUST carry one of the four controlled deficiency codes —
	// a free-text-only return (no code) is rejected 400. Enforced in the DTO so
	// the create/return validation stays feature-local (see ReturnIncompleteRequest.Validate).
	if fields := req.Validate(); fields != nil {
		return nil, validationError("invalid return-incomplete request", fields)
	}
	if _, err := s.EnsureState(ctx, tenantID, userID, legalRequestID); err != nil {
		return nil, err
	}
	sourceRequest, err := s.requests.Get(ctx, tenantID, legalRequestID)
	if err != nil {
		return nil, err
	}
	cloneAllowed := requestAllowsReexecutionClone(sourceRequest)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start return-incomplete transaction", err)
	}
	defer tx.Rollback(ctx)

	state, err := s.repo.GetStateByRequestForUpdate(ctx, tx, tenantID, legalRequestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("execution state not found")
		}
		return nil, internalError("lock execution state", err)
	}
	if state.Status == model.ExecutionStatusAutoClosed || state.Status == model.ExecutionStatusClosed {
		return nil, conflictError("execution is already closed")
	}
	requirements, err := s.repo.ListRequirementsForRequest(ctx, tx, tenantID, legalRequestID)
	if err != nil {
		return nil, internalError("load requirement items", err)
	}
	missingRequirementCodes, err := returnIncompleteMissingCodes(requirements, req.MissingRequirementCodes)
	if err != nil {
		return nil, err
	}
	// A return-incomplete MUST cite at least one outstanding required requirement:
	// it is the only thing the requester can act on to satisfy the round. Returning
	// against an empty checklist (zero requirements) or one where every required
	// item is already satisfied stranded the requester with nothing to fix and no
	// way to advance — the reviewer must first add the missing requirement, then
	// return, or confirm completeness when nothing is outstanding. This closes the
	// zero-requirement return bypass alongside the zero-requirement completeness one.
	if len(missingRequirementCodes) == 0 {
		return nil, validationError(
			"cannot return incomplete without an outstanding requirement",
			map[string]string{
				"missing_requirement_codes": "add at least one required requirement describing what is missing before returning, or confirm completeness if nothing is outstanding",
			},
		)
	}
	if err := s.markRequirementsUnsatisfied(ctx, tx, requirements, missingRequirementCodes); err != nil {
		return nil, err
	}

	now := s.now().UTC()
	roundNo := state.ReviewRoundCount + 1
	autoClose := roundNo >= maxReviewRounds(state)
	outcome := model.ReviewRoundOutcomeReturned
	if autoClose {
		outcome = model.ReviewRoundOutcomeAutoClosed
	}
	round := &model.ReviewRound{
		ID:             uuid.New(),
		TenantID:       tenantID,
		LegalRequestID: legalRequestID,
		RoundNo:        roundNo,
		Reason:         req.Reason,
		Outcome:        &outcome,
		OpenedBy:       userID,
		OpenedAt:       now,
		ClosedBy:       &userID,
		ClosedAt:       &now,
		Metadata: map[string]any{
			"reason_code":               req.ReasonCode,
			"missing_requirement_codes": missingRequirementCodes,
		},
	}
	if err := s.repo.CreateReviewRound(ctx, tx, round); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a review round with this number already exists")
		}
		return nil, internalError("open review round", err)
	}

	prevStatus := state.Status
	state.ReviewRoundCount = roundNo
	// A return re-opens the requirement gate: the clock pauses until the request
	// is confirmed complete again.
	state.ClockStartedAt = nil
	state.CompletenessConfirmed = nil
	if autoClose {
		state.Status = model.ExecutionStatusAutoClosed
		state.ClosedAt = &now
	} else {
		state.Status = model.ExecutionStatusReturned
	}
	if err := s.repo.UpdateState(ctx, tx, state); err != nil {
		return nil, internalError("update execution state", err)
	}
	if err := s.appendAuditTx(ctx, tx, tenantID, legalRequestID, userID, "execution.returned_incomplete",
		ptrString(string(prevStatus)), ptrString(string(state.Status)),
		map[string]any{
			"round_no":                  roundNo,
			"reason_code":               req.ReasonCode,
			"reason":                    req.Reason,
			"missing_requirement_codes": missingRequirementCodes,
			"auto_closed":               autoClose,
			"clone_allowed":             cloneAllowed,
		},
	); err != nil {
		return nil, internalError("record execution audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit return-incomplete", err)
	}

	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.returned_incomplete", tenantID, &userID, map[string]any{
		"id":                        state.ID,
		"legal_request_id":          legalRequestID,
		"round_no":                  roundNo,
		"reason_code":               req.ReasonCode,
		"reason":                    req.Reason,
		"missing_requirement_codes": missingRequirementCodes,
		"auto_closed":               autoClose,
		"clone_allowed":             cloneAllowed,
	}, s.logger)
	s.domainMetrics.RecordExecutionReturned(autoClose)

	if !autoClose {
		// Move the spine back to returned so the requester can resubmit.
		if _, err := s.requests.Transition(ctx, tenantID, userID, legalRequestID, model.RequestStatusReturned); err != nil {
			s.logger.Warn().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("spine transition to returned skipped")
		}
		return state, nil
	}
	if !cloneAllowed {
		if _, err := s.requests.Transition(ctx, tenantID, userID, legalRequestID, model.RequestStatusReturned); err != nil {
			s.logger.Warn().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("spine transition to returned (clone-limit auto-close) skipped")
		}
		writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.auto_closed", tenantID, &userID, map[string]any{
			"id":               state.ID,
			"legal_request_id": legalRequestID,
			"review_rounds":    roundNo,
			"clone_suppressed": true,
		}, s.logger)
		return state, nil
	}

	// CAP-026: auto-close + spawn a clone treated as a NEW request under a fresh
	// SLA. The clone goes through the shared LegalRequestService.
	clone, err := s.clone.CloneForReexecution(ctx, tenantID, userID, legalRequestID, req.Reason)
	if err != nil {
		if err == ErrReexecutionCloneLimit {
			writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.auto_closed", tenantID, &userID, map[string]any{
				"id":               state.ID,
				"legal_request_id": legalRequestID,
				"review_rounds":    roundNo,
				"clone_suppressed": true,
			}, s.logger)
			return state, nil
		}
		return nil, internalError("spawn request clone", err)
	}
	if err := s.recordCloneLinkage(ctx, tenantID, userID, state, clone.ID); err != nil {
		s.logger.Error().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("record clone linkage failed")
	}
	// Close the original spine.
	if _, err := s.requests.Transition(ctx, tenantID, userID, legalRequestID, model.RequestStatusReturned); err != nil {
		s.logger.Warn().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("spine transition to returned (auto-close) skipped")
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.auto_closed", tenantID, &userID, map[string]any{
		"id":               state.ID,
		"legal_request_id": legalRequestID,
		"clone_request_id": clone.ID,
		"review_rounds":    roundNo,
	}, s.logger)
	s.domainMetrics.RecordExecutionTwoRoundClone()
	return state, nil
}

// EvaluateSubstantialEdit is the CAP-024 hook the request-update path calls
// after an edit to a request that is already in execution. It diffs the
// before/after request + requirement sets via the ChangeDetector; when the edit
// is SUBSTANTIAL it flags the execution state for re-evaluation. Provider
// discretion (the spec's "flag + allow reset"): if the clock had already
// started, the completeness gate is RE-OPENED — clock_started_at /
// completeness_confirmed are cleared and the state returns to
// awaiting_completeness so the provider must re-confirm completeness before the
// clock restarts. A non-substantial edit is a no-op (returns Substantial=false).
//
// It is a no-op (nil decision, no error) when the request has no execution state
// yet: a draft/returned request edited before it entered execution does not need
// re-evaluation — the requirement gate has not been crossed.
//
// before/after are the pre- and post-edit request snapshots; the caller is
// expected to capture `before` via Get BEFORE applying the update and pass the
// returned post-update request as `after`. Requirement sets are loaded here so
// the caller need not.
func (s *ExecutionRuleService) EvaluateSubstantialEdit(
	ctx context.Context,
	tenantID, userID, legalRequestID uuid.UUID,
	before, after *model.LegalRequest,
	beforeReqs []model.RequirementItem,
) (*ChangeDecision, error) {
	state, err := s.repo.GetStateByRequest(ctx, tenantID, legalRequestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			// Request never entered execution: nothing to re-evaluate.
			return nil, nil
		}
		return nil, internalError("load execution state", err)
	}
	if executionStateTerminal(state.Status) {
		// A closed/auto-closed request is immutable for re-evaluation; the edit
		// path should already block this, but guard defensively.
		return nil, nil
	}

	afterReqs, err := s.repo.ListRequirements(ctx, tenantID, legalRequestID)
	if err != nil {
		return nil, internalError("load requirement items", err)
	}

	decision := s.detector.Detect(before, after, beforeReqs, afterReqs)
	if !decision.Substantial {
		return &decision, nil
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start substantial-edit transaction", err)
	}
	defer tx.Rollback(ctx)

	locked, err := s.repo.GetStateByRequestForUpdate(ctx, tx, tenantID, legalRequestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("execution state not found")
		}
		return nil, internalError("lock execution state", err)
	}
	if executionStateTerminal(locked.Status) {
		return nil, nil
	}

	prevStatus := locked.Status
	clockWasRunning := locked.ClockStartedAt != nil

	// Provider discretion: re-open the completeness gate. The clock pauses (it
	// only restarts on a fresh ConfirmCompleteness) and the state returns to
	// awaiting_completeness. The SLA module learns of this via the event below.
	locked.ClockStartedAt = nil
	locked.CompletenessConfirmed = nil
	locked.Status = model.ExecutionStatusAwaitingCompleteness
	if locked.Metadata == nil {
		locked.Metadata = map[string]any{}
	}
	locked.Metadata["last_substantial_edit_reasons"] = decision.reasonStrings()
	locked.Metadata["substantial_edit_count"] = substantialEditCount(locked.Metadata) + 1

	if err := s.repo.UpdateState(ctx, tx, locked); err != nil {
		return nil, internalError("flag execution state for re-evaluation", err)
	}
	if err := s.appendAuditTx(ctx, tx, tenantID, legalRequestID, userID, "execution.substantial_edit",
		ptrString(string(prevStatus)), ptrString(string(locked.Status)),
		map[string]any{
			"reasons":           decision.reasonStrings(),
			"changes":           decision.Changes,
			"clock_was_running": clockWasRunning,
			"gate_reopened":     true,
		},
	); err != nil {
		return nil, internalError("record substantial-edit audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit substantial-edit re-evaluation", err)
	}

	// Re-open the spine so the requester/provider drive the request back through
	// the requirement gate. returned is the canonical "needs rework" state.
	if _, err := s.requests.Transition(ctx, tenantID, userID, legalRequestID, model.RequestStatusReturned); err != nil {
		s.logger.Warn().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("spine transition to returned (substantial-edit) skipped")
	}

	// CAP-024 event: SLA consumes this to pause/void the running clock. It
	// mirrors the clock_started shape so the SLA module never recomputes state.
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.substantial_edit", tenantID, &userID, map[string]any{
		"id":                locked.ID,
		"legal_request_id":  legalRequestID,
		"reasons":           decision.reasonStrings(),
		"changes":           decision.Changes,
		"clock_was_running": clockWasRunning,
		"status":            locked.Status,
	}, s.logger)

	return &decision, nil
}

// substantialEditCount reads the running CAP-024 re-evaluation counter off the
// execution-state metadata, tolerating the several numeric shapes JSON round-
// trips produce (mirrors cloneGeneration in request_clone.go).
func substantialEditCount(metadata map[string]any) int {
	if metadata == nil {
		return 0
	}
	switch v := metadata["substantial_edit_count"].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case int32:
		return int(v)
	case float64:
		return int(v)
	case float32:
		return int(v)
	case jsonNumber:
		n, _ := strconv.Atoi(v.String())
		return n
	default:
		return 0
	}
}

func (s *ExecutionRuleService) recordCloneLinkage(ctx context.Context, tenantID, userID uuid.UUID, state *model.ExecutionState, cloneRequestID uuid.UUID) error {
	state.CloneRequestID = &cloneRequestID
	if state.Metadata == nil {
		state.Metadata = map[string]any{}
	}
	state.Metadata["clone_request_id"] = cloneRequestID.String()
	if err := s.repo.UpdateState(ctx, s.db, state); err != nil {
		return err
	}
	return s.appendAuditTx(ctx, s.db, tenantID, state.LegalRequestID, userID, "execution.clone_created", nil, nil, map[string]any{
		"clone_request_id": cloneRequestID,
	})
}

// seedRequirementsFromCatalog materialises the per-request requirement checklist
// from the routed service's attachment-policy slots. Each REQUIRED slot becomes a
// required attachment requirement; the policy's min_attachment_count, when it
// exceeds the number of named required slots, contributes generic count-fill
// attachment items so the gate reflects the configured minimum. Inserts are
// idempotent: a duplicate (request, code) is a unique violation that is swallowed,
// so a re-run (EnsureState is idempotent) never double-seeds. Returns the number
// of items actually inserted.
//
// It is a no-op (0, nil) when no catalog is wired or no active policy applies — the
// pre-existing behaviour — so callers that have not configured the catalog are
// unaffected.
func (s *ExecutionRuleService) seedRequirementsFromCatalog(ctx context.Context, q repository.Queryer, tenantID, userID uuid.UUID, request *model.LegalRequest) (int, error) {
	if s.catalog == nil || request == nil {
		return 0, nil
	}
	serviceCode := executionRequestServiceCode(request)
	policy, err := s.catalog.FindApplicable(ctx, tenantID, request.RequestType, serviceCode)
	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, nil
		}
		return 0, err
	}
	if policy == nil || !policy.Active {
		return 0, nil
	}

	var submitted []model.LegalRequestAttachment
	if s.attachments != nil {
		submitted, err = s.attachments.ListWith(ctx, q, tenantID, request.ID)
		if err != nil {
			return 0, err
		}
	}
	bySlot := make(map[string]model.LegalRequestAttachment, len(submitted))
	for _, attachment := range submitted {
		if attachment.SlotKey != nil && strings.TrimSpace(*attachment.SlotKey) != "" {
			bySlot[strings.ToLower(strings.TrimSpace(*attachment.SlotKey))] = attachment
		}
	}
	consumed := make(map[uuid.UUID]struct{}, len(submitted))

	seeded := 0
	requiredSlots := 0
	for i := range policy.Slots {
		slot := policy.Slots[i]
		if !slot.Required {
			continue
		}
		requiredSlots++
		code := strings.TrimSpace(slot.Key)
		if code == "" {
			continue
		}
		item := &model.RequirementItem{
			ID:             uuid.New(),
			TenantID:       tenantID,
			LegalRequestID: request.ID,
			Code:           code,
			Label:          slot.Label,
			Kind:           model.RequirementKindAttachment,
			Required:       true,
			Satisfied:      false,
			SortOrder:      slot.SortOrder,
			Metadata:       map[string]any{"seeded_from": "attachment_policy", "policy_id": policy.ID.String(), "slot_key": slot.Key},
			CreatedBy:      userID,
		}
		if attachment, ok := bySlot[strings.ToLower(code)]; ok && isAcceptableScanStatus(attachment.VirusScanStatus) {
			fileID := attachment.FileID
			satisfiedAt := attachment.CreatedAt
			satisfiedBy := attachment.UploadedBy
			item.FileID = &fileID
			item.Satisfied = true
			item.SatisfiedAt = &satisfiedAt
			item.SatisfiedBy = &satisfiedBy
			item.Metadata["request_attachment_id"] = attachment.ID.String()
			consumed[attachment.ID] = struct{}{}
		}
		if err := s.repo.CreateRequirement(ctx, q, item); err != nil {
			if isUniqueViolation(err) {
				continue
			}
			return seeded, err
		}
		seeded++
	}

	// When the policy mandates a higher minimum attachment count than the number of
	// named required slots, fill the remainder with generic required attachment
	// items so the completeness gate enforces the configured minimum (CAP-165).
	// Any clean attachment not already consumed by a required named slot may
	// satisfy the count, including a file carrying an optional slot label.
	remaining := make([]model.LegalRequestAttachment, 0, len(submitted))
	for _, attachment := range submitted {
		if _, alreadyUsed := consumed[attachment.ID]; !alreadyUsed && isAcceptableScanStatus(attachment.VirusScanStatus) {
			remaining = append(remaining, attachment)
		}
	}
	for i := requiredSlots; i < policy.MinAttachmentCount; i++ {
		code := fmt.Sprintf("attachment_%d", i+1)
		item := &model.RequirementItem{
			ID:             uuid.New(),
			TenantID:       tenantID,
			LegalRequestID: request.ID,
			Code:           code,
			Label:          forms.LocalizedText{EN: fmt.Sprintf("Required attachment %d", i+1), AR: fmt.Sprintf("مرفق مطلوب %d", i+1)},
			Kind:           model.RequirementKindAttachment,
			Required:       true,
			Satisfied:      false,
			SortOrder:      1000 + i,
			Metadata:       map[string]any{"seeded_from": "attachment_policy_min_count", "policy_id": policy.ID.String()},
			CreatedBy:      userID,
		}
		if len(remaining) > 0 {
			attachment := remaining[0]
			remaining = remaining[1:]
			fileID := attachment.FileID
			satisfiedAt := attachment.CreatedAt
			satisfiedBy := attachment.UploadedBy
			item.FileID = &fileID
			item.Satisfied = true
			item.SatisfiedAt = &satisfiedAt
			item.SatisfiedBy = &satisfiedBy
			item.Metadata["request_attachment_id"] = attachment.ID.String()
		}
		if err := s.repo.CreateRequirement(ctx, q, item); err != nil {
			if isUniqueViolation(err) {
				continue
			}
			return seeded, err
		}
		seeded++
	}
	return seeded, nil
}

// serviceMandatesRequirements reports whether the routed service's attachment
// policy makes supporting items MANDATORY (an active policy with at least one
// required slot or a positive minimum attachment count). It is the gate that closes
// the zero-requirement bypass. When no catalog is wired, or no active policy
// applies, it returns false (no mandate) — preserving today's behaviour.
func (s *ExecutionRuleService) serviceMandatesRequirements(ctx context.Context, tenantID, legalRequestID uuid.UUID) (bool, error) {
	if s.catalog == nil {
		return false, nil
	}
	request, err := s.requests.Get(ctx, tenantID, legalRequestID)
	if err != nil {
		return false, err
	}
	policy, err := s.catalog.FindApplicable(ctx, tenantID, request.RequestType, executionRequestServiceCode(request))
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	if policy == nil || !policy.Active {
		return false, nil
	}
	if policy.MinAttachmentCount > 0 {
		return true, nil
	}
	for i := range policy.Slots {
		if policy.Slots[i].Required {
			return true, nil
		}
	}
	return false, nil
}

// hasRequiredRequirement reports whether the checklist contains at least one
// required item (satisfied or not). Used by the completeness gate to reject a
// vacuous confirmation when the service mandates requirements but the list carries
// none.
func hasRequiredRequirement(items []model.RequirementItem) bool {
	for _, item := range items {
		if item.Required {
			return true
		}
	}
	return false
}

// executionRequestServiceCode resolves the catalog service_code for a request from
// its metadata (the intake pipeline stamps intake_service_code / service_code),
// falling back to the request_type — which equals the service-code constant for
// platform-channel requests. The empty string is returned when nothing resolves;
// FindApplicable then matches on request_type alone.
func executionRequestServiceCode(request *model.LegalRequest) string {
	for _, key := range []string{"service_code", "intake_service_code"} {
		if request.Metadata != nil {
			if code, ok := request.Metadata[key].(string); ok && strings.TrimSpace(code) != "" {
				return strings.TrimSpace(code)
			}
		}
	}
	return strings.TrimSpace(request.RequestType)
}

// resolveCalculator selects the working-time Calculator (CAP-029): the named
// calendar when provided, else the tenant default. The returned uuid is the
// calendar id persisted on the execution state (nil when the default is used and
// no explicit id was supplied).
func (s *ExecutionRuleService) resolveCalculator(ctx context.Context, tenantID uuid.UUID, calendarID *uuid.UUID) (calendar.Calculator, *uuid.UUID, error) {
	if calendarID != nil && *calendarID != uuid.Nil {
		calc, err := s.calendars.CalculatorFor(ctx, tenantID, *calendarID)
		if err != nil {
			return nil, nil, err
		}
		return calc, calendarID, nil
	}
	calc, err := s.calendars.DefaultCalculator(ctx, tenantID)
	if err != nil {
		return nil, nil, err
	}
	return calc, nil, nil
}

func (s *ExecutionRuleService) appendAuditTx(ctx context.Context, q repository.Queryer, tenantID, legalRequestID, actorID uuid.UUID, action string, from, to *string, detail map[string]any) error {
	entry := &model.ExecutionAuditEntry{
		ID:             uuid.New(),
		TenantID:       tenantID,
		LegalRequestID: legalRequestID,
		Action:         action,
		FromStatus:     from,
		ToStatus:       to,
		Detail:         detail,
		ActorUserID:    actorID,
	}
	return s.repo.AppendAudit(ctx, q, entry)
}

// --- helpers ---------------------------------------------------------------

func applyRequirementUpdate(item *model.RequirementItem, req dto.UpdateRequirementItemRequest, userID uuid.UUID, now time.Time) {
	if req.Code != nil {
		item.Code = *req.Code
	}
	if req.Label != nil {
		item.Label = *req.Label
	}
	if req.Kind != nil {
		item.Kind = *req.Kind
	}
	if req.Required != nil {
		item.Required = *req.Required
	}
	if req.SortOrder != nil {
		item.SortOrder = *req.SortOrder
	}
	if req.Metadata != nil {
		item.Metadata = req.Metadata
	}
	if req.FileID != nil {
		item.FileID = req.FileID
	}
	if req.DataValue != nil {
		item.DataValue = req.DataValue
	}
	// Supplying evidence (a file or data value) implicitly satisfies the item;
	// an explicit satisfied flag still wins.
	satisfied := item.Satisfied
	if req.FileID != nil || req.DataValue != nil {
		satisfied = true
	}
	if req.Satisfied != nil {
		satisfied = *req.Satisfied
	}
	if satisfied && !item.Satisfied {
		item.SatisfiedBy = &userID
		item.SatisfiedAt = &now
	}
	if !satisfied {
		item.SatisfiedBy = nil
		item.SatisfiedAt = nil
	}
	item.Satisfied = satisfied
}

func (s *ExecutionRuleService) markRequirementsUnsatisfied(ctx context.Context, q repository.Queryer, requirements []model.RequirementItem, missingCodes []string) error {
	if len(missingCodes) == 0 {
		return nil
	}
	missing := make(map[string]struct{}, len(missingCodes))
	for _, code := range missingCodes {
		missing[code] = struct{}{}
	}
	for i := range requirements {
		item := requirements[i]
		if _, ok := missing[item.Code]; !ok || !item.Satisfied {
			continue
		}
		item.Satisfied = false
		item.SatisfiedBy = nil
		item.SatisfiedAt = nil
		if err := s.repo.UpdateRequirement(ctx, q, &item); err != nil {
			return internalError("mark requirement unsatisfied", err)
		}
	}
	return nil
}

func unsatisfiedRequirementCodes(items []model.RequirementItem) []string {
	var missing []string
	for _, item := range items {
		if item.Required && !item.Satisfied {
			missing = append(missing, item.Code)
		}
	}
	return missing
}

func returnIncompleteMissingCodes(items []model.RequirementItem, requested []string) ([]string, error) {
	if len(requested) == 0 {
		return unsatisfiedRequirementCodes(items), nil
	}
	byCode := make(map[string]model.RequirementItem, len(items))
	for _, item := range items {
		byCode[item.Code] = item
	}
	out := make([]string, 0, len(requested))
	for _, code := range requested {
		item, ok := byCode[code]
		if !ok {
			return nil, validationError("missing requirement code was not found", map[string]string{"missing_requirement_codes": "not_found"})
		}
		if !item.Required {
			return nil, validationError("missing requirement code is not required", map[string]string{"missing_requirement_codes": "not_required"})
		}
		out = append(out, code)
	}
	return out, nil
}

func joinCodes(codes []string) string {
	out := ""
	for i, code := range codes {
		if i > 0 {
			out += ","
		}
		out += code
	}
	return out
}

func maxReviewRounds(state *model.ExecutionState) int {
	if state.MaxReviewRounds > 0 {
		return state.MaxReviewRounds
	}
	return defaultMaxReviewRounds
}

func executionStateTerminal(status model.ExecutionStatus) bool {
	return status == model.ExecutionStatusAutoClosed || status == model.ExecutionStatusClosed
}
