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

	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

const (
	settlementApprovalWorkflowName = "Lex Settlement Approval"
	settlementApprovalStepID       = "settlement_approval"
)

// SettlementDurationRecorder is the narrow seam the Settlements vertical uses to
// materialise processing-time facts in-process the instant a settlement is
// approved or its matter is closed by reconciliation (contract C-2). It mirrors
// the round-1 SLAStarter bridge: Settlements depends on this interface, not on
// *DurationFactService, so the two domains stay decoupled and the bridge is
// optional in tests. UpsertFromTransition is idempotent (keyed by tenant/kind/
// subject), so a replayed close refreshes the fact rather than duplicating it.
// When unwired, the only fact path is the out-of-process reporting consumer that
// already ingests com.clario360.lex.case.closed — wiring this closes the gap for
// single-node deployments where the Kafka bus is off.
type SettlementDurationRecorder interface {
	UpsertFromTransition(ctx context.Context, tenantID uuid.UUID, req dto.UpsertDurationFactRequest) (*model.DurationFact, error)
}

// SettlementService implements the Settlements / ADR vertical (CAP-089..093) over
// the FIRST-CLASS legal_settlement aggregate that FKs the owning legal_matter:
//
//	CAP-089 OpenReconciliation  — open a reconciliation attempt (status=proposed).
//	CAP-090 RecordSettlement    — record/update the negotiated terms.
//	CAP-091 AddNegotiationRound — track each offer/counter-offer round.
//	CAP-092 SubmitForApproval/Decide — drive approval through the SHARED, subject-
//	        agnostic ApprovalOrchestrator (NOT the contract-bound WorkflowService):
//	        a legal_settlement subject spec locks the row + advances its FSM.
//	CAP-093 CloseByReconciliation — once approved, execute the settlement and close
//	        the owning Matter with closure_reason='reconciliation'.
//
// Counterparty PII (name/contact/id-number) is field-encrypted at rest via
// FieldCrypto and decrypted on read. Every mutation runs in a transaction, appends
// an immutable governance audit row, applies the LegalHold guard where matter
// preservation matters, and emits a CloudEvent on events.Topics.LexEvents.
type SettlementService struct {
	db           *pgxpool.Pool
	settlements  *repository.SettlementRepository
	matters      *repository.MatterRepository
	delays       *repository.CaseDelayRepository
	orchestrator *ApprovalOrchestrator
	defRepo      *workflowrepo.DefinitionRepository
	instRepo     *workflowrepo.InstanceRepository
	taskRepo     *workflowrepo.TaskRepository
	publisher    Publisher
	metrics      *metrics.Metrics
	topic        string
	logger       zerolog.Logger
	now          func() time.Time
	crypto       *lexcrypto.FieldCrypto
	legalHolds   LegalHoldGuard
	auditEmitter *LexAuditEmitter
	facts        SettlementDurationRecorder
}

func NewSettlementService(
	db *pgxpool.Pool,
	settlements *repository.SettlementRepository,
	matters *repository.MatterRepository,
	delays *repository.CaseDelayRepository,
	orchestrator *ApprovalOrchestrator,
	defRepo *workflowrepo.DefinitionRepository,
	instRepo *workflowrepo.InstanceRepository,
	taskRepo *workflowrepo.TaskRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *SettlementService {
	return &SettlementService{
		db:           db,
		settlements:  settlements,
		matters:      matters,
		delays:       delays,
		orchestrator: orchestrator,
		defRepo:      defRepo,
		instRepo:     instRepo,
		taskRepo:     taskRepo,
		publisher:    publisherOrNoop(publisher),
		metrics:      appMetrics,
		topic:        topic,
		logger:       logger.With().Str("service", "lex-settlements").Logger(),
		now:          time.Now,
	}
}

// WithFieldCrypto wires counterparty-PII field encryption (additive, chainable).
func (s *SettlementService) WithFieldCrypto(crypto *lexcrypto.FieldCrypto) *SettlementService {
	s.crypto = crypto
	return s
}

// WithLegalHoldGuard wires the legal-hold enforcement guard (additive, chainable).
func (s *SettlementService) WithLegalHoldGuard(guard LegalHoldGuard) *SettlementService {
	s.legalHolds = guard
	return s
}

// SetAuditEmitter installs the immutable audit_db ledger emitter (WS4). Once set,
// every settlement mutation (open/record/negotiation-round/submit/approve/reject/
// close) emits a tamper-evident governance record onto the platform audit topic IN
// ADDITION to the in-tx legal_settlement_audit_log row, so the settlement trail is
// hash-chained in the central ledger. A nil emitter is ignored so the constructor
// default (no ledger) is never clobbered; emission is best-effort and never blocks
// or fails the mutation (mirrors LexAuditEmitter.Emit).
func (s *SettlementService) SetAuditEmitter(emitter *LexAuditEmitter) {
	if emitter != nil {
		s.auditEmitter = emitter
	}
}

// SetDurationFactRecorder installs the in-process processing-time fact bridge
// (contract C-2). Once set, an approved settlement records a settlement-resolution
// fact and a reconciliation-closed matter records a case-resolution fact INSIDE
// the same call, so turnaround reporting is correct even when the Kafka bus is off.
// A nil recorder is ignored. Fact writes are best-effort: a recorder error is
// logged, never returned, so the business transaction is never failed by reporting.
func (s *SettlementService) SetDurationFactRecorder(facts SettlementDurationRecorder) {
	if facts != nil {
		s.facts = facts
	}
}

// OpenReconciliation opens a reconciliation/settlement attempt on a matter
// (CAP-089). The settlement starts in status=proposed.
func (s *SettlementService) OpenReconciliation(ctx context.Context, tenantID, userID uuid.UUID, req dto.OpenReconciliationRequest) (*model.Settlement, error) {
	req.Normalize()
	if req.MatterID == uuid.Nil {
		return nil, validationError("matter_id is required", map[string]string{"matter_id": "required"})
	}
	if req.Title == "" {
		return nil, validationError("title is required", map[string]string{"title": "required"})
	}
	if !req.Method.Valid() {
		return nil, validationError("invalid settlement method", map[string]string{"method": "invalid"})
	}
	if err := s.ensureMatter(ctx, tenantID, req.MatterID); err != nil {
		return nil, err
	}
	reference := normalizeOptionalString(req.Reference)
	if reference == nil {
		generated := fmt.Sprintf("SET-%s-%s", s.now().UTC().Format("20060102"), strings.ToUpper(uuid.NewString()[:8]))
		reference = &generated
	}
	settlement := &model.Settlement{
		ID:                   uuid.New(),
		TenantID:             tenantID,
		MatterID:             req.MatterID,
		Reference:            *reference,
		Status:               model.SettlementStatusProposed,
		Method:               req.Method,
		Title:                req.Title,
		Terms:                req.Terms,
		Value:                req.Value,
		Currency:             normalizeOptionalString(req.Currency),
		CounterpartyName:     normalizeOptionalString(req.CounterpartyName),
		CounterpartyContact:  normalizeOptionalString(req.CounterpartyContact),
		CounterpartyIDNumber: normalizeOptionalString(req.CounterpartyIDNumber),
		Metadata:             req.Metadata,
		CreatedBy:            userID,
	}
	if err := s.encryptCounterparty(settlement); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start settlement transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.settlements.Create(ctx, tx, settlement); err != nil {
		return nil, internalError("create settlement", err)
	}
	if err := s.appendAudit(ctx, tx, settlement, userID, "settlement.opened", nil, ptrString(string(settlement.Status)), map[string]any{
		"matter_id": settlement.MatterID.String(),
		"method":    string(settlement.Method),
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit settlement open", err)
	}
	s.emitLedger(ctx, settlement, userID, "lex.settlement.opened", "info", nil, ptrString(string(settlement.Status)), map[string]any{
		"method": string(settlement.Method),
	})
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.settlement.opened", tenantID, &userID, map[string]any{
		"id":        settlement.ID,
		"matter_id": settlement.MatterID,
		"status":    settlement.Status,
		"method":    settlement.Method,
	}, s.logger)
	return s.Get(ctx, tenantID, settlement.ID)
}

// Get loads a settlement, decrypts counterparty PII, and hydrates its rounds.
func (s *SettlementService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.Settlement, error) {
	settlement, err := s.settlements.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("settlement not found")
		}
		return nil, internalError("load settlement", err)
	}
	if err := s.decryptCounterparty(settlement); err != nil {
		return nil, err
	}
	rounds, err := s.settlements.ListRounds(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load settlement rounds", err)
	}
	settlement.Rounds = rounds
	return settlement, nil
}

// List returns a tenant-scoped, filtered, paginated settlement listing. Counterparty
// PII is decrypted on each row.
func (s *SettlementService) List(ctx context.Context, tenantID uuid.UUID, filters model.SettlementListFilters) ([]model.Settlement, int, error) {
	items, total, err := s.settlements.List(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, internalError("list settlements", err)
	}
	for i := range items {
		if err := s.decryptCounterparty(&items[i]); err != nil {
			return nil, 0, err
		}
	}
	return items, total, nil
}

// Report returns the tenant-scoped Settlements / ADR analytics report (FEATURES
// 1 + 3): value and cycle-time roll-ups over the filtered settlement set. It
// honours the same filter params as List (matter_id/status/method/search) and is
// a pure read aggregation — no counterparty PII is exposed. Mirrors
// MatterService.MatterReport.
func (s *SettlementService) Report(ctx context.Context, tenantID uuid.UUID, filters model.SettlementListFilters) (*model.SettlementReport, error) {
	report, err := s.settlements.Report(ctx, tenantID, filters)
	if err != nil {
		return nil, internalError("aggregate settlement report", err)
	}
	report.GeneratedAt = s.now().UTC()
	report.Filters = settlementReportFilters(filters)
	return report, nil
}

// settlementReportFilters renders the active settlement filters as a flat
// string map for echo on the report (mirrors matterReportFilters).
func settlementReportFilters(filters model.SettlementListFilters) map[string]string {
	out := map[string]string{}
	if filters.Search != "" {
		out["search"] = filters.Search
	}
	if filters.Status != nil {
		out["status"] = string(*filters.Status)
	}
	if filters.Method != nil {
		out["method"] = string(*filters.Method)
	}
	if filters.MatterID != nil {
		out["matter_id"] = filters.MatterID.String()
	}
	return out
}

// RecordSettlement records/updates the negotiated terms (CAP-090). Only a settlement
// that has not yet been approved/executed is mutable.
func (s *SettlementService) RecordSettlement(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.RecordSettlementRequest) (*model.Settlement, error) {
	settlement, err := s.settlements.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("settlement not found")
		}
		return nil, internalError("load settlement", err)
	}
	if !settlementMutable(settlement.Status) {
		return nil, conflictError("settlement can no longer be edited in its current status")
	}
	if err := s.decryptCounterparty(settlement); err != nil {
		return nil, err
	}
	applyRecordSettlement(settlement, req)
	if settlement.Title == "" {
		return nil, validationError("title is required", map[string]string{"title": "required"})
	}
	if !settlement.Method.Valid() {
		return nil, validationError("invalid settlement method", map[string]string{"method": "invalid"})
	}
	if err := s.encryptCounterparty(settlement); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start settlement update transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.settlements.Update(ctx, tx, settlement); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("settlement not found")
		}
		return nil, internalError("update settlement", err)
	}
	if err := s.appendAudit(ctx, tx, settlement, userID, "settlement.recorded", nil, nil, map[string]any{"reference": settlement.Reference}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit settlement update", err)
	}
	s.emitLedger(ctx, settlement, userID, "lex.settlement.recorded", "info", nil, nil, nil)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.settlement.recorded", tenantID, &userID, map[string]any{
		"id":        id,
		"matter_id": settlement.MatterID,
		"status":    settlement.Status,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

// AddNegotiationRound appends one negotiation round (CAP-091) and moves a proposed
// settlement into negotiating.
func (s *SettlementService) AddNegotiationRound(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.AddNegotiationRoundRequest) (*model.SettlementNegotiationRound, error) {
	req.Normalize()
	if req.ProposedBy == "" {
		return nil, validationError("proposed_by is required", map[string]string{"proposed_by": "required"})
	}
	settlement, err := s.settlements.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("settlement not found")
		}
		return nil, internalError("load settlement", err)
	}
	if !settlementMutable(settlement.Status) {
		return nil, conflictError("settlement can no longer be negotiated in its current status")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start negotiation round transaction", err)
	}
	defer tx.Rollback(ctx)
	roundNumber, err := s.settlements.NextRoundNumber(ctx, tx, tenantID, id)
	if err != nil {
		return nil, internalError("compute next round number", err)
	}
	round := &model.SettlementNegotiationRound{
		ID:            uuid.New(),
		TenantID:      tenantID,
		SettlementID:  id,
		RoundNumber:   roundNumber,
		ProposedBy:    req.ProposedBy,
		ProposedValue: req.ProposedValue,
		Currency:      normalizeOptionalString(req.Currency),
		Terms:         req.Terms,
		Outcome:       req.Outcome,
		Metadata:      req.Metadata,
		CreatedBy:     userID,
	}
	if err := s.settlements.CreateRound(ctx, tx, round); err != nil {
		return nil, internalError("create negotiation round", err)
	}
	if settlement.Status == model.SettlementStatusProposed || settlement.Status == model.SettlementStatusRejected {
		// Guarded {proposed|rejected} -> negotiating: adding a round re-opens a
		// proposed or rejected settlement into active negotiation (a rejected
		// settlement is not a dead end — a new round routes it back to negotiating so
		// it can be re-recorded and re-submitted). The CAS is keyed on the EXACT
		// from-status read above, so a concurrent submit-for-approval that already
		// moved the row must not be silently overwritten back to 'negotiating'
		// (pgx.ErrNoRows -> 409).
		if err := s.settlements.UpdateStatusGuarded(ctx, tx, tenantID, id, settlement.Status, model.SettlementStatusNegotiating, nil, false, nil, nil, nil); err != nil {
			if err == pgx.ErrNoRows {
				return nil, conflictError("settlement status changed concurrently; retry the negotiation round")
			}
			return nil, internalError("advance settlement to negotiating", err)
		}
	}
	if err := s.appendAudit(ctx, tx, settlement, userID, "settlement.negotiation_round_added", nil, nil, map[string]any{
		"round_number": roundNumber,
		"proposed_by":  req.ProposedBy,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit negotiation round", err)
	}
	s.emitLedger(ctx, settlement, userID, "lex.settlement.negotiation_round_added", "info", nil, nil, map[string]any{
		"round_number": roundNumber,
		"proposed_by":  req.ProposedBy,
	})
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.settlement.negotiation_round_added", tenantID, &userID, map[string]any{
		"id":           id,
		"matter_id":    settlement.MatterID,
		"round_number": roundNumber,
	}, s.logger)
	return round, nil
}

// SubmitForApproval opens the approval chain for a settlement (CAP-092) through the
// SHARED ApprovalOrchestrator. It creates a workflow instance + approval-chain step
// + approver task, links the instance onto the settlement, and moves it into
// pending_approval. Approver decisions are recorded via Decide.
func (s *SettlementService) SubmitForApproval(ctx context.Context, tenantID, userID, id uuid.UUID) (*model.Settlement, error) {
	if s.instRepo == nil || s.taskRepo == nil || s.orchestrator == nil {
		return nil, internalError("settlement approval workflow repositories are not configured", fmt.Errorf("missing workflow dependencies"))
	}
	settlement, err := s.settlements.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("settlement not found")
		}
		return nil, internalError("load settlement", err)
	}
	if settlement.WorkflowInstanceID != nil {
		return nil, conflictError("settlement already has an active approval workflow")
	}
	if settlement.Status != model.SettlementStatusProposed && settlement.Status != model.SettlementStatusNegotiating {
		return nil, conflictError("only a proposed or negotiating settlement can be submitted for approval")
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
		CurrentStepID: ptrString(settlementApprovalStepID),
		Variables: map[string]any{
			"settlement_id": settlement.ID.String(),
			"matter_id":     settlement.MatterID.String(),
			"reference":     settlement.Reference,
		},
		StepOutputs: map[string]any{},
		StartedBy:   ptrString(userID.String()),
	}
	if err := s.instRepo.Create(ctx, instance); err != nil {
		return nil, internalError("create settlement approval workflow instance", err)
	}
	stepExec := &workflowmodel.StepExecution{
		InstanceID: instance.ID,
		StepID:     settlementApprovalStepID,
		StepType:   workflowexec.StepTypeApprovalChain,
		Status:     workflowmodel.StepStatusPending,
		Attempt:    1,
		CreatedAt:  now,
	}
	if err := s.instRepo.CreateStepExecution(ctx, stepExec); err != nil {
		return nil, internalError("create settlement approval step execution", err)
	}
	task := s.buildApprovalTask(tenantID, settlement, instance, stepExec, now)
	workflowID := uuid.MustParse(instance.ID)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start settlement approval transaction", err)
	}
	defer tx.Rollback(ctx)
	// Re-lock + re-validate the FSM under the row lock: the proposed/negotiating
	// check above was read without a lock, so a concurrent submit/round could have
	// moved the row. LockStatus serialises competing submits; the guarded transition
	// then rejects a stale submit (e.g. a second SubmitForApproval) with 409 instead
	// of attaching a second approval workflow.
	lockedStatus, err := s.settlements.LockStatus(ctx, tx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("settlement not found")
		}
		return nil, internalError("lock settlement for approval", err)
	}
	from := model.SettlementStatus(lockedStatus)
	if from != model.SettlementStatusProposed && from != model.SettlementStatusNegotiating {
		return nil, conflictError("only a proposed or negotiating settlement can be submitted for approval")
	}
	if err := insertWorkflowTask(ctx, tx, task); err != nil {
		return nil, internalError("create settlement approval task", err)
	}
	if err := s.settlements.UpdateStatusGuarded(ctx, tx, tenantID, id, from, model.SettlementStatusPendingApproval, &workflowID, false, nil, nil, nil); err != nil {
		if err == pgx.ErrNoRows {
			return nil, conflictError("settlement status changed concurrently; it can no longer be submitted for approval")
		}
		return nil, internalError("move settlement into approval", err)
	}
	if err := s.appendAudit(ctx, tx, settlement, userID, "settlement.submitted_for_approval",
		ptrString(string(from)), ptrString(string(model.SettlementStatusPendingApproval)),
		map[string]any{"workflow_instance_id": workflowID.String()}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit settlement approval start", err)
	}
	s.emitLedger(ctx, settlement, userID, "lex.settlement.submitted_for_approval", "info",
		ptrString(string(from)), ptrString(string(model.SettlementStatusPendingApproval)),
		map[string]any{"workflow_instance_id": workflowID.String()})
	if s.metrics != nil {
		s.metrics.WorkflowActive.Inc()
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.settlement.approval_started", tenantID, &userID, map[string]any{
		"id":                   id,
		"matter_id":            settlement.MatterID,
		"workflow_instance_id": workflowID,
		"status":               model.SettlementStatusPendingApproval,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

// Decide records one approver decision on a settlement's approval chain (CAP-092)
// via the SHARED orchestrator. On approval the settlement FSM advances to approved;
// on rejection it returns to rejected.
func (s *SettlementService) Decide(ctx context.Context, tenantID, userID, id, workflowInstanceID, taskID uuid.UUID, req dto.WorkflowDecisionRequest) (*ApprovalDecisionOutcome, error) {
	settlement, err := s.settlements.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("settlement not found")
		}
		return nil, internalError("load settlement", err)
	}
	if settlement.WorkflowInstanceID == nil || *settlement.WorkflowInstanceID != workflowInstanceID {
		return nil, conflictError("workflow instance does not belong to this settlement")
	}
	spec := s.subjectSpec(id)
	outcome, err := s.orchestrator.DecideTask(ctx, spec, tenantID, userID, workflowInstanceID, taskID, req)
	if err != nil {
		return nil, err
	}
	// Post-commit (the orchestrator committed its tx): mirror the FSM resolution to
	// the immutable ledger and record the settlement-resolution duration fact on
	// approval (contract C-2). Both are best-effort.
	switch outcome.Resolution {
	case workflowexec.ResolutionAdvance:
		s.emitLedger(ctx, settlement, userID, "lex.settlement.approved", "info",
			ptrString(string(model.SettlementStatusPendingApproval)), ptrString(string(model.SettlementStatusApproved)),
			map[string]any{"decision": outcome.Decision, "workflow_instance_id": workflowInstanceID.String()})
		// settlement.CreatedAt is the open instant; DecidedAt is the approval instant.
		s.recordSettlementResolvedFact(ctx, settlement, outcome.DecidedAt.UTC())
	case workflowexec.ResolutionReject:
		s.emitLedger(ctx, settlement, userID, "lex.settlement.rejected", "warning",
			ptrString(string(model.SettlementStatusPendingApproval)), ptrString(string(model.SettlementStatusRejected)),
			map[string]any{"decision": outcome.Decision, "workflow_instance_id": workflowInstanceID.String()})
	}
	return outcome, nil
}

// CloseByReconciliation executes an APPROVED settlement (CAP-093): it stamps the
// settlement executed and closes the owning Matter with closure_reason=
// 'reconciliation'. The matter must not be under an active legal hold. All writes
// commit in one transaction with the governance audit row.
func (s *SettlementService) CloseByReconciliation(ctx context.Context, tenantID, userID, id uuid.UUID) (*model.Settlement, error) {
	settlement, err := s.settlements.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("settlement not found")
		}
		return nil, internalError("load settlement", err)
	}
	if settlement.Status != model.SettlementStatusApproved {
		return nil, conflictError("only an approved settlement can close the matter by reconciliation")
	}
	// FR-WATHEEQ-005: a held matter cannot be closed while preservation is in force.
	if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectMatter, settlement.MatterID); err != nil {
		return nil, err
	}
	now := s.now().UTC()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start settlement close transaction", err)
	}
	defer tx.Rollback(ctx)

	// WS2 (double-close guard) — compare-and-swap the settlement under its row lock.
	// LockStatus takes FOR UPDATE so two concurrent CloseByReconciliation calls
	// serialise here; the loser re-reads status='executed' and the guarded transition
	// below rejects it. This replaces the previous unguarded read-then-write that let
	// both calls pass the pre-tx status check and double-execute.
	lockedStatus, err := s.settlements.LockStatus(ctx, tx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("settlement not found")
		}
		return nil, internalError("lock settlement for close", err)
	}
	if model.SettlementStatus(lockedStatus) != model.SettlementStatusApproved {
		return nil, conflictError("only an approved settlement can close the matter by reconciliation")
	}
	if err := s.settlements.UpdateStatusGuarded(ctx, tx, tenantID, id, model.SettlementStatusApproved, model.SettlementStatusExecuted, nil, false, nil, nil, &now); err != nil {
		if err == pgx.ErrNoRows {
			return nil, conflictError("settlement was already executed by a concurrent close")
		}
		return nil, internalError("execute settlement", err)
	}

	// WS2 — lock the owning matter FOR UPDATE, then close it via a guarded UPDATE that
	// only fires while the matter is non-terminal. A matter already closed (e.g. by a
	// racing reconciliation or a manual close) yields pgx.ErrNoRows and we 409 rather
	// than re-stamping closure. The lock + guard together make the close idempotent and
	// double-close-safe (CAP-093 / WS3 matter terminal status).
	matterStatus, snap, err := s.settlements.LockMatterForClose(ctx, tx, tenantID, settlement.MatterID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter not found")
		}
		return nil, internalError("lock matter for close", err)
	}
	if matterStatus == model.MatterStatusClosed || matterStatus == model.MatterStatusCancelled {
		return nil, conflictError("the owning matter is already closed")
	}
	if err := s.settlements.CloseMatterByReconciliation(ctx, tx, tenantID, settlement.MatterID, now); err != nil {
		if err == pgx.ErrNoRows {
			return nil, conflictError("the owning matter was closed by a concurrent operation")
		}
		return nil, internalError("close matter by reconciliation", err)
	}
	if err := s.appendAudit(ctx, tx, settlement, userID, "settlement.closed_by_reconciliation",
		ptrString(string(model.SettlementStatusApproved)), ptrString(string(model.SettlementStatusExecuted)),
		map[string]any{"matter_id": settlement.MatterID.String(), "closure_reason": "reconciliation"}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit settlement close", err)
	}
	s.emitLedger(ctx, settlement, userID, "lex.settlement.closed_by_reconciliation", "info",
		ptrString(string(model.SettlementStatusApproved)), ptrString(string(model.SettlementStatusExecuted)),
		map[string]any{"closure_reason": "reconciliation", "closed_at": now.Format(time.RFC3339Nano)})
	// Contract C-2 — record both processing-time facts in-process (bus-off safe):
	// the settlement-resolution window (open -> approved) and the matter case-
	// resolution window (open -> closed). The matter snapshot was read under the lock.
	if settlement.ApprovedAt != nil {
		s.recordSettlementResolvedFact(ctx, settlement, settlement.ApprovedAt.UTC())
	}
	s.recordMatterResolvedFact(ctx, settlement, snap, now)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.settlement.closed_by_reconciliation", tenantID, &userID, map[string]any{
		"id":             id,
		"matter_id":      settlement.MatterID,
		"status":         model.SettlementStatusExecuted,
		"closure_reason": "reconciliation",
		"started_at":     settlement.CreatedAt,
		"closed_at":      now,
	}, s.logger)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.closed", tenantID, &userID, map[string]any{
		"id":             settlement.MatterID,
		"matter_id":      settlement.MatterID,
		"case_type":      snap.Type,
		"department":     snap.Department,
		"started_at":     snap.OpenedAt,
		"closed_at":      now,
		"closure_reason": "reconciliation",
		"settlement_id":  id,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

// Delete soft-deletes a settlement. A settlement whose matter is under an active
// legal hold cannot be removed (preservation).
func (s *SettlementService) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	settlement, err := s.settlements.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("settlement not found")
		}
		return internalError("load settlement", err)
	}
	if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectMatter, settlement.MatterID); err != nil {
		return err
	}
	if err := s.settlements.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("settlement not found")
		}
		return internalError("delete settlement", err)
	}
	return nil
}

// ListAudit returns the append-only governance audit trail for a settlement.
func (s *SettlementService) ListAudit(ctx context.Context, tenantID, id uuid.UUID) ([]model.SettlementAuditEntry, error) {
	if _, err := s.settlements.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("settlement not found")
		}
		return nil, internalError("load settlement", err)
	}
	entries, err := s.settlements.ListAudit(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load settlement audit", err)
	}
	return entries, nil
}

// --- approval orchestrator hooks --------------------------------------------

// subjectSpec builds the orchestrator hook set for a settlement: it locks the
// settlement row FOR UPDATE and advances its FSM as the approval chain resolves.
func (s *SettlementService) subjectSpec(settlementID uuid.UUID) ApprovalSubjectSpec {
	return ApprovalSubjectSpec{
		SubjectType: "legal_settlement",
		SubjectID:   settlementID,
		EventEntity: "settlement",
		LockSubject: func(ctx context.Context, tx pgx.Tx, tenantID, subjectID uuid.UUID) (string, error) {
			return s.settlements.LockStatus(ctx, tx, tenantID, subjectID)
		},
		AdvanceSubject: s.advanceSettlementStatus,
	}
}

// advanceSettlementStatus is the settlement-FSM hook the shared engine calls when
// the approval chain resolves. It runs INSIDE the engine's transaction: approve →
// approved (stamps approver/approved_at, clears the workflow link); reject →
// rejected (clears the workflow link).
func (s *SettlementService) advanceSettlementStatus(ctx context.Context, tx pgx.Tx, tenantID, userID, subjectID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error) {
	from := model.SettlementStatusPendingApproval
	switch resolution {
	case workflowexec.ResolutionAdvance:
		approver := userID
		approvedAt := now
		// Guarded pending_approval -> approved (CAS). The engine already holds the
		// row lock via LockSubject, so this rejects any out-of-band status drift.
		if err := s.settlements.UpdateStatusGuarded(ctx, tx, tenantID, subjectID, from, model.SettlementStatusApproved, nil, true, &approver, &approvedAt, nil); err != nil {
			if err == pgx.ErrNoRows {
				return "", conflictError("settlement is no longer pending approval")
			}
			return "", internalError("approve settlement", err)
		}
		if err := s.appendAuditByID(ctx, tx, tenantID, subjectID, userID, "settlement.approved",
			ptrString(string(from)), ptrString(string(model.SettlementStatusApproved)),
			map[string]any{"decision": decision}); err != nil {
			return "", err
		}
		return string(model.SettlementStatusApproved), nil
	case workflowexec.ResolutionReject:
		if err := s.settlements.UpdateStatusGuarded(ctx, tx, tenantID, subjectID, from, model.SettlementStatusRejected, nil, true, nil, nil, nil); err != nil {
			if err == pgx.ErrNoRows {
				return "", conflictError("settlement is no longer pending approval")
			}
			return "", internalError("reject settlement", err)
		}
		if err := s.appendAuditByID(ctx, tx, tenantID, subjectID, userID, "settlement.rejected",
			ptrString(string(from)), ptrString(string(model.SettlementStatusRejected)),
			map[string]any{"decision": decision}); err != nil {
			return "", err
		}
		return string(model.SettlementStatusRejected), nil
	default:
		return string(model.SettlementStatusPendingApproval), nil
	}
}

func (s *SettlementService) buildApprovalTask(tenantID uuid.UUID, settlement *model.Settlement, instance *workflowmodel.WorkflowInstance, stepExec *workflowmodel.StepExecution, now time.Time) *workflowmodel.HumanTask {
	metadata := map[string]any{
		"settlement_id":   settlement.ID.String(),
		"matter_id":       settlement.MatterID.String(),
		"reference":       settlement.Reference,
		"subject_type":    "legal_settlement",
		"approval_mode":   workflowexec.ApprovalModeSequential,
		"approval_quorum": workflowexec.QuorumAll,
		"approver_total":  1,
		"source":          "lex_settlement_approval",
	}
	formSchema := []workflowmodel.FormField{
		{Name: "decision", Type: "select", Label: "Settlement decision", Required: true, Options: []string{"approve", "request_changes", "reject"}},
		{Name: "notes", Type: "textarea", Label: "Approval notes", Required: false},
	}
	return &workflowmodel.HumanTask{
		TenantID:     tenantID.String(),
		InstanceID:   instance.ID,
		StepID:       settlementApprovalStepID,
		StepExecID:   stepExec.ID,
		Name:         "Approve settlement",
		Status:       workflowmodel.TaskStatusPending,
		AssigneeRole: ptrString("legal-director"),
		FormSchema:   formSchema,
		FormData:     map[string]any{},
		Metadata:     metadata,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
}

// ensureDefinition lazily creates (once per tenant) the shared settlement-approval
// workflow definition. Mirrors RequestApprovalService.ensureDefinition.
func (s *SettlementService) ensureDefinition(ctx context.Context, tenantID, userID uuid.UUID) (*workflowmodel.WorkflowDefinition, error) {
	var existing workflowmodel.WorkflowDefinition
	err := s.db.QueryRow(ctx, `
		SELECT id, version
		FROM workflow_definitions
		WHERE tenant_id = $1 AND name = $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY version DESC
		LIMIT 1`,
		tenantID, settlementApprovalWorkflowName,
	).Scan(&existing.ID, &existing.Version)
	if err == nil {
		existing.TenantID = tenantID.String()
		return &existing, nil
	}
	if err != pgx.ErrNoRows {
		return nil, internalError("load settlement approval definition", err)
	}
	definition := &workflowmodel.WorkflowDefinition{
		ID:          uuid.NewString(),
		TenantID:    tenantID.String(),
		Name:        settlementApprovalWorkflowName,
		Description: "Subject-agnostic settlement/ADR approval workflow for Clario Lex.",
		Version:     1,
		Status:      workflowmodel.DefinitionStatusActive,
		TriggerConfig: workflowmodel.TriggerConfig{
			Type: workflowmodel.TriggerTypeManual,
		},
		Variables: map[string]workflowmodel.VariableDef{
			"settlement_id": {Type: "string"},
			"matter_id":     {Type: "string"},
			"reference":     {Type: "string"},
		},
		Steps: []workflowmodel.StepDefinition{
			{ID: settlementApprovalStepID, Type: workflowexec.StepTypeApprovalChain, Name: "Settlement Approval", Config: map[string]any{}, Transitions: []workflowmodel.Transition{{Target: "end"}}},
			{ID: "end", Type: workflowmodel.StepTypeEnd, Name: "Completed", Config: map[string]any{}, Transitions: nil},
		},
		CreatedBy: userID.String(),
	}
	if err := s.defRepo.Create(ctx, definition); err != nil {
		return nil, internalError("create settlement approval definition", err)
	}
	return definition, nil
}

// --- internals --------------------------------------------------------------

func (s *SettlementService) ensureMatter(ctx context.Context, tenantID, matterID uuid.UUID) error {
	if _, err := s.matters.Get(ctx, tenantID, matterID); err != nil {
		if err == pgx.ErrNoRows {
			return validationError("linked matter not found", map[string]string{"matter_id": "not found"})
		}
		return internalError("load linked matter", err)
	}
	return nil
}

// appendAudit appends an immutable settlement governance audit row inside tx.
func (s *SettlementService) appendAudit(ctx context.Context, tx pgx.Tx, settlement *model.Settlement, userID uuid.UUID, action string, fromStatus, toStatus *string, detail map[string]any) error {
	entry := &model.SettlementAuditEntry{
		ID:           uuid.New(),
		TenantID:     settlement.TenantID,
		SettlementID: settlement.ID,
		Action:       action,
		FromStatus:   fromStatus,
		ToStatus:     toStatus,
		Detail:       detail,
		ActorUserID:  userID,
	}
	if err := s.settlements.AppendAudit(ctx, tx, entry); err != nil {
		return internalError("append settlement audit", err)
	}
	return nil
}

// emitLedger forwards a settlement governance action to the immutable audit_db
// ledger (WS4). It is best-effort and a no-op when no emitter is wired. Counterparty
// PII is never placed in the ledger payload — only non-sensitive identifiers and
// the FSM transition are recorded.
func (s *SettlementService) emitLedger(ctx context.Context, settlement *model.Settlement, userID uuid.UUID, action, severity string, fromStatus, toStatus *string, detail map[string]any) {
	if s.auditEmitter == nil {
		return
	}
	actor := userID
	merged := map[string]any{
		"matter_id": settlement.MatterID.String(),
		"reference": settlement.Reference,
	}
	if fromStatus != nil {
		merged["from_status"] = *fromStatus
	}
	if toStatus != nil {
		merged["to_status"] = *toStatus
	}
	for k, v := range detail {
		merged[k] = v
	}
	s.auditEmitter.Emit(ctx, LexAuditRecord{
		TenantID:     settlement.TenantID,
		ActorUserID:  &actor,
		Action:       action,
		ResourceType: "lex.settlement",
		ResourceID:   settlement.ID.String(),
		Severity:     severity,
		Detail:       merged,
	})
}

// recordSettlementResolvedFact records the settlement-resolution processing-time
// fact (open -> approved) in-process (contract C-2). Best-effort: a recorder error
// is logged, never returned, so an approval is never failed by reporting.
func (s *SettlementService) recordSettlementResolvedFact(ctx context.Context, settlement *model.Settlement, approvedAt time.Time) {
	if s.facts == nil {
		return
	}
	category := string(settlement.Method)
	if _, err := s.facts.UpsertFromTransition(ctx, settlement.TenantID, dto.UpsertDurationFactRequest{
		Kind:       model.DurationFactSettlementResolution,
		SubjectID:  settlement.ID,
		Category:   &category,
		StartedAt:  settlement.CreatedAt,
		EndedAt:    approvedAt,
		OccurredAt: approvedAt,
	}); err != nil {
		s.logger.Warn().Err(err).Str("settlement_id", settlement.ID.String()).Msg("record settlement-resolution duration fact")
	}
}

// recordMatterResolvedFact records the case-resolution processing-time fact for the
// matter closed by reconciliation (open -> closed) in-process (contract C-2). It
// mirrors the fact the reporting consumer derives from com.clario360.lex.case.closed
// so single-node (bus-off) deployments still populate turnaround reporting. Idempotent
// via the fact store's (tenant,kind,subject) key. Best-effort.
func (s *SettlementService) recordMatterResolvedFact(ctx context.Context, settlement *model.Settlement, snap repository.MatterCloseSnapshot, closedAt time.Time) {
	if s.facts == nil {
		return
	}
	category := snap.Type
	if _, err := s.facts.UpsertFromTransition(ctx, settlement.TenantID, dto.UpsertDurationFactRequest{
		Kind:       model.DurationFactCaseResolution,
		SubjectID:  settlement.MatterID,
		Department: snap.Department,
		Category:   normalizeOptionalString(&category),
		StartedAt:  snap.OpenedAt,
		EndedAt:    closedAt,
		OccurredAt: closedAt,
	}); err != nil {
		s.logger.Warn().Err(err).Str("matter_id", settlement.MatterID.String()).Msg("record case-resolution duration fact")
	}
}

// appendAuditByID appends an immutable settlement governance audit row inside tx
// keyed by (tenantID, settlementID) directly, for hooks (e.g. the approval engine
// callback) that hold the IDs but not a hydrated *model.Settlement.
func (s *SettlementService) appendAuditByID(ctx context.Context, tx pgx.Tx, tenantID, settlementID, userID uuid.UUID, action string, fromStatus, toStatus *string, detail map[string]any) error {
	entry := &model.SettlementAuditEntry{
		ID:           uuid.New(),
		TenantID:     tenantID,
		SettlementID: settlementID,
		Action:       action,
		FromStatus:   fromStatus,
		ToStatus:     toStatus,
		Detail:       detail,
		ActorUserID:  userID,
	}
	if err := s.settlements.AppendAudit(ctx, tx, entry); err != nil {
		return internalError("append settlement audit", err)
	}
	return nil
}

// encryptCounterparty encrypts the settlement's counterparty PII in place. A nil
// FieldCrypto leaves the (legacy plaintext) values unchanged.
func (s *SettlementService) encryptCounterparty(settlement *model.Settlement) error {
	if s.crypto == nil {
		return nil
	}
	var err error
	if settlement.CounterpartyName, err = s.crypto.EncryptPtr(settlement.CounterpartyName); err != nil {
		return internalError("encrypt counterparty name", err)
	}
	if settlement.CounterpartyContact, err = s.crypto.EncryptPtr(settlement.CounterpartyContact); err != nil {
		return internalError("encrypt counterparty contact", err)
	}
	if settlement.CounterpartyIDNumber, err = s.crypto.EncryptPtr(settlement.CounterpartyIDNumber); err != nil {
		return internalError("encrypt counterparty id number", err)
	}
	return nil
}

// decryptCounterparty decrypts the settlement's counterparty PII in place. Legacy
// plaintext and nil values pass through unchanged.
func (s *SettlementService) decryptCounterparty(settlement *model.Settlement) error {
	if s.crypto == nil {
		return nil
	}
	var err error
	if settlement.CounterpartyName, err = s.crypto.DecryptPtr(settlement.CounterpartyName); err != nil {
		return internalError("decrypt counterparty name", err)
	}
	if settlement.CounterpartyContact, err = s.crypto.DecryptPtr(settlement.CounterpartyContact); err != nil {
		return internalError("decrypt counterparty contact", err)
	}
	if settlement.CounterpartyIDNumber, err = s.crypto.DecryptPtr(settlement.CounterpartyIDNumber); err != nil {
		return internalError("decrypt counterparty id number", err)
	}
	return nil
}

// applyRecordSettlement applies the CAP-090 patch to a settlement in place.
func applyRecordSettlement(settlement *model.Settlement, req dto.RecordSettlementRequest) {
	if req.Reference != nil {
		settlement.Reference = strings.TrimSpace(*req.Reference)
	}
	if req.Method != nil {
		settlement.Method = model.SettlementMethod(strings.ToLower(strings.TrimSpace(string(*req.Method))))
	}
	if req.Title != nil {
		settlement.Title = strings.TrimSpace(*req.Title)
	}
	if req.Terms != nil {
		settlement.Terms = strings.TrimSpace(*req.Terms)
	}
	if req.Value != nil {
		settlement.Value = req.Value
	}
	if req.Currency != nil {
		settlement.Currency = normalizeOptionalString(req.Currency)
	}
	if req.CounterpartyName != nil {
		settlement.CounterpartyName = normalizeOptionalString(req.CounterpartyName)
	}
	if req.CounterpartyContact != nil {
		settlement.CounterpartyContact = normalizeOptionalString(req.CounterpartyContact)
	}
	if req.CounterpartyIDNumber != nil {
		settlement.CounterpartyIDNumber = normalizeOptionalString(req.CounterpartyIDNumber)
	}
	if req.Metadata != nil {
		settlement.Metadata = req.Metadata
	}
}

// settlementMutable reports whether a settlement can still be edited/negotiated.
// A rejected settlement is mutable so it can be re-opened: recording new terms or
// adding a negotiation round on it is the intended path back into negotiation
// (AddNegotiationRound advances rejected -> negotiating), rather than a dead end.
func settlementMutable(status model.SettlementStatus) bool {
	switch status {
	case model.SettlementStatusProposed, model.SettlementStatusNegotiating, model.SettlementStatusRejected:
		return true
	default:
		return false
	}
}
