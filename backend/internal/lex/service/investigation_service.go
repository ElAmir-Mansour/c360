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

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/drafting"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

const (
	investigationApprovalWorkflowName = "Lex Legal Investigation Results Approval"
	investigationApprovalStepID       = "investigation_results_approval"
)

var allowedInvestigationPriorities = map[model.LegalPriority]struct{}{
	model.LegalPriorityCritical: {},
	model.LegalPriorityHigh:     {},
	model.LegalPriorityMedium:   {},
	model.LegalPriorityLow:      {},
}

// investigationStatusTransitions is the allowed FSM edge set exposed by the generic
// /status endpoint, mirroring caseStatusTransitions / consultationStatusTransitions.
// The results-approval edges (→ pending_approval / approved / rejected) are
// deliberately absent — they are driven ONLY through the approval-chain endpoints
// (StartApproval / DecideApproval). The approved → closed close-out and the
// rejected → in_progress rework edges ARE admitted here so an approved investigation
// can be closed and a rejected one reworked. This replaces the previous
// IsTerminal()-as-transition-guard, which is a content-mutability predicate (it
// includes approved) and therefore wrongly 409'd the intended approved → closed
// close-out (CAP-083). The edges match the UI's INVESTIGATION_STATUS_TRANSITIONS map.
var investigationStatusTransitions = map[model.InvestigationStatus]map[model.InvestigationStatus]struct{}{
	model.InvestigationStatusRegistered: {
		model.InvestigationStatusInProgress: {},
		model.InvestigationStatusCancelled:  {},
	},
	model.InvestigationStatusInProgress: {
		model.InvestigationStatusCancelled: {},
	},
	model.InvestigationStatusResults: {
		model.InvestigationStatusInProgress: {},
		model.InvestigationStatusCancelled:  {},
	},
	model.InvestigationStatusApproved: {
		model.InvestigationStatusClosed: {},
	},
	model.InvestigationStatusRejected: {
		model.InvestigationStatusInProgress: {},
		model.InvestigationStatusCancelled:  {},
	},
}

// investigationTransitionAllowed reports whether the generic /status endpoint may
// move an investigation from -> to (see investigationStatusTransitions).
func investigationTransitionAllowed(from, to model.InvestigationStatus) bool {
	targets, ok := investigationStatusTransitions[from]
	if !ok {
		return false
	}
	_, ok = targets[to]
	return ok
}

func investigationResultsRecordable(status model.InvestigationStatus) bool {
	return status == model.InvestigationStatusInProgress
}

func investigationRecommendationsRecordable(status model.InvestigationStatus) bool {
	return status == model.InvestigationStatusResults
}

func investigationApprovalSubmittable(status model.InvestigationStatus) bool {
	return status == model.InvestigationStatusResults
}

// InvestigationService is the application service for the legal-investigations
// vertical (CAP-077..083). It owns CRUD over the first-class investigation
// aggregate, its parties/statements/evidence sub-resources, findings +
// recommendation capture (optionally AI-drafted via the shared drafting engine),
// and the CAP-083 results-approval chain — which it drives through the SHARED,
// subject-agnostic ApprovalOrchestrator (via InvestigationApprovalOrchestrator),
// NOT the contract-bound WorkflowService.
//
// Every mutation runs in a transaction, emits a CloudEvent, and appends an
// immutable governance audit row. Mutations are refused once the investigation is
// terminal (approved/closed/cancelled) and — when a case is linked and held — when
// the linked case is under an active legal hold (ensureMutable via LegalHoldGuard).
//
// Hearing/objection-deadline reminders reuse the existing obligation reminder
// outbox + monitor: registering an investigation with a deadline creates a linked
// legal_obligation (no new timer).
type InvestigationService struct {
	db             *pgxpool.Pool
	investigations *repository.InvestigationRepository
	orchestrator   *InvestigationApprovalOrchestrator
	obligations    *ObligationService
	drafter        *drafting.Drafter
	defRepo        *workflowrepo.DefinitionRepository
	instRepo       *workflowrepo.InstanceRepository
	taskRepo       *workflowrepo.TaskRepository
	publisher      Publisher
	metrics        *metrics.Metrics
	topic          string
	logger         zerolog.Logger
	now            func() time.Time
	// legalHolds enforces preservation on the linked case (nil => no enforcement).
	legalHolds LegalHoldGuard
	// sla materialises + resolves the working-day ack/response clock for an
	// investigation (Round-2 WS3). nil => no clock is started (behaviour unchanged).
	sla InvestigationSLAService
	// auditEmitter routes material investigation transitions to the immutable
	// audit_db ledger (Round-2 WS4). nil => no ledger emission (audit_log row only).
	auditEmitter *LexAuditEmitter
	// facts writes the C-2 processing-duration fact on register/results-approved.
	// nil => no fact is written (reports fall back to source-table reconstruction).
	facts InvestigationDurationFactWriter
	// factCalendar supplies the working-time Calculator for the duration fact's
	// working-minutes. nil => working-minutes degrade to wall-clock minutes.
	factCalendar ReportingCalendarPort
	// evidenceFiles verifies that a referenced platform file exists in the same
	// tenant and is bound to this investigation before the reference is persisted.
	evidenceFiles InvestigationEvidenceFileValidator
}

// InvestigationSLAService is the narrow seam the investigations vertical uses to
// materialise (on register/route) and resolve (on results-approval) a working-day
// ack + response SLA clock through the SHARED SLA engine, so the existing
// ack/turnaround/L1-L2-L3 escalation ladder + breach monitor + quarterly KPI
// machinery apply to investigations with no new timer. It is the union of the
// SLAStarter (clock start) and SLAResolver (terminal resolve) seams and is
// satisfied by *SLAService. Investigations are keyed into the shared
// legal_sla_clocks table by their own id (the staged round-2 migration relaxes the
// legal_request_id FK to a generic subject id); the owning org entity flows through
// BeneficiaryEntityID.
type InvestigationSLAService interface {
	StartClock(ctx context.Context, tenantID, userID uuid.UUID, req dto.StartSLAClockRequest) (*model.SLAClock, error)
	ResolveClockForRequest(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID, deliveredAt time.Time) (*model.SLAClock, error)
}

// InvestigationDurationFactWriter is the narrow seam used to upsert the C-2
// processing-duration fact for an investigation. It is satisfied by
// *repository.DurationFactRepository.Upsert (idempotent, keyed by
// tenant/kind/subject). The investigation_resolution kind is admitted by the
// staged round-2 migration that extends the lex_duration_facts kind CHECK.
type InvestigationDurationFactWriter interface {
	Upsert(ctx context.Context, fact *model.DurationFact) error
}

// InvestigationEvidenceFileValidator is satisfied by RequestFileClient. Its
// tenant-scoped metadata endpoint is reused so investigations cannot link an
// arbitrary UUID or a file owned by another tenant/aggregate.
type InvestigationEvidenceFileValidator interface {
	Ready() bool
	Metadata(ctx context.Context, tenantID, fileID string) (*RequestFileMetadata, error)
}

// investigationSLAServiceCode is the synthetic service_code the investigation SLA
// clock resolves its target against. The staged round-2 migration seeds a default
// legal_sla_targets row for this code per tenant (urgent: 4 working-hours ack /
// normal: 1 working-day ack; 3-day turnaround) so StartClock can resolve a target.
const investigationSLAServiceCode = "legal_investigation"

// durationFactInvestigationResolution is the lex_duration_facts kind for an
// investigation's register→results-approved processing window. It is a raw kind
// string (not in model.ValidDurationFactKind, which is owned elsewhere); the staged
// migration admits it in the table CHECK and the writer seam bypasses the Go
// allow-list deliberately.
const durationFactInvestigationResolution model.DurationFactKind = "investigation_resolution"

// NewInvestigationService mirrors the NewLegalCaseIntakeService constructor shape:
// repositories + the shared approval orchestrator + workflow primitives + the
// obligation service (for reminder obligations) + the drafting engine.
func NewInvestigationService(
	db *pgxpool.Pool,
	investigations *repository.InvestigationRepository,
	orchestrator *InvestigationApprovalOrchestrator,
	obligations *ObligationService,
	drafter *drafting.Drafter,
	defRepo *workflowrepo.DefinitionRepository,
	instRepo *workflowrepo.InstanceRepository,
	taskRepo *workflowrepo.TaskRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *InvestigationService {
	return &InvestigationService{
		db:             db,
		investigations: investigations,
		orchestrator:   orchestrator,
		obligations:    obligations,
		drafter:        drafter,
		defRepo:        defRepo,
		instRepo:       instRepo,
		taskRepo:       taskRepo,
		publisher:      publisherOrNoop(publisher),
		metrics:        appMetrics,
		topic:          topic,
		logger:         logger.With().Str("service", "lex-investigations").Logger(),
		now:            time.Now,
	}
}

// WithLegalHoldGuard wires the legal-hold enforcement guard (applied to the linked
// case on destructive operations). Returns the receiver for chaining.
func (s *InvestigationService) WithLegalHoldGuard(guard LegalHoldGuard) *InvestigationService {
	s.legalHolds = guard
	return s
}

// SetSLAService installs the in-process SLA clock bridge (Round-2 WS3). Once set,
// registering an investigation starts a working-day ack + response clock through the
// SHARED SLA engine (so the 0-1d/0-4h ack rung + L1/L2/L3 escalation ladder fire from
// the working calendar), and results-approval resolves it to its terminal
// on_time/breached verdict. A nil service is ignored so the constructor default (no
// clock) is never clobbered; the clock is best-effort and never fails a mutation.
func (s *InvestigationService) SetSLAService(sla InvestigationSLAService) {
	if sla != nil {
		s.sla = sla
	}
}

// SetAuditEmitter installs the immutable-ledger emitter (Round-2 WS4). Once set,
// material investigation transitions (register, results-recorded, approval
// started/resolved) Emit() a tamper-evident record to the audit_db hash-chained
// ledger in addition to the in-tx legal_investigation_audit_log row. A nil emitter
// is ignored. Emission is best-effort and never blocks a mutation.
func (s *InvestigationService) SetAuditEmitter(emitter *LexAuditEmitter) {
	if emitter != nil {
		s.auditEmitter = emitter
	}
}

// SetDurationFactWriter installs the C-2 processing-duration fact writer and the
// working-time calendar port used to compute its working-minutes. Once set, the
// register and results-approved transitions upsert an investigation_resolution
// duration fact. A nil writer is ignored; a nil calendar degrades working-minutes to
// wall-clock minutes. Fact writes are best-effort and never fail a mutation.
func (s *InvestigationService) SetDurationFactWriter(writer InvestigationDurationFactWriter, calendarPort ReportingCalendarPort) {
	if writer != nil {
		s.facts = writer
	}
	if calendarPort != nil {
		s.factCalendar = calendarPort
	}
}

func (s *InvestigationService) SetEvidenceFileValidator(validator InvestigationEvidenceFileValidator) {
	s.evidenceFiles = validator
}

// --- CAP-077: register / CRUD ------------------------------------------------

func (s *InvestigationService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateInvestigationRequest) (*model.LegalInvestigation, error) {
	req.Normalize()
	if err := validateInvestigationCreate(req); err != nil {
		return nil, err
	}
	number := req.InvestigationNumber
	if number == nil {
		generated := fmt.Sprintf("INV-%s-%s", s.now().UTC().Format("20060102"), strings.ToUpper(uuid.NewString()[:8]))
		number = &generated
	}
	inv := &model.LegalInvestigation{
		ID:                  uuid.New(),
		TenantID:            tenantID,
		InvestigationNumber: *number,
		Subject:             req.Subject,
		LeadInvestigator:    req.LeadInvestigator,
		Status:              model.InvestigationStatusRegistered,
		Priority:            req.Priority,
		CaseID:              req.CaseID,
		Department:          req.Department,
		Metadata:            req.Metadata,
		CreatedBy:           userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start investigation transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.investigations.Create(ctx, tx, inv); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("investigation_number already exists")
		}
		return nil, internalError("create investigation", err)
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, inv.ID, userID, "investigation.registered", nil, ptrString(string(model.InvestigationStatusRegistered)), map[string]any{
		"investigation_number": inv.InvestigationNumber,
		"case_id":              caseIDDetail(req.CaseID),
	}, nil, investigationAuditSnapshot(inv), ""); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit investigation create", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.investigation.registered", tenantID, &userID, map[string]any{
		"id":                   inv.ID,
		"investigation_number": inv.InvestigationNumber,
		"status":               inv.Status,
		"case_id":              caseIDDetail(req.CaseID),
	}, s.logger)
	// Round-2 WS3/WS4/C-2 (all best-effort, post-commit, non-fatal):
	//   * start the working-day SLA ack/response clock so the escalation ladder fires;
	//   * Emit() the register transition to the immutable audit ledger;
	//   * write the open-ended processing-duration fact (refreshed on results-approval).
	s.startSLAClock(ctx, tenantID, userID, inv)
	s.emitLedger(ctx, tenantID, &userID, "investigation.registered", inv.ID, "info", nil, investigationLedgerSnapshot(inv), nil)
	s.writeDurationFact(ctx, tenantID, inv, inv.CreatedBy, s.now().UTC(), nil)
	return s.Get(ctx, tenantID, inv.ID)
}

func (s *InvestigationService) List(ctx context.Context, tenantID uuid.UUID, filters model.InvestigationListFilters) ([]model.LegalInvestigation, int, error) {
	return s.investigations.List(ctx, tenantID, filters)
}

// ListOngoing returns a bounded presentation slice of the newest non-terminal
// investigations. Exact portfolio counts belong to the reporting repository and
// must never be derived from this list's length.
func (s *InvestigationService) ListOngoing(ctx context.Context, tenantID uuid.UUID, limit int) ([]model.LegalInvestigation, error) {
	return s.investigations.ListOngoing(ctx, tenantID, limit)
}

func (s *InvestigationService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalInvestigation, error) {
	inv, err := s.load(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	parties, err := s.investigations.ListParties(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load investigation parties", err)
	}
	statements, err := s.investigations.ListStatements(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load investigation statements", err)
	}
	evidence, err := s.investigations.ListEvidence(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load investigation evidence", err)
	}
	inv.Parties = parties
	inv.Statements = statements
	inv.Evidence = evidence
	return inv, nil
}

func (s *InvestigationService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateInvestigationRequest) (*model.LegalInvestigation, error) {
	inv, err := s.load(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start investigation update transaction", err)
	}
	defer tx.Rollback(ctx)
	inv, err = s.lockMutable(ctx, tx, tenantID, id)
	if err != nil {
		return nil, err
	}
	before := investigationAuditSnapshot(inv)
	applyInvestigationUpdate(inv, req)
	if err := validateInvestigation(inv); err != nil {
		return nil, err
	}
	if err := s.investigations.Update(ctx, tx, inv); err != nil {
		return nil, internalError("update investigation", err)
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, id, userID, "investigation.updated", nil, nil,
		map[string]any{"priority": string(inv.Priority)}, before, investigationAuditSnapshot(inv), ""); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit investigation update", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.investigation.updated", tenantID, &userID, map[string]any{
		"id": id,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *InvestigationService) UpdateStatus(ctx context.Context, tenantID, userID, id uuid.UUID, status model.InvestigationStatus, reason string, rawLateJustification *string) (*model.LegalInvestigation, error) {
	if !status.Valid() {
		return nil, validationError("invalid investigation status", map[string]string{"status": "invalid"})
	}
	// Approval-driven transitions must flow through the approval endpoints.
	if status == model.InvestigationStatusPendingApprove || status == model.InvestigationStatusApproved || status == model.InvestigationStatusRejected {
		return nil, conflictError("results-approval transitions are driven through the approval endpoints")
	}
	inv, err := s.load(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	// Gate on the explicit FSM edge map rather than IsTerminal(): the latter is a
	// content-mutability predicate (it includes approved) and wrongly rejected the
	// intended approved -> closed close-out. The map admits exactly the edges the UI
	// offers via INVESTIGATION_STATUS_TRANSITIONS.
	if !investigationTransitionAllowed(inv.Status, status) {
		return nil, conflictError(fmt.Sprintf("investigation cannot transition from %s to %s", inv.Status, status))
	}
	// Preservation still applies to every generic transition (a linked case under an
	// active legal hold blocks the move), but the content-mutability terminal guard
	// must NOT — an approved investigation is intentionally closable.
	if err := s.ensureCaseNotHeld(ctx, tenantID, inv); err != nil {
		return nil, err
	}
	from := string(inv.Status)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start investigation status transaction", err)
	}
	defer tx.Rollback(ctx)
	locked, err := s.investigations.LockForUpdate(ctx, tx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("investigation not found")
		}
		return nil, internalError("lock investigation status", err)
	}
	if !investigationTransitionAllowed(locked.Status, status) {
		return nil, conflictError(fmt.Sprintf("investigation cannot transition from %s to %s", locked.Status, status))
	}
	from = string(locked.Status)
	closedAt := s.now().UTC()
	lateJustificationRecorded := false
	var updateErr error
	if status == model.InvestigationStatusClosed || status == model.InvestigationStatusCancelled {
		var turnaroundDueAt *time.Time
		deadlineErr := tx.QueryRow(ctx, `
			SELECT turnaround_due_at
			FROM legal_sla_clocks
			WHERE tenant_id = $1 AND legal_request_id = $2 AND outcome = 'pending'
			ORDER BY cycle DESC
			LIMIT 1
			FOR SHARE`, tenantID, id).Scan(&turnaroundDueAt)
		if deadlineErr != nil && deadlineErr != pgx.ErrNoRows {
			return nil, internalError("load active investigation SLA deadline", deadlineErr)
		}
		lateJustification, validationErr := validateLateJustification(turnaroundDueAt, closedAt, rawLateJustification)
		if validationErr != nil {
			return nil, validationErr
		}
		var managerRole *string
		if lateJustification != nil {
			role := legalCasesManagerRole
			managerRole = &role
			lateJustificationRecorded = true
		}
		updateErr = s.investigations.UpdateTerminalStatusWithLateJustificationTx(
			ctx, tx, tenantID, id, userID, status, reason, closedAt, lateJustification, managerRole,
		)
	} else {
		updateErr = s.investigations.UpdateStatusTx(ctx, tx, tenantID, id, status, nil)
	}
	if updateErr != nil {
		if updateErr == pgx.ErrNoRows {
			return nil, notFoundError("investigation not found")
		}
		return nil, internalError("update investigation status", updateErr)
	}
	detail := map[string]any{}
	if strings.TrimSpace(reason) != "" {
		detail["reason"] = strings.TrimSpace(reason)
	}
	if status == model.InvestigationStatusClosed || status == model.InvestigationStatusCancelled {
		detail["closed_by"] = userID.String()
		detail["closed_at"] = closedAt.Format(time.RFC3339Nano)
		detail["late_justification_recorded"] = lateJustificationRecorded
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, id, userID, "investigation.status_changed", &from, ptrString(string(status)), detail,
		map[string]any{"status": from}, map[string]any{"status": string(status), "closed_by": detail["closed_by"], "closed_at": detail["closed_at"]}, strings.TrimSpace(reason)); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit investigation status", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.investigation.status_changed", tenantID, &userID, map[string]any{
		"id":     id,
		"status": status,
	}, s.logger)
	if status == model.InvestigationStatusClosed || status == model.InvestigationStatusCancelled {
		// Approval normally resolves the processing clock. Close/cancel repeats the
		// operation idempotently so every terminal path is covered.
		s.resolveSLAClock(ctx, tenantID, userID, id, closedAt)
	}
	return s.Get(ctx, tenantID, id)
}

func (s *InvestigationService) Delete(ctx context.Context, tenantID, userID, id uuid.UUID) error {
	inv, err := s.load(ctx, tenantID, id)
	if err != nil {
		return err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start investigation delete transaction", err)
	}
	defer tx.Rollback(ctx)
	if _, err := s.lockMutable(ctx, tx, tenantID, id); err != nil {
		return err
	}
	if err := s.investigations.SoftDelete(ctx, tx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("investigation not found")
		}
		return internalError("delete investigation", err)
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, id, userID, "investigation.deleted", nil, nil,
		map[string]any{"investigation_number": inv.InvestigationNumber}, investigationAuditSnapshot(inv), nil, ""); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit investigation delete", err)
	}
	s.resolveSLAClock(ctx, tenantID, userID, id, s.now().UTC())
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.investigation.deleted", tenantID, &userID, map[string]any{
		"id": id,
	}, s.logger)
	return nil
}

// --- CAP-078: parties --------------------------------------------------------

func (s *InvestigationService) AddParty(ctx context.Context, tenantID, userID, investigationID uuid.UUID, req dto.AddInvestigationPartyRequest) (*model.InvestigationParty, error) {
	req.Normalize()
	if req.Name == "" {
		return nil, validationError("name is required", map[string]string{"name": "required"})
	}
	if !req.Role.Valid() {
		return nil, validationError("invalid party role", map[string]string{"role": "invalid"})
	}
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return nil, err
	}
	party := &model.InvestigationParty{
		ID:              uuid.New(),
		TenantID:        tenantID,
		InvestigationID: investigationID,
		Role:            req.Role,
		Name:            req.Name,
		Identifier:      req.Identifier,
		Contact:         req.Contact,
		Metadata:        req.Metadata,
		CreatedBy:       userID,
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start investigation party transaction", err)
	}
	defer tx.Rollback(ctx)
	locked, err := s.lockMutable(ctx, tx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if err := s.investigations.CreateParty(ctx, tx, party); err != nil {
		return nil, internalError("create investigation party", err)
	}
	if err := s.moveToInProgress(ctx, tx, tenantID, userID, locked); err != nil {
		return nil, err
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, investigationID, userID, "investigation.party_added", nil, nil, map[string]any{"party_id": party.ID.String(), "role": string(party.Role)}, nil, map[string]any{"party_id": party.ID.String(), "role": string(party.Role), "name": party.Name}, ""); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit investigation party", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.investigation.party_added", tenantID, &userID, map[string]any{
		"id":         investigationID,
		"party_id":   party.ID,
		"party_role": party.Role,
	}, s.logger)
	return s.investigations.GetParty(ctx, tenantID, investigationID, party.ID)
}

func (s *InvestigationService) UpdateParty(ctx context.Context, tenantID, userID, investigationID, partyID uuid.UUID, req dto.UpdateInvestigationPartyRequest) (*model.InvestigationParty, error) {
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return nil, err
	}
	party, err := s.investigations.GetParty(ctx, tenantID, investigationID, partyID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("investigation party not found")
		}
		return nil, internalError("load investigation party", err)
	}
	applyInvestigationPartyUpdate(party, req)
	if party.Name == "" {
		return nil, validationError("name is required", map[string]string{"name": "required"})
	}
	if !party.Role.Valid() {
		return nil, validationError("invalid party role", map[string]string{"role": "invalid"})
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start investigation party update transaction", err)
	}
	defer tx.Rollback(ctx)
	if _, err := s.lockMutable(ctx, tx, tenantID, investigationID); err != nil {
		return nil, err
	}
	if err := s.investigations.UpdateParty(ctx, tx, party); err != nil {
		return nil, internalError("update investigation party", err)
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, investigationID, userID, "investigation.party_updated", nil, nil,
		map[string]any{"party_id": partyID.String(), "role": string(party.Role)}, nil,
		map[string]any{"party_id": partyID.String(), "role": string(party.Role)}, ""); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit investigation party update", err)
	}
	return s.investigations.GetParty(ctx, tenantID, investigationID, partyID)
}

func (s *InvestigationService) DeleteParty(ctx context.Context, tenantID, userID, investigationID, partyID uuid.UUID) error {
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start investigation party delete transaction", err)
	}
	defer tx.Rollback(ctx)
	if _, err := s.lockMutable(ctx, tx, tenantID, investigationID); err != nil {
		return err
	}
	if err := s.investigations.SoftDeleteParty(ctx, tx, tenantID, investigationID, partyID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("investigation party not found")
		}
		return internalError("delete investigation party", err)
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, investigationID, userID, "investigation.party_deleted", nil, nil,
		map[string]any{"party_id": partyID.String()}, map[string]any{"party_id": partyID.String()}, nil, ""); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit investigation party delete", err)
	}
	return nil
}

// --- CAP-079: statements / testimonies --------------------------------------

func (s *InvestigationService) RecordStatement(ctx context.Context, tenantID, userID, investigationID uuid.UUID, req dto.RecordInvestigationStatementRequest) (*model.InvestigationStatement, error) {
	req.Normalize()
	if req.DeponentName == "" {
		return nil, validationError("deponent_name is required", map[string]string{"deponent_name": "required"})
	}
	if req.Statement == "" {
		return nil, validationError("statement is required", map[string]string{"statement": "required"})
	}
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return nil, err
	}
	takenAt := s.now().UTC()
	if req.TakenAt != nil {
		takenAt = req.TakenAt.UTC()
	}
	statement := &model.InvestigationStatement{
		ID:              uuid.New(),
		TenantID:        tenantID,
		InvestigationID: investigationID,
		DeponentPartyID: req.DeponentPartyID,
		DeponentName:    req.DeponentName,
		Statement:       req.Statement,
		TakenAt:         takenAt,
		TakenBy:         req.TakenBy,
		Metadata:        req.Metadata,
		CreatedBy:       userID,
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start investigation statement transaction", err)
	}
	defer tx.Rollback(ctx)
	locked, err := s.lockMutable(ctx, tx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if err := s.investigations.CreateStatement(ctx, tx, statement); err != nil {
		return nil, internalError("create investigation statement", err)
	}
	if err := s.moveToInProgress(ctx, tx, tenantID, userID, locked); err != nil {
		return nil, err
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, investigationID, userID, "investigation.statement_recorded", nil, nil, map[string]any{"statement_id": statement.ID.String(), "deponent": statement.DeponentName}, nil, map[string]any{"statement_id": statement.ID.String(), "deponent": statement.DeponentName, "taken_at": statement.TakenAt.UTC().Format(time.RFC3339)}, ""); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit investigation statement", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.investigation.statement_recorded", tenantID, &userID, map[string]any{
		"id":           investigationID,
		"statement_id": statement.ID,
	}, s.logger)
	return s.investigations.GetStatement(ctx, tenantID, investigationID, statement.ID)
}

func (s *InvestigationService) DeleteStatement(ctx context.Context, tenantID, userID, investigationID, statementID uuid.UUID) error {
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start investigation statement delete transaction", err)
	}
	defer tx.Rollback(ctx)
	if _, err := s.lockMutable(ctx, tx, tenantID, investigationID); err != nil {
		return err
	}
	if err := s.investigations.SoftDeleteStatement(ctx, tx, tenantID, investigationID, statementID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("investigation statement not found")
		}
		return internalError("delete investigation statement", err)
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, investigationID, userID, "investigation.statement_deleted", nil, nil,
		map[string]any{"statement_id": statementID.String()}, map[string]any{"statement_id": statementID.String()}, nil, ""); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit investigation statement delete", err)
	}
	return nil
}

// --- CAP-080: evidence upload ------------------------------------------------

func (s *InvestigationService) UploadEvidence(ctx context.Context, tenantID, userID, investigationID uuid.UUID, req dto.UploadInvestigationEvidenceRequest) (*model.InvestigationEvidence, error) {
	req.Normalize()
	if req.Title == "" {
		return nil, validationError("title is required", map[string]string{"title": "required"})
	}
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return nil, err
	}
	if err := s.validateEvidenceFile(ctx, tenantID, investigationID, req.FileID); err != nil {
		return nil, err
	}
	var collectedAt *time.Time
	if req.CollectedAt != nil {
		value := req.CollectedAt.UTC()
		collectedAt = &value
	}
	evidence := &model.InvestigationEvidence{
		ID:              uuid.New(),
		TenantID:        tenantID,
		InvestigationID: investigationID,
		FileID:          req.FileID,
		Title:           req.Title,
		Description:     req.Description,
		EvidenceType:    req.EvidenceType,
		CollectedBy:     req.CollectedBy,
		CollectedAt:     collectedAt,
		Metadata:        req.Metadata,
		CreatedBy:       userID,
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start investigation evidence transaction", err)
	}
	defer tx.Rollback(ctx)
	locked, err := s.lockMutable(ctx, tx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if err := s.investigations.CreateEvidence(ctx, tx, evidence); err != nil {
		return nil, internalError("create investigation evidence", err)
	}
	if err := s.moveToInProgress(ctx, tx, tenantID, userID, locked); err != nil {
		return nil, err
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, investigationID, userID, "investigation.evidence_uploaded", nil, nil, map[string]any{"evidence_id": evidence.ID.String(), "file_id": uuidPtrDetail(evidence.FileID)}, nil, map[string]any{"evidence_id": evidence.ID.String(), "file_id": uuidPtrDetail(evidence.FileID), "title": evidence.Title}, ""); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit investigation evidence", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.investigation.evidence_uploaded", tenantID, &userID, map[string]any{
		"id":          investigationID,
		"evidence_id": evidence.ID,
		"file_id":     uuidPtrDetail(evidence.FileID),
	}, s.logger)
	return evidence, nil
}

func (s *InvestigationService) DeleteEvidence(ctx context.Context, tenantID, userID, investigationID, evidenceID uuid.UUID) error {
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start investigation evidence delete transaction", err)
	}
	defer tx.Rollback(ctx)
	if _, err := s.lockMutable(ctx, tx, tenantID, investigationID); err != nil {
		return err
	}
	if err := s.investigations.SoftDeleteEvidence(ctx, tx, tenantID, investigationID, evidenceID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("investigation evidence not found")
		}
		return internalError("delete investigation evidence", err)
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, investigationID, userID, "investigation.evidence_deleted", nil, nil,
		map[string]any{"evidence_id": evidenceID.String()}, map[string]any{"evidence_id": evidenceID.String()}, nil, ""); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit investigation evidence delete", err)
	}
	return nil
}

// --- CAP-081: results / findings (optionally AI-drafted) ---------------------

func (s *InvestigationService) RecordResults(ctx context.Context, tenantID, userID, investigationID uuid.UUID, req dto.RecordInvestigationResultsRequest) (*model.LegalInvestigation, error) {
	req.Normalize()
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return nil, err
	}
	if !investigationResultsRecordable(inv.Status) {
		return nil, conflictError(fmt.Sprintf("findings can only be recorded while an investigation is in_progress (current: %s)", inv.Status))
	}
	findings := req.Findings
	aiDrafted := false
	if req.GenerateAI {
		generated, gerr := s.draftBody(ctx, tenantID,
			"You are a legal investigations assistant. Draft a thorough, neutral statement of findings for an internal legal investigation. Arabic input and output are supported.",
			req.FindingsPrompt)
		if gerr != nil {
			return nil, gerr
		}
		findings = generated
		aiDrafted = true
	}
	if findings == "" {
		return nil, validationError("findings is required (or set generate_ai with a prompt)", map[string]string{"findings": "required"})
	}
	from := string(inv.Status)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start investigation results transaction", err)
	}
	defer tx.Rollback(ctx)
	locked, err := s.lockMutable(ctx, tx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if !investigationResultsRecordable(locked.Status) {
		return nil, conflictError(fmt.Sprintf("findings can only be recorded while an investigation is in_progress (current: %s)", locked.Status))
	}
	from = string(locked.Status)
	if err := s.investigations.UpdateFindings(ctx, tx, tenantID, investigationID, findings, aiDrafted, model.InvestigationStatusResults); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("investigation not found")
		}
		return nil, internalError("record investigation findings", err)
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, investigationID, userID, "investigation.results_recorded", &from, ptrString(string(model.InvestigationStatusResults)), map[string]any{"ai_drafted": aiDrafted}, ptrString(from), ptrString(string(model.InvestigationStatusResults)), ""); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit investigation results", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.investigation.results_recorded", tenantID, &userID, map[string]any{
		"id":         investigationID,
		"ai_drafted": aiDrafted,
		"status":     model.InvestigationStatusResults,
	}, s.logger)
	s.emitLedger(ctx, tenantID, &userID, "investigation.results_recorded", investigationID, "notice", map[string]any{"status": from}, map[string]any{"status": string(model.InvestigationStatusResults), "ai_drafted": aiDrafted}, nil)
	return s.Get(ctx, tenantID, investigationID)
}

// --- CAP-082: final recommendations -----------------------------------------

func (s *InvestigationService) RecordRecommendations(ctx context.Context, tenantID, userID, investigationID uuid.UUID, req dto.RecordInvestigationRecommendationsRequest) (*model.LegalInvestigation, error) {
	req.Normalize()
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return nil, err
	}
	if !investigationRecommendationsRecordable(inv.Status) {
		return nil, conflictError(fmt.Sprintf("recommendations can only be recorded after findings (current: %s)", inv.Status))
	}
	recommendations := req.Recommendations
	aiDrafted := false
	if req.GenerateAI {
		generated, gerr := s.draftBody(ctx, tenantID,
			"You are a legal investigations assistant. Draft clear, actionable final recommendations for an internal legal investigation. Arabic input and output are supported.",
			req.RecommendationsPrompt)
		if gerr != nil {
			return nil, gerr
		}
		recommendations = generated
		aiDrafted = true
	}
	if recommendations == "" {
		return nil, validationError("recommendations is required (or set generate_ai with a prompt)", map[string]string{"recommendations": "required"})
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start investigation recommendations transaction", err)
	}
	defer tx.Rollback(ctx)
	locked, err := s.lockMutable(ctx, tx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if !investigationRecommendationsRecordable(locked.Status) {
		return nil, conflictError(fmt.Sprintf("recommendations can only be recorded after findings (current: %s)", locked.Status))
	}
	if err := s.investigations.UpdateRecommendations(ctx, tx, tenantID, investigationID, recommendations, aiDrafted); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("investigation not found")
		}
		return nil, internalError("record investigation recommendations", err)
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, investigationID, userID, "investigation.recommendations_recorded", nil, nil,
		map[string]any{"ai_drafted": aiDrafted}, map[string]any{"status": string(inv.Status), "recommendations_recorded": strings.TrimSpace(inv.Recommendations) != ""},
		map[string]any{"status": string(inv.Status), "recommendations_recorded": true, "ai_drafted": aiDrafted}, ""); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit investigation recommendations", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.investigation.recommendations_recorded", tenantID, &userID, map[string]any{
		"id":         investigationID,
		"ai_drafted": aiDrafted,
	}, s.logger)
	return s.Get(ctx, tenantID, investigationID)
}

// --- CAP-083: approve results (via shared ApprovalOrchestrator) --------------

// StartApproval opens the results-approval chain (CAP-083) over the SHARED
// subject-agnostic ApprovalOrchestrator. It requires findings + recommendations to
// be recorded, creates a workflow instance + approval-chain step + approver task,
// links the instance onto the investigation, and moves it
// results_recorded → pending_approval. Decisions flow through DecideApproval.
func (s *InvestigationService) StartApproval(ctx context.Context, tenantID, userID, investigationID uuid.UUID, req dto.StartInvestigationApprovalRequest) (*model.LegalInvestigation, error) {
	if s.instRepo == nil || s.taskRepo == nil || s.orchestrator == nil {
		return nil, internalError("investigation approval workflow repositories are not configured", fmt.Errorf("missing workflow dependencies"))
	}
	req.Normalize()
	// Constrain the approver role to the 14-role Watheeq roster so a free-text typo
	// can't persist an off-roster assignee_role on the approval task — which no user
	// could hold and which would leave the results-approval chain permanently
	// un-decidable (F48). Normalize() has already canonicalised the slug form.
	if !isLegalAffairsRoleSlug(req.ApproverRole) {
		return nil, validationError("approver_role must be a known legal-affairs role", map[string]string{"approver_role": "invalid"})
	}
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if !investigationApprovalSubmittable(inv.Status) {
		return nil, conflictError("only an investigation with recorded results can enter results approval")
	}
	if inv.WorkflowInstanceID != nil {
		return nil, conflictError("investigation already has an active approval workflow")
	}
	if strings.TrimSpace(inv.Findings) == "" {
		return nil, conflictError("findings must be recorded before requesting results approval")
	}
	if strings.TrimSpace(inv.Recommendations) == "" {
		return nil, conflictError("recommendations must be recorded before requesting results approval")
	}

	definition, err := s.ensureDefinition(ctx, tenantID, userID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	instance := &workflowmodel.WorkflowInstance{
		TenantID:      tenantID.String(),
		DefinitionID:  definition.ID,
		DefinitionVer: definition.Version,
		Status:        workflowmodel.InstanceStatusRunning,
		CurrentStepID: ptrString(investigationApprovalStepID),
		Variables: map[string]any{
			"investigation_id":     inv.ID.String(),
			"investigation_number": inv.InvestigationNumber,
		},
		StepOutputs: map[string]any{},
		StartedBy:   ptrString(userID.String()),
	}
	if err := s.instRepo.Create(ctx, instance); err != nil {
		return nil, internalError("create investigation approval workflow instance", err)
	}
	stepExec := &workflowmodel.StepExecution{
		InstanceID: instance.ID,
		StepID:     investigationApprovalStepID,
		StepType:   workflowexec.StepTypeApprovalChain,
		Status:     workflowmodel.StepStatusPending,
		Attempt:    1,
		CreatedAt:  now,
	}
	if err := s.instRepo.CreateStepExecution(ctx, stepExec); err != nil {
		return nil, internalError("create investigation approval step execution", err)
	}
	task := s.buildApprovalTask(tenantID, inv, instance, stepExec, req.ApproverRole, now)
	// The investigation SLA is held by the shared legal_sla_clocks substrate, not
	// on the aggregate row. Copy its immutable turnaround deadline onto the human
	// approval task so the shared orchestrator enforces a late justification on
	// the terminal results decision (and propagates it to sequential approvers).
	var slaDeadline time.Time
	if err := s.db.QueryRow(ctx, `
		SELECT turnaround_due_at
		FROM legal_sla_clocks
		WHERE tenant_id = $1 AND legal_request_id = $2 AND outcome = 'pending'
		ORDER BY cycle DESC
		LIMIT 1`, tenantID, investigationID).Scan(&slaDeadline); err == nil {
		task.SLADeadline = &slaDeadline
	} else if err != pgx.ErrNoRows {
		return nil, internalError("load investigation SLA deadline", err)
	}
	workflowID := uuid.MustParse(instance.ID)

	from := string(inv.Status)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start investigation approval transaction", err)
	}
	defer tx.Rollback(ctx)
	locked, err := s.lockMutable(ctx, tx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if !investigationApprovalSubmittable(locked.Status) || locked.WorkflowInstanceID != nil ||
		strings.TrimSpace(locked.Findings) == "" || strings.TrimSpace(locked.Recommendations) == "" {
		return nil, conflictError("investigation is no longer ready to enter results approval")
	}
	from = string(locked.Status)
	if err := insertWorkflowTask(ctx, tx, task); err != nil {
		return nil, internalError("create investigation approval task", err)
	}
	if err := s.investigations.UpdateStatusTx(ctx, tx, tenantID, investigationID, model.InvestigationStatusPendingApprove, &workflowID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("investigation not found")
		}
		return nil, internalError("move investigation into approval", err)
	}
	if err := s.appendAuditFull(ctx, tx, tenantID, investigationID, userID, "investigation.approval_started", &from, ptrString(string(model.InvestigationStatusPendingApprove)), map[string]any{"workflow_instance_id": workflowID.String(), "approver_role": req.ApproverRole}, map[string]any{"status": from}, map[string]any{"status": string(model.InvestigationStatusPendingApprove), "workflow_instance_id": workflowID.String()}, ""); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit investigation approval start", err)
	}
	if s.metrics != nil {
		s.metrics.WorkflowActive.Inc()
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.investigation.approval_started", tenantID, &userID, map[string]any{
		"id":                   investigationID,
		"workflow_instance_id": workflowID,
		"status":               model.InvestigationStatusPendingApprove,
	}, s.logger)
	s.emitLedger(ctx, tenantID, &userID, "investigation.approval_started", investigationID, "notice", map[string]any{"status": from}, map[string]any{"status": string(model.InvestigationStatusPendingApprove), "workflow_instance_id": workflowID.String(), "approver_role": req.ApproverRole}, nil)
	return s.Get(ctx, tenantID, investigationID)
}

// DecideApproval records one approver decision on the results-approval chain
// through the shared engine. On approve the investigation advances
// pending_approval → approved; on reject it enters the explicit rejected state
// and must be reopened to in_progress before rework.
func (s *InvestigationService) DecideApproval(ctx context.Context, tenantID, userID, investigationID, workflowInstanceID, taskID uuid.UUID, req dto.WorkflowDecisionRequest) (*ApprovalDecisionOutcome, error) {
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if inv.WorkflowInstanceID == nil || *inv.WorkflowInstanceID != workflowInstanceID {
		return nil, conflictError("workflow instance does not belong to this investigation")
	}
	outcome, err := s.orchestrator.DecideTask(ctx, tenantID, userID, investigationID, workflowInstanceID, taskID, s.advanceInvestigationStatus, req)
	if err != nil {
		return nil, err
	}
	// Post-commit, best-effort side effects (the in-tx audit row was written by the
	// advance hook). Only when the chain reached a terminal verdict and the subject
	// FSM actually moved this decision (Status differs from PreviousStatus) — so a
	// non-final quorum decision and an idempotent double-approve are both no-ops here.
	if outcome != nil && outcome.Status != outcome.PreviousStatus {
		switch model.InvestigationStatus(outcome.Status) {
		case model.InvestigationStatusApproved:
			// Resolve the SLA clock (on_time/breached) and refresh the duration fact
			// with the real register→approved window; Emit() the terminal ledger record.
			if approved, gerr := s.Get(ctx, tenantID, investigationID); gerr == nil {
				now := s.now().UTC()
				s.resolveSLAClock(ctx, tenantID, userID, investigationID, now)
				s.writeDurationFact(ctx, tenantID, approved, userID, now, &now)
				s.emitLedger(ctx, tenantID, &userID, "investigation.approved", investigationID, "notice",
					map[string]any{"status": outcome.PreviousStatus},
					map[string]any{"status": outcome.Status, "resolution": string(outcome.Resolution), "decision": req.Decision}, nil)
			}
		case model.InvestigationStatusRejected:
			s.emitLedger(ctx, tenantID, &userID, "investigation.rejected", investigationID, "warning",
				map[string]any{"status": outcome.PreviousStatus},
				map[string]any{"status": outcome.Status, "resolution": string(outcome.Resolution), "decision": req.Decision}, nil)
		}
	}
	return outcome, nil
}

// ListApprovalTasks returns the open approver tasks for the investigation's
// current results-approval workflow.
func (s *InvestigationService) ListApprovalTasks(ctx context.Context, tenantID, investigationID uuid.UUID) ([]*workflowmodel.HumanTask, error) {
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if inv.WorkflowInstanceID == nil {
		return []*workflowmodel.HumanTask{}, nil
	}
	tasks, err := s.taskRepo.ListByInstanceStep(ctx, tenantID.String(), inv.WorkflowInstanceID.String(), investigationApprovalStepID)
	if err != nil {
		return nil, internalError("list investigation approval tasks", err)
	}
	return tasks, nil
}

// advanceInvestigationStatus is the FSM hook the shared engine calls when the
// results-approval chain resolves. It runs INSIDE the engine's transaction: it
// moves the investigation pending_approval → approved (approve) or → rejected
// (reject) and clears the workflow link. On reject the service later allows a
// restart of the chain after rework.
func (s *InvestigationService) advanceInvestigationStatus(ctx context.Context, tx pgx.Tx, tenantID, userID, investigationID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error) {
	// Concurrency: re-read the investigation UNDER the row lock (FOR UPDATE) inside
	// the engine's tx so two concurrent quorum-completing decisions serialise on the
	// row instead of racing on a stale application read. A second decision that
	// arrives after the investigation already left pending_approval (already
	// approved/rejected) is a no-op double-approve: the plan reports changed=false and
	// the terminal status is returned without a second mutation/audit row.
	inv, err := s.investigations.LockForUpdate(ctx, tx, tenantID, investigationID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", notFoundError("investigation not found")
		}
		return "", internalError("lock investigation for advance", err)
	}
	if inv.Status.IsTerminal() && resolution == workflowexec.ResolutionAdvance {
		// Idempotent guard: an already-approved investigation rejects a re-approval.
		return string(inv.Status), nil
	}
	plan := investigationApprovalAdvancePlanFor(inv.Status, resolution)
	if !plan.changed {
		return string(inv.Status), nil
	}
	if err := s.investigations.ClearWorkflowStatusTx(ctx, tx, tenantID, investigationID, plan.target); err != nil {
		return "", internalError("advance investigation status", err)
	}
	from := string(inv.Status)
	to := string(plan.target)
	if err := s.appendAuditFull(ctx, tx, tenantID, investigationID, userID, "investigation.approval_resolved", &from, &to, map[string]any{"resolution": string(resolution), "decision": decision}, map[string]any{"status": from}, map[string]any{"status": to, "resolution": string(resolution)}, decision); err != nil {
		return "", err
	}
	return to, nil
}

// --- governance audit listing ------------------------------------------------

func (s *InvestigationService) ListAudit(ctx context.Context, tenantID, investigationID uuid.UUID) ([]model.InvestigationAuditEntry, error) {
	if _, err := s.load(ctx, tenantID, investigationID); err != nil {
		return nil, err
	}
	entries, err := s.investigations.ListAudit(ctx, tenantID, investigationID)
	if err != nil {
		return nil, internalError("list investigation audit", err)
	}
	return entries, nil
}

// --- reminders: linked legal_obligation (no new timer) -----------------------

// ScheduleDeadlineReminder creates a linked legal_obligation for an
// objection/hearing deadline so the EXISTING obligation reminder outbox + monitor
// fires the reminder — no new timer is introduced. The obligation id is linked back
// onto the investigation row. Reuses ObligationService.Create (which itself emits
// events + writes the obligation reminder schedule).
func (s *InvestigationService) ScheduleDeadlineReminder(ctx context.Context, tenantID, userID, investigationID uuid.UUID, deadline time.Time, leadDays []int, title string) (*model.Obligation, error) {
	if s.obligations == nil {
		return nil, internalError("obligation service is not configured", fmt.Errorf("missing obligation dependency"))
	}
	inv, err := s.load(ctx, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return nil, err
	}
	if deadline.IsZero() {
		return nil, validationError("deadline is required", map[string]string{"deadline": "required"})
	}
	for _, lead := range leadDays {
		if lead < 0 {
			return nil, validationError("lead_days cannot contain negative values", map[string]string{"lead_days": "invalid"})
		}
	}
	if title == "" {
		title = fmt.Sprintf("الموعد النهائي للتحقيق %s", inv.InvestigationNumber)
	}
	obligation, err := s.obligations.Create(ctx, tenantID, userID, dto.CreateObligationRequest{
		Title:            title,
		Description:      fmt.Sprintf("تذكير بالموعد النهائي للاعتراض/الجلسة الخاص بالتحقيق %s.", inv.InvestigationNumber),
		Type:             model.ObligationTypeNotice,
		Status:           model.ObligationStatusOpen,
		Priority:         inv.Priority,
		OwnerUserID:      userID,
		OwnerName:        inv.LeadInvestigator,
		DueDate:          deadline,
		ReminderEnabled:  true,
		ReminderLeadDays: leadDays,
		Metadata: map[string]any{
			"source":           "lex_investigation",
			"investigation_id": investigationID.String(),
		},
	})
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start investigation reminder transaction", err)
	}
	defer tx.Rollback(ctx)
	if _, err := s.lockMutable(ctx, tx, tenantID, investigationID); err != nil {
		return nil, err
	}
	if err := s.investigations.SetReminderObligation(ctx, tx, tenantID, investigationID, obligation.ID); err != nil {
		return nil, internalError("link investigation reminder obligation", err)
	}
	if err := s.appendAudit(ctx, tx, tenantID, investigationID, userID, "investigation.reminder_scheduled", nil, nil, map[string]any{"obligation_id": obligation.ID.String(), "due_date": deadline.UTC().Format(time.RFC3339)}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit investigation reminder", err)
	}
	return obligation, nil
}

// --- internals ---------------------------------------------------------------

func (s *InvestigationService) load(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalInvestigation, error) {
	inv, err := s.investigations.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("investigation not found")
		}
		return nil, internalError("load investigation", err)
	}
	return inv, nil
}

// lockMutable repeats the content-mutability guard under the aggregate row lock.
// The early preflight checks keep failures fast; this in-transaction check closes
// the race where approval starts between the preflight and the content write.
func (s *InvestigationService) lockMutable(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (*model.LegalInvestigation, error) {
	inv, err := s.investigations.LockForUpdate(ctx, tx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("investigation not found")
		}
		return nil, internalError("lock investigation for mutation", err)
	}
	if err := s.ensureMutable(ctx, tenantID, inv); err != nil {
		return nil, err
	}
	return inv, nil
}

// ensureMutable refuses content mutation while approval is pending or when the
// investigation is terminal. A rejected investigation must first take the
// explicit rejected -> in_progress rework edge before its content can change.
func (s *InvestigationService) ensureMutable(ctx context.Context, tenantID uuid.UUID, inv *model.LegalInvestigation) error {
	if inv.Status.IsTerminal() {
		return conflictError("investigation is in a terminal state and cannot be modified")
	}
	if inv.Status == model.InvestigationStatusPendingApprove {
		return conflictError("investigation content is locked while results approval is pending")
	}
	if inv.Status == model.InvestigationStatusRejected {
		return conflictError("reopen the rejected investigation for rework before modifying its content")
	}
	return s.ensureCaseNotHeld(ctx, tenantID, inv)
}

// ensureCaseNotHeld is the preservation half of ensureMutable: when a case is linked
// and under an active legal hold it blocks the operation (FR-WATHEEQ-005). It is
// factored out so generic FSM status transitions — including the terminal
// approved -> closed close-out — can enforce preservation WITHOUT ensureMutable's
// content-mutability terminal guard (which would otherwise reject that close-out).
func (s *InvestigationService) ensureCaseNotHeld(ctx context.Context, tenantID uuid.UUID, inv *model.LegalInvestigation) error {
	if inv.CaseID != nil {
		// A linked case under preservation propagates the hold to the investigation
		// (FR-WATHEEQ-005). Cases are not a hold subject in Phase 0/1/2, so this is a
		// forward-compatible no-op when the guard reports the id as mutable.
		if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectMatter, *inv.CaseID); err != nil {
			return err
		}
	}
	return nil
}

// moveToInProgress advances a freshly-registered investigation into in_progress
// once gathering begins (party/statement/evidence added), inside the caller's tx.
func (s *InvestigationService) moveToInProgress(ctx context.Context, tx pgx.Tx, tenantID, userID uuid.UUID, inv *model.LegalInvestigation) error {
	if inv.Status != model.InvestigationStatusRegistered {
		return nil
	}
	if err := s.investigations.UpdateStatusTx(ctx, tx, tenantID, inv.ID, model.InvestigationStatusInProgress, nil); err != nil {
		return internalError("advance investigation to in_progress", err)
	}
	from := string(model.InvestigationStatusRegistered)
	to := string(model.InvestigationStatusInProgress)
	if err := s.appendAuditFull(ctx, tx, tenantID, inv.ID, userID, "investigation.status_changed", &from, &to,
		map[string]any{"trigger": "content_gathering_started"}, map[string]any{"status": from}, map[string]any{"status": to}, ""); err != nil {
		return err
	}
	inv.Status = model.InvestigationStatusInProgress
	return nil
}

func (s *InvestigationService) validateEvidenceFile(ctx context.Context, tenantID, investigationID uuid.UUID, fileID *uuid.UUID) error {
	if fileID == nil {
		return nil
	}
	if s.evidenceFiles == nil || !s.evidenceFiles.Ready() {
		return requestFileUnavailable("investigation evidence file service is not configured", fmt.Errorf("missing ready file metadata client"))
	}
	metadata, err := s.evidenceFiles.Metadata(ctx, tenantID.String(), fileID.String())
	if err != nil {
		return err
	}
	if metadata == nil || metadata.ID != fileID.String() || metadata.TenantID != tenantID.String() {
		return conflictError("evidence file does not belong to this tenant")
	}
	if metadata.EntityType == nil || strings.TrimSpace(*metadata.EntityType) != "legal_investigation" ||
		metadata.EntityID == nil || strings.TrimSpace(*metadata.EntityID) != investigationID.String() {
		return conflictError("evidence file is not bound to this investigation")
	}
	return nil
}

func (s *InvestigationService) appendAudit(ctx context.Context, tx pgx.Tx, tenantID, investigationID, userID uuid.UUID, action string, from, to *string, detail map[string]any) error {
	entry := &model.InvestigationAuditEntry{
		ID:              uuid.New(),
		TenantID:        tenantID,
		InvestigationID: investigationID,
		Action:          action,
		FromStatus:      from,
		ToStatus:        to,
		Detail:          detail,
		ActorUserID:     userID,
	}
	if err := s.investigations.AppendAudit(ctx, tx, entry); err != nil {
		return internalError("append investigation audit", err)
	}
	return nil
}

// appendAuditFull writes one append-only governance audit row INSIDE the caller's
// mutation tx carrying explicit before/after JSONB snapshots + a free-text reason
// (Round-2 WS4) in addition to from/to/detail. Callers pass status-shaped snapshots
// (no PII bodies) so the queryable ledger never stores plaintext sensitive data.
func (s *InvestigationService) appendAuditFull(ctx context.Context, tx pgx.Tx, tenantID, investigationID, userID uuid.UUID, action string, from, to *string, detail map[string]any, before, after any, reason string) error {
	entry := &model.InvestigationAuditEntry{
		ID:              uuid.New(),
		TenantID:        tenantID,
		InvestigationID: investigationID,
		Action:          action,
		FromStatus:      from,
		ToStatus:        to,
		Detail:          detail,
		ActorUserID:     userID,
	}
	if err := s.investigations.AppendAuditFull(ctx, tx, entry, before, after, reason); err != nil {
		return internalError("append investigation audit", err)
	}
	return nil
}

// --- Round-2 WS3: SLA clock bridge ------------------------------------------

// startSLAClock materialises the working-day ack/response SLA clock for a freshly
// registered investigation through the SHARED engine. It is best-effort and
// post-commit: a missing target / calendar / FK logs and continues — the
// investigation row remains authoritative. The owning org entity flows through
// BeneficiaryEntityID (read from metadata when present); the lead investigator is
// stamped so the SLA monitor can address ack/breach notifications.
func (s *InvestigationService) startSLAClock(ctx context.Context, tenantID, userID uuid.UUID, inv *model.LegalInvestigation) {
	if s.sla == nil || inv == nil {
		return
	}
	started := s.now().UTC()
	metadata := map[string]any{
		"subject_type":      "legal_investigation",
		"lead_investigator": inv.LeadInvestigator,
	}
	if inv.Department != nil {
		metadata["department"] = *inv.Department
	}
	req := dto.StartSLAClockRequest{
		LegalRequestID:      inv.ID, // investigation id as the generic SLA subject key
		ServiceCode:         investigationSLAServiceCode,
		Priority:            investigationSLAPriority(inv.Priority),
		BeneficiaryEntityID: investigationBeneficiaryEntityID(inv),
		StartedAt:           &started,
		Metadata:            metadata,
	}
	if _, err := s.sla.StartClock(ctx, tenantID, userID, req); err != nil {
		s.logger.Warn().Err(err).Str("investigation_id", inv.ID.String()).Msg("investigation sla clock auto-start skipped")
	}
}

// resolveSLAClock closes the investigation's SLA clock with its terminal
// on_time/breached verdict on results-approval. Best-effort + idempotent (the
// underlying Resolve guards on resolved_at IS NULL).
func (s *InvestigationService) resolveSLAClock(ctx context.Context, tenantID, userID, investigationID uuid.UUID, resolvedAt time.Time) {
	if s.sla == nil {
		return
	}
	if _, err := s.sla.ResolveClockForRequest(ctx, tenantID, userID, investigationID, resolvedAt); err != nil {
		s.logger.Warn().Err(err).Str("investigation_id", investigationID.String()).Msg("investigation sla clock resolve skipped")
	}
}

// --- Round-2 WS4: immutable ledger emission ---------------------------------

// emitLedger routes a material investigation transition to the audit_db immutable
// hash-chained ledger via the LexAuditEmitter. Best-effort: a nil emitter or a
// publish error is a no-op (the in-tx legal_investigation_audit_log row is the
// durable record). No PII bodies are emitted — old/new carry status-shaped maps.
func (s *InvestigationService) emitLedger(ctx context.Context, tenantID uuid.UUID, actor *uuid.UUID, action string, investigationID uuid.UUID, severity string, oldValue, newValue, detail map[string]any) {
	if s.auditEmitter == nil {
		return
	}
	s.auditEmitter.Emit(ctx, LexAuditRecord{
		TenantID:     tenantID,
		ActorUserID:  actor,
		Action:       action,
		ResourceType: "legal_investigation",
		ResourceID:   investigationID.String(),
		Severity:     severity,
		OldValue:     oldValue,
		NewValue:     newValue,
		Detail:       detail,
	})
}

// --- Round-2 C-2: processing-duration fact ----------------------------------

// writeDurationFact upserts the investigation_resolution processing-duration fact.
// On register it writes a zero-length open window (started == ended == created_at);
// on results-approval it refreshes the row with the real register→approved window so
// turnaround reports read pre-computed working-minutes. Best-effort + idempotent
// (the repo upsert is keyed by tenant/kind/subject with an occurred_at guard).
func (s *InvestigationService) writeDurationFact(ctx context.Context, tenantID uuid.UUID, inv *model.LegalInvestigation, _ uuid.UUID, occurredAt time.Time, endedAt *time.Time) {
	if s.facts == nil || inv == nil {
		return
	}
	started := inv.CreatedAt.UTC()
	if started.IsZero() {
		started = occurredAt.UTC()
	}
	ended := started
	if endedAt != nil {
		ended = endedAt.UTC()
	}
	if ended.Before(started) {
		ended = started
	}
	wallMinutes := int(ended.Sub(started) / time.Minute)
	if wallMinutes < 0 {
		wallMinutes = 0
	}
	workingMinutes := wallMinutes
	if s.factCalendar != nil {
		if calc, err := s.factCalendar.CalculatorFor(ctx, tenantID); err == nil && calc != nil {
			workingMinutes = calc.WorkingMinutesBetween(started, ended)
		}
	}
	occ := occurredAt.UTC()
	if occ.IsZero() {
		occ = ended
	}
	fact := &model.DurationFact{
		ID:              uuid.New(),
		TenantID:        tenantID,
		Kind:            durationFactInvestigationResolution,
		SubjectID:       inv.ID,
		Department:      inv.Department,
		StartedAt:       started,
		EndedAt:         ended,
		DurationMinutes: wallMinutes,
		WorkingMinutes:  workingMinutes,
		OccurredAt:      occ,
	}
	if err := s.facts.Upsert(ctx, fact); err != nil {
		s.logger.Warn().Err(err).Str("investigation_id", inv.ID.String()).Msg("investigation duration fact upsert skipped")
	}
}

// investigationSLAPriority maps the investigation's LegalPriority onto the SLA
// target priority tier (urgent|normal): critical/high are urgent, medium/low normal.
func investigationSLAPriority(p model.LegalPriority) model.SLATargetPriority {
	switch p {
	case model.LegalPriorityCritical, model.LegalPriorityHigh:
		return model.SLATargetPriorityUrgent
	default:
		return model.SLATargetPriorityNormal
	}
}

// investigationBeneficiaryEntityID lifts the owning org entity id from the
// investigation metadata (key "beneficiary_entity_id") when present and parseable.
// Investigations carry no first-class org-entity column, so metadata is the carrier;
// a missing/invalid value yields nil (the SLA clock allows a NULL beneficiary).
func investigationBeneficiaryEntityID(inv *model.LegalInvestigation) *uuid.UUID {
	if inv == nil || inv.Metadata == nil {
		return nil
	}
	raw, ok := inv.Metadata["beneficiary_entity_id"]
	if !ok {
		return nil
	}
	str, ok := raw.(string)
	if !ok {
		return nil
	}
	id, err := uuid.Parse(strings.TrimSpace(str))
	if err != nil || id == uuid.Nil {
		return nil
	}
	return &id
}

// investigationAuditSnapshot is the status-shaped before/after snapshot written into
// the in-tx audit row. It deliberately excludes PII bodies (subject/findings) so the
// queryable audit ledger never stores plaintext sensitive data.
func investigationAuditSnapshot(inv *model.LegalInvestigation) map[string]any {
	if inv == nil {
		return nil
	}
	return map[string]any{
		"id":                   inv.ID.String(),
		"investigation_number": inv.InvestigationNumber,
		"status":               string(inv.Status),
		"priority":             string(inv.Priority),
		"case_id":              caseIDDetail(inv.CaseID),
		"closed_by":            uuidPtrDetail(inv.ClosedBy),
		"closed_at":            investigationTimePtrDetail(inv.ClosedAt),
	}
}

func investigationTimePtrDetail(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.UTC().Format(time.RFC3339Nano)
}

// investigationLedgerSnapshot is the status-shaped new_value for the immutable
// ledger emission; same PII-free shape as the in-tx snapshot.
func investigationLedgerSnapshot(inv *model.LegalInvestigation) map[string]any {
	return investigationAuditSnapshot(inv)
}

// draftBody runs the AID drafting engine for a findings/recommendations body.
func (s *InvestigationService) draftBody(ctx context.Context, tenantID uuid.UUID, systemPrompt, userPrompt string) (string, error) {
	if s.drafter == nil || !s.drafter.Enabled() {
		return "", conflictError("AI drafting is not enabled for this deployment")
	}
	if strings.TrimSpace(userPrompt) == "" {
		return "", validationError("a prompt is required when generate_ai is set", map[string]string{"prompt": "required"})
	}
	res, err := s.drafter.RunPrompt(ctx, tenantID, systemPrompt, userPrompt)
	if err != nil {
		return "", internalError("draft investigation body", err)
	}
	return strings.TrimSpace(res.Output), nil
}

func (s *InvestigationService) buildApprovalTask(tenantID uuid.UUID, inv *model.LegalInvestigation, instance *workflowmodel.WorkflowInstance, stepExec *workflowmodel.StepExecution, approverRole string, now time.Time) *workflowmodel.HumanTask {
	metadata := map[string]any{
		"investigation_id":     inv.ID.String(),
		"investigation_number": inv.InvestigationNumber,
		"subject_type":         "legal_investigation",
		"approval_mode":        workflowexec.ApprovalModeSequential,
		"approval_quorum":      workflowexec.QuorumAll,
		"approver_total":       1,
		"source":               "lex_investigation",
	}
	formSchema := []workflowmodel.FormField{
		{Name: "decision", Type: "select", Label: "Results decision", Required: true, Options: []string{"approve", "request_changes", "reject"}},
		{Name: "notes", Type: "textarea", Label: "Approval notes", Required: false},
	}
	return &workflowmodel.HumanTask{
		TenantID:     tenantID.String(),
		InstanceID:   instance.ID,
		StepID:       investigationApprovalStepID,
		StepExecID:   stepExec.ID,
		Name:         "Approve investigation results",
		Status:       workflowmodel.TaskStatusPending,
		AssigneeRole: ptrString(approverRole),
		FormSchema:   formSchema,
		FormData:     map[string]any{},
		Metadata:     metadata,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
}

// ensureDefinition lazily creates (once per tenant) the shared investigation
// results-approval workflow definition. Mirrors LegalCaseIntakeService.ensureDefinition.
func (s *InvestigationService) ensureDefinition(ctx context.Context, tenantID, userID uuid.UUID) (*workflowmodel.WorkflowDefinition, error) {
	var existing workflowmodel.WorkflowDefinition
	err := s.db.QueryRow(ctx, `
		SELECT id, version
		FROM workflow_definitions
		WHERE tenant_id = $1 AND name = $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY version DESC
		LIMIT 1`,
		tenantID, investigationApprovalWorkflowName,
	).Scan(&existing.ID, &existing.Version)
	if err == nil {
		existing.TenantID = tenantID.String()
		return &existing, nil
	}
	if err != pgx.ErrNoRows {
		return nil, internalError("load investigation approval definition", err)
	}
	definition := &workflowmodel.WorkflowDefinition{
		ID:          uuid.NewString(),
		TenantID:    tenantID.String(),
		Name:        investigationApprovalWorkflowName,
		Description: "Results-approval chain for Clario Lex legal investigations (CAP-083).",
		Version:     1,
		Status:      workflowmodel.DefinitionStatusActive,
		TriggerConfig: workflowmodel.TriggerConfig{
			Type: workflowmodel.TriggerTypeManual,
		},
		Variables: map[string]workflowmodel.VariableDef{
			"investigation_id":     {Type: "string"},
			"investigation_number": {Type: "string"},
		},
		Steps: []workflowmodel.StepDefinition{
			{ID: investigationApprovalStepID, Type: workflowexec.StepTypeApprovalChain, Name: "Investigation Results Approval", Config: map[string]any{}, Transitions: []workflowmodel.Transition{{Target: "end"}}},
			{ID: "end", Type: workflowmodel.StepTypeEnd, Name: "Completed", Config: map[string]any{}, Transitions: nil},
		},
		CreatedBy: userID.String(),
	}
	if err := s.defRepo.Create(ctx, definition); err != nil {
		return nil, internalError("create investigation approval definition", err)
	}
	return definition, nil
}

// --- validation + apply helpers ----------------------------------------------

// isLegalAffairsRoleSlug reports whether slug is one of the 14 Watheeq legal-affairs
// role slugs (auth.LegalAffairsRoleDefs — the single source of truth for the role
// matrix). It constrains the results-approval task's assignee role to the roster so a
// free-text approver_role typo can't persist an off-roster assignee no user can hold.
func isLegalAffairsRoleSlug(slug string) bool {
	for i := range auth.LegalAffairsRoleDefs {
		if auth.LegalAffairsRoleDefs[i].Slug == slug {
			return true
		}
	}
	return false
}

func validateInvestigationCreate(req dto.CreateInvestigationRequest) error {
	if req.Subject == "" {
		return validationError("subject is required", map[string]string{"subject": "required"})
	}
	if req.LeadInvestigator == "" {
		return validationError("lead_investigator is required", map[string]string{"lead_investigator": "required"})
	}
	if _, ok := allowedInvestigationPriorities[req.Priority]; !ok {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	return nil
}

func validateInvestigation(inv *model.LegalInvestigation) error {
	if strings.TrimSpace(inv.Subject) == "" {
		return validationError("subject is required", map[string]string{"subject": "required"})
	}
	if strings.TrimSpace(inv.LeadInvestigator) == "" {
		return validationError("lead_investigator is required", map[string]string{"lead_investigator": "required"})
	}
	if _, ok := allowedInvestigationPriorities[inv.Priority]; !ok {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	return nil
}

func applyInvestigationUpdate(inv *model.LegalInvestigation, req dto.UpdateInvestigationRequest) {
	if req.Subject != nil {
		inv.Subject = strings.TrimSpace(*req.Subject)
	}
	if req.LeadInvestigator != nil {
		inv.LeadInvestigator = strings.TrimSpace(*req.LeadInvestigator)
	}
	if req.Priority != nil {
		inv.Priority = *req.Priority
	}
	if req.CaseID != nil {
		// A zero UUID explicitly unlinks the investigation from its case, mirroring the
		// contract legal_reviewer_id / org_entity_id clear-sentinel convention. Go can't
		// distinguish a JSON null *uuid.UUID from an absent key (both decode to nil), so
		// the client sends the NIL_UUID sentinel to clear an existing case link.
		inv.CaseID = normalizeOptionalUUID(req.CaseID)
	}
	if req.Department != nil {
		inv.Department = normalizeOptionalString(req.Department)
	}
	if req.Metadata != nil {
		inv.Metadata = req.Metadata
	}
}

func applyInvestigationPartyUpdate(party *model.InvestigationParty, req dto.UpdateInvestigationPartyRequest) {
	if req.Role != nil {
		party.Role = *req.Role
	}
	if req.Name != nil {
		party.Name = strings.TrimSpace(*req.Name)
	}
	if req.Identifier != nil {
		party.Identifier = normalizeOptionalString(req.Identifier)
	}
	if req.Contact != nil {
		party.Contact = normalizeOptionalString(req.Contact)
	}
	if req.Metadata != nil {
		party.Metadata = req.Metadata
	}
}

func caseIDDetail(id *uuid.UUID) any {
	if id == nil {
		return nil
	}
	return id.String()
}

func uuidPtrDetail(id *uuid.UUID) any {
	if id == nil {
		return nil
	}
	return id.String()
}
