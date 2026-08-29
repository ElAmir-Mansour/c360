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

// caseStatusOnHold is the FSM hold/delayed state (WS3, CAP-088). A case can be put
// on hold from any operational state and resumed back to it; entering it REQUIRES a
// classified delay category (court|government|department|expert) + a reason, and it
// NEVER forces a closure date (CAP-085). The constant lives here (not in the model)
// to keep the model package out of this unit's edit scope; it matches the value the
// staged 000038 migration adds to the legal_cases.status CHECK.
const caseStatusOnHold model.CaseStatus = "on_hold"

// caseStatusTransitions is the edge set exposed by the generic /status endpoint.
// The governed intake -> phase1 -> phase2 -> open pipeline (including a Phase-1
// rejection back to intake) is deliberately absent: LegalCaseIntakeService alone
// advances those edges together with its workflow, evidence and assignment writes.
// The generic endpoint may cancel a pipeline case or move an operational case.
var caseStatusTransitions = map[model.CaseStatus]map[model.CaseStatus]struct{}{
	model.CaseStatusIntake: {
		model.CaseStatusCancelled: {},
	},
	model.CaseStatusPhase1: {
		model.CaseStatusCancelled: {},
	},
	model.CaseStatusPhase2: {
		model.CaseStatusCancelled: {},
	},
	model.CaseStatusOpen: {
		model.CaseStatusUnderProcedure: {},
		caseStatusOnHold:               {},
		model.CaseStatusClosed:         {},
		model.CaseStatusCancelled:      {},
	},
	model.CaseStatusUnderProcedure: {
		model.CaseStatusOpen:      {},
		caseStatusOnHold:          {},
		model.CaseStatusClosed:    {},
		model.CaseStatusCancelled: {},
	},
	caseStatusOnHold: {
		model.CaseStatusOpen:           {},
		model.CaseStatusUnderProcedure: {},
		model.CaseStatusClosed:         {},
		model.CaseStatusCancelled:      {},
	},
}

// caseDelayCategories is the allow-list of classified hold/delay causes (CAP-088),
// reusing the case_delay model's DelayCategory domain.
var caseDelayCategories = map[model.DelayCategory]struct{}{
	model.DelayCategoryCourt:      {},
	model.DelayCategoryGovernment: {},
	model.DelayCategoryDepartment: {},
	model.DelayCategoryExpert:     {},
}

// caseSLAServiceCode is the SLA service-code under which a litigation case's
// SLA clock is materialised on open (WS3) when the case carries no explicit
// service_code in metadata. The clock keys on the case's RequestID back-link when
// present, else the case ID, so a per-case turnaround/escalation budget can be
// resolved from an admin SLA target.
const caseSLAServiceCode = "legal_case"

type caseSLAService interface {
	SLAStarter
	SLAResolver
}

var allowedCaseCompanyStatuses = map[model.CaseCompanyStatus]struct{}{
	model.CaseCompanyStatusPlaintiff: {},
	model.CaseCompanyStatusDefendant: {},
}

// LegalCaseService owns the first-class litigation case aggregate (CAP-032..051):
// CRUD, the case FSM, the management actions (transfer-to-section-manager,
// assign-supervisor/officer, define-task, set-priority/strength), and the
// parties/hearings/tasks sub-resources. Every mutation appends an immutable
// governance audit row + a version snapshot in the SAME transaction (CAP-051), and
// emits a CloudEvent on events.Topics.LexEvents. The two-phase intake pipeline is
// driven by LegalCaseIntakeService, which reuses this service's repos + audit.
type LegalCaseService struct {
	db        *pgxpool.Pool
	cases     *repository.LegalCaseRepository
	contracts *repository.ContractRepository
	requests  *repository.LegalRequestRepository
	classes   *repository.CaseClassificationRepository
	courts    *repository.LegalCourtRepository
	parties   *repository.CasePartyRepository
	hearings  *repository.CaseHearingRepository
	tasks     *repository.CaseTaskRepository
	comments  *repository.CaseCommentRepository
	caseDocs  *repository.CaseDocumentRepository
	documents *repository.DocumentRepository
	publisher Publisher
	metrics   *metrics.Metrics
	topic     string
	logger    zerolog.Logger
	now       func() time.Time

	// sla is the optional in-process SLA-clock bridge (WS3). When set, a case that
	// transitions to 'open' materialises its ack/turnaround/escalation deadlines
	// from the working calendar via SLAService.StartClock. Idempotent + best-effort:
	// a missing target/calendar logs and continues. Satisfied by *SLAService.
	sla caseSLAService
	// audit is the optional immutable-ledger emitter (WS4). When set, every case
	// mutation also emits a structured audit record onto the audit_db ledger via the
	// audit-service consumer, in addition to the in-tx governance audit row.
	audit      *LexAuditEmitter
	assignment *CaseAssignmentValidator
}

func NewLegalCaseService(
	db *pgxpool.Pool,
	cases *repository.LegalCaseRepository,
	contracts *repository.ContractRepository,
	requests *repository.LegalRequestRepository,
	classes *repository.CaseClassificationRepository,
	courts *repository.LegalCourtRepository,
	parties *repository.CasePartyRepository,
	hearings *repository.CaseHearingRepository,
	tasks *repository.CaseTaskRepository,
	comments *repository.CaseCommentRepository,
	caseDocs *repository.CaseDocumentRepository,
	documents *repository.DocumentRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *LegalCaseService {
	return &LegalCaseService{
		db:        db,
		cases:     cases,
		contracts: contracts,
		requests:  requests,
		classes:   classes,
		courts:    courts,
		parties:   parties,
		hearings:  hearings,
		tasks:     tasks,
		comments:  comments,
		caseDocs:  caseDocs,
		documents: documents,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-legal-cases").Logger(),
		now:       time.Now,
	}
}

// SetSLAService installs the in-process SLA clock bridge (WS3). Once set, a case
// transition to 'open' starts the SLA clock so the ack/turnaround/escalation
// deadlines materialise from the working calendar with BeneficiaryEntityID set to
// the owning org entity (so the escalation ladder resolves). A nil starter is
// ignored so the constructor default (no bridge) is never clobbered; StartClock is
// idempotent (a repeated start for the same key returns the existing clock).
func (s *LegalCaseService) SetSLAService(sla caseSLAService) {
	if sla != nil {
		s.sla = sla
	}
}

// SetAuditEmitter installs the immutable-ledger audit emitter (WS4). Once set,
// every case mutation also routes a structured audit record to the audit_db ledger.
// A nil emitter is ignored. Emission is best-effort and never fails the operation.
func (s *LegalCaseService) SetAuditEmitter(emitter *LexAuditEmitter) {
	if emitter != nil {
		s.audit = emitter
	}
}

// SetAssignmentValidator installs the shared IAM + legal-org validator used by
// every case work-allocation mutation.
func (s *LegalCaseService) SetAssignmentValidator(validator *CaseAssignmentValidator) {
	if validator != nil {
		s.assignment = validator
	}
}

// Create materialises a new litigation case (CAP-032, CAP-042..050). case_number
// is auto-generated when omitted. The insert, the first version snapshot and the
// "created" audit row all commit in one transaction.
func (s *LegalCaseService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateLegalCaseRequest) (*model.LegalCase, error) {
	req.Normalize()
	if err := s.canonicalizeCreateReferences(ctx, tenantID, &req, nil); err != nil {
		return nil, err
	}
	if err := validateLegalCaseCreate(req); err != nil {
		return nil, err
	}
	if _, hasBeneficiary := req.Metadata["beneficiary_entity_id"]; hasBeneficiary {
		if s.assignment == nil {
			return nil, internalError("case assignment validator is not configured", fmt.Errorf("missing case assignment validator"))
		}
		if _, err := s.assignment.validateBeneficiaryEntity(ctx, tenantID, req.Metadata); err != nil {
			return nil, err
		}
	}
	caseNumber := req.CaseNumber
	if caseNumber == nil {
		generated := fmt.Sprintf("CASE-%s-%s", s.now().UTC().Format("20060102"), strings.ToUpper(uuid.NewString()[:8]))
		caseNumber = &generated
	}
	c := &model.LegalCase{
		ID:                 uuid.New(),
		TenantID:           tenantID,
		CaseNumber:         *caseNumber,
		CourtNumber:        req.CourtNumber,
		CaseType:           req.CaseType,
		OtherCaseType:      req.OtherCaseType,
		ClassificationID:   req.ClassificationID,
		CourtID:            req.CourtID,
		ContractID:         req.ContractID,
		CompanyStatus:      req.CompanyStatus,
		CompetentCourt:     req.CompetentCourt,
		Chamber:            req.Chamber,
		FilingDate:         req.FilingDate,
		Title:              req.Title,
		Description:        req.Description,
		Strength:           req.Strength,
		ClaimAmount:        req.ClaimAmount,
		CourtFees:          req.CourtFees,
		LegalFees:          req.LegalFees,
		Currency:           req.Currency,
		ExpectedResolution: req.ExpectedResolution,
		Status:             req.Status,
		Priority:           req.Priority,
		SectionManagerID:   req.SectionManagerID,
		SupervisorID:       req.SupervisorID,
		HandlingOfficerID:  req.HandlingOfficerID,
		ResponsibleLawyer:  req.ResponsibleLawyer,
		Department:         req.Department,
		RequestID:          req.RequestID,
		Metadata:           req.Metadata,
		CreatedBy:          userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case create transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.cases.Create(ctx, tx, c); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("case_number already exists")
		}
		return nil, internalError("create legal case", err)
	}
	if c.RequestID != nil {
		if err := linkLegalRequestToCase(ctx, tx, tenantID, *c.RequestID, c.ID); err != nil {
			return nil, err
		}
	}
	if err := s.recordAudit(ctx, tx, c, userID, "case.created", nil, nil, map[string]any{
		"case_number": c.CaseNumber,
		"status":      c.Status,
	}); err != nil {
		return nil, err
	}
	if err := createAutomatedCaseTasks(ctx, tx, s.cases, s.tasks, tenantID, userID, c.ID, newCaseAutomationTasks(c, s.now().UTC())); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case create", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.created", tenantID, &userID, map[string]any{
		"id":             c.ID,
		"case_number":    c.CaseNumber,
		"status":         c.Status,
		"company_status": c.CompanyStatus,
		"contract_id":    c.ContractID,
		"request_id":     c.RequestID,
	}, s.logger)
	return s.Get(ctx, tenantID, c.ID)
}

func (s *LegalCaseService) List(ctx context.Context, tenantID uuid.UUID, filters model.LegalCaseListFilters) ([]model.LegalCase, int, error) {
	return s.cases.List(ctx, tenantID, filters)
}

// Get loads the case and hydrates its parties, hearings and tasks.
func (s *LegalCaseService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalCase, error) {
	c, err := s.cases.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	if c.Parties, err = s.parties.ListByCase(ctx, tenantID, id); err != nil {
		return nil, internalError("load case parties", err)
	}
	if c.Hearings, err = s.hearings.ListByCase(ctx, tenantID, id); err != nil {
		return nil, internalError("load case hearings", err)
	}
	if c.Tasks, err = s.tasks.ListByCase(ctx, tenantID, id); err != nil {
		return nil, internalError("load case tasks", err)
	}
	return c, nil
}

// GetWithComputed loads the case (with its hydrated parties/hearings/tasks) and
// attaches the WS9 computed block (sla_outcome, days_open, next_hearing_date,
// escalation_level, open_task_count). The embedded case keeps every existing
// field, so the response is a strict superset of Get's (backward-compatible).
func (s *LegalCaseService) GetWithComputed(ctx context.Context, tenantID, id uuid.UUID) (*dto.LegalCaseDetail, error) {
	c, err := s.Get(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	block, err := s.computeCaseBlock(ctx, tenantID, c)
	if err != nil {
		return nil, err
	}
	return &dto.LegalCaseDetail{LegalCase: c, Computed: block}, nil
}

// ListWithSummary runs the case list and, in a SINGLE follow-up summary query,
// loads the per-case aggregates (earliest upcoming hearing + party count) for the
// returned page only (WS9). This kills the frontend N+1 (one hearings/parties
// fetch per row) without changing the underlying list query or its filters. The
// total count is the unaggregated list total so pagination is unaffected.
func (s *LegalCaseService) ListWithSummary(ctx context.Context, tenantID uuid.UUID, filters model.LegalCaseListFilters) ([]dto.LegalCaseListItem, int, error) {
	cases, total, err := s.cases.List(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, err
	}
	items := make([]dto.LegalCaseListItem, len(cases))
	for i := range cases {
		items[i] = dto.LegalCaseListItem{LegalCase: cases[i]}
	}
	if len(cases) == 0 {
		return items, total, nil
	}
	ids := make([]uuid.UUID, len(cases))
	index := make(map[uuid.UUID]int, len(cases))
	for i := range cases {
		ids[i] = cases[i].ID
		index[cases[i].ID] = i
	}
	summaries, err := s.caseListSummaries(ctx, tenantID, ids)
	if err != nil {
		return nil, 0, internalError("load case list summaries", err)
	}
	for caseID, summ := range summaries {
		if i, ok := index[caseID]; ok {
			items[i].NextHearingDate = summ.nextHearingDate
			items[i].SLATurnaroundDue = summ.slaTurnaroundDue
			items[i].PartyCount = summ.partyCount
		}
	}
	// Opt-in expand: hydrate parties[] / hearings[] on each returned row using the
	// SAME repository path Get uses (s.parties.ListByCase / s.hearings.ListByCase).
	// Only runs when the caller passed `expand=`; the default path above is
	// untouched (no extra queries, response byte-for-byte unchanged). This is a
	// per-case loop (one query per row per expanded collection): acceptable for the
	// demo tenant's page-sized result set — replace with a batch ListByCaseIDs if
	// the page sizes grow.
	if filters.ExpandParties || filters.ExpandHearings {
		for i := range items {
			if filters.ExpandParties {
				parties, err := s.parties.ListByCase(ctx, tenantID, items[i].ID)
				if err != nil {
					return nil, 0, internalError("load case parties", err)
				}
				items[i].Parties = parties
			}
			if filters.ExpandHearings {
				hearings, err := s.hearings.ListByCase(ctx, tenantID, items[i].ID)
				if err != nil {
					return nil, 0, internalError("load case hearings", err)
				}
				items[i].Hearings = hearings
			}
		}
	}
	return items, total, nil
}

// caseListSummary is the per-case aggregate row used by the list view (WS9).
type caseListSummary struct {
	nextHearingDate  *time.Time
	slaTurnaroundDue *time.Time
	partyCount       int
}

// caseListSummaries returns the earliest upcoming hearing and the live party
// count for each case id in one grouped query (WS9). Soft-deleted parties and
// hearings are excluded; only hearings at/after now count toward next_hearing_date.
// Cases with neither a party nor an upcoming hearing simply do not appear in the
// map (the caller defaults them to count 0 / nil date).
func (s *LegalCaseService) caseListSummaries(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]caseListSummary, error) {
	now := s.now().UTC()
	const query = `
		SELECT c.id,
		       h.next_hearing_date,
		       sla.turnaround_due_at,
		       COALESCE(p.party_count, 0) AS party_count
		FROM unnest($2::uuid[]) AS c(id)
		LEFT JOIN LATERAL (
			SELECT MIN(lch.hearing_date) AS next_hearing_date
			FROM legal_case_hearings lch
			WHERE lch.tenant_id = $1
			  AND lch.case_id = c.id
			  AND lch.deleted_at IS NULL
			  AND lch.hearing_date >= $3
		) h ON TRUE
		LEFT JOIN LATERAL (
			SELECT clock.turnaround_due_at
			FROM legal_sla_clocks clock
			WHERE clock.tenant_id = $1
			  AND clock.legal_request_id = COALESCE(
			      (SELECT lc.request_id FROM legal_cases lc WHERE lc.tenant_id = $1 AND lc.id = c.id),
			      c.id
			  )
			  AND clock.outcome = 'pending'
			ORDER BY clock.cycle DESC
			LIMIT 1
		) sla ON TRUE
		LEFT JOIN LATERAL (
			SELECT COUNT(*) AS party_count
			FROM legal_case_parties lcp
			WHERE lcp.tenant_id = $1
			  AND lcp.case_id = c.id
			  AND lcp.deleted_at IS NULL
		) p ON TRUE`
	rows, err := s.db.Query(ctx, query, tenantID, ids, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]caseListSummary, len(ids))
	for rows.Next() {
		var (
			caseID   uuid.UUID
			next     *time.Time
			due      *time.Time
			partyCnt int
		)
		if err := rows.Scan(&caseID, &next, &due, &partyCnt); err != nil {
			return nil, err
		}
		out[caseID] = caseListSummary{nextHearingDate: next, slaTurnaroundDue: due, partyCount: partyCnt}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// computeCaseBlock derives the WS9 case computed block. The hearing/task
// aggregates come from the already-hydrated case (no extra DB round-trip): Get
// has loaded c.Hearings and c.Tasks. The SLA facts (outcome, escalation level,
// resolved_at) are read in one query from the case's SLA clock, keyed on the same
// clock key the open-transition uses (COALESCE(request_id, case id)). A missing
// clock is normal (case never opened) and yields a nil outcome + level 0.
func (s *LegalCaseService) computeCaseBlock(ctx context.Context, tenantID uuid.UUID, c *model.LegalCase) (dto.CaseComputedBlock, error) {
	now := s.now().UTC()
	block := dto.CaseComputedBlock{
		NextHearingDate: earliestUpcomingHearing(c.Hearings, now),
		OpenTaskCount:   openTaskCount(c.Tasks),
	}

	clockKey := c.ID
	if c.RequestID != nil && *c.RequestID != uuid.Nil {
		clockKey = *c.RequestID
	}
	var (
		outcome        *string
		level          *int
		clockStartedAt *time.Time
		turnaroundDue  *time.Time
		resolvedAt     *time.Time
	)
	err := s.db.QueryRow(ctx, `
		SELECT outcome, escalation_level, clock_started_at, turnaround_due_at, resolved_at
		FROM legal_sla_clocks
		WHERE tenant_id = $1 AND legal_request_id = $2
		ORDER BY cycle DESC
		LIMIT 1`,
		tenantID, clockKey,
	).Scan(&outcome, &level, &clockStartedAt, &turnaroundDue, &resolvedAt)
	switch {
	case err == pgx.ErrNoRows:
		// No clock yet (case never opened): leave outcome nil / level 0.
	case err != nil:
		return dto.CaseComputedBlock{}, internalError("load case sla clock", err)
	default:
		block.SLAOutcome = outcome
		block.SLATurnaroundDue = turnaroundDue
		if level != nil {
			block.EscalationLevel = *level
		}
	}

	// days_open: measured from the SLA clock start (preferred) else the case
	// creation time, up to the clock's resolved_at when set, else now.
	start := clockStartedAt
	if start == nil && !c.CreatedAt.IsZero() {
		created := c.CreatedAt.UTC()
		start = &created
	}
	if start != nil {
		end := now
		if resolvedAt != nil {
			end = resolvedAt.UTC()
		}
		days := int(end.Sub(start.UTC()).Hours() / 24)
		if days < 0 {
			days = 0
		}
		block.DaysOpen = &days
	}
	return block, nil
}

// earliestUpcomingHearing returns the soonest hearing at/after now from an
// already-loaded hearing slice, or nil when none is upcoming.
func earliestUpcomingHearing(hearings []model.CaseHearing, now time.Time) *time.Time {
	var earliest *time.Time
	for i := range hearings {
		hd := hearings[i].HearingDate.UTC()
		if hd.Before(now) {
			continue
		}
		if earliest == nil || hd.Before(*earliest) {
			d := hd
			earliest = &d
		}
	}
	return earliest
}

// openTaskCount counts tasks not in a terminal state (done|cancelled) from an
// already-loaded task slice.
func openTaskCount(tasks []model.CaseTask) int {
	count := 0
	for i := range tasks {
		switch tasks[i].Status {
		case model.CaseTaskStatusDone, model.CaseTaskStatusCancelled:
			// terminal: not open.
		default:
			count++
		}
	}
	return count
}

// Update applies case-data field changes (CAP-042..050) with audit + version.
func (s *LegalCaseService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateLegalCaseRequest) (*model.LegalCase, error) {
	c, err := s.cases.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	previousRequestID := c.RequestID
	if req.Metadata != nil && beneficiaryEntityReferenceChanged(c.Metadata, req.Metadata) {
		if s.assignment == nil {
			return nil, internalError("case assignment validator is not configured", fmt.Errorf("missing case assignment validator"))
		}
		if err := s.assignment.validateBeneficiaryChange(
			ctx,
			tenantID,
			c.Metadata,
			req.Metadata,
			legalCaseAssignmentTargets(c),
		); err != nil {
			return nil, err
		}
	}
	if err := s.canonicalizeUpdateReferences(ctx, tenantID, c, &req); err != nil {
		return nil, err
	}
	applyLegalCaseUpdate(c, req)
	if err := validateLegalCase(c); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case update transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.cases.Update(ctx, tx, c); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("case_number already exists")
		}
		return nil, internalError("update legal case", err)
	}
	if !sameOptionalUUID(previousRequestID, c.RequestID) {
		if previousRequestID != nil {
			if _, err := tx.Exec(ctx, `
				UPDATE legal_requests
				SET subject_type = NULL, subject_id = NULL, updated_at = now()
				WHERE tenant_id = $1 AND id = $2
				  AND subject_type = 'legal_case' AND subject_id = $3`,
				tenantID, *previousRequestID, c.ID,
			); err != nil {
				return nil, internalError("unlink previous case request", err)
			}
		}
		if c.RequestID != nil {
			if err := linkLegalRequestToCase(ctx, tx, tenantID, *c.RequestID, c.ID); err != nil {
				return nil, err
			}
		}
	}
	if err := s.recordAudit(ctx, tx, c, userID, "case.updated", nil, nil, map[string]any{"case_number": c.CaseNumber}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case update", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.updated", tenantID, &userID, map[string]any{
		"id":     c.ID,
		"status": c.Status,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

// UpdateStatus drives the case FSM (CAP-051) with an OPTIMISTICALLY-GUARDED
// transition + append-only audit. holdCategory carries the classified delay cause
// (court|government|department|expert) and is REQUIRED — together with a non-empty
// reason — when the target is on_hold (WS3, CAP-088); it is ignored on any other
// target. The guarded UPDATE matches WHERE status = expectedFrom (the value read
// under FOR UPDATE) so a concurrent transition that already moved the row yields a
// 409 conflict rather than a lost update. On a transition to 'open' the SLA clock
// is started (WS3) and clock_started_at stamped; duration facts are recorded on
// open/under_procedure/close (C-2). CAP-085: an on_hold transition never forces a
// closure date.
func (s *LegalCaseService) UpdateStatus(ctx context.Context, tenantID, userID, id uuid.UUID, status model.CaseStatus, reason string, holdCategory *model.DelayCategory, rawLateJustification *string) (*model.LegalCase, error) {
	if !caseStatusKnown(status) {
		return nil, validationError("invalid case status", map[string]string{"status": "invalid"})
	}
	reason = strings.TrimSpace(reason)

	// WS3/CAP-088: entering on_hold requires a classified category + a reason.
	if status == caseStatusOnHold {
		if holdCategory == nil || !holdCategory.Valid() {
			return nil, validationError("a valid delay category is required to put a case on hold", map[string]string{"category": "invalid"})
		}
		if _, ok := caseDelayCategories[*holdCategory]; !ok {
			return nil, validationError("a valid delay category is required to put a case on hold", map[string]string{"category": "invalid"})
		}
		if reason == "" {
			return nil, validationError("a reason is required to put a case on hold", map[string]string{"reason": "required"})
		}
	}

	c, err := s.cases.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	if c.Status == status {
		return s.Get(ctx, tenantID, id)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case status transaction", err)
	}
	defer tx.Rollback(ctx)

	// Read + row-lock the authoritative current state inside the tx. The from-status
	// we guard on is this locked value (not the earlier unlocked Get), so the guard
	// is race-free.
	state, err := s.cases.LockState(ctx, tx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("lock legal case", err)
	}
	if state.Status == status {
		// Won the race to the same target: idempotent no-op.
		if err := tx.Commit(ctx); err != nil {
			return nil, internalError("commit case status", err)
		}
		return s.Get(ctx, tenantID, id)
	}
	if !caseTransitionAllowed(state.Status, status) {
		return nil, conflictError(fmt.Sprintf("illegal case transition %s -> %s", state.Status, status))
	}
	previous := string(state.Status)

	now := s.now().UTC()
	transition := repository.CaseStatusTransition{
		ExpectedFrom: state.Status,
		To:           status,
	}
	terminal := status == model.CaseStatusClosed || status == model.CaseStatusCancelled
	clockKey := c.ID
	if c.RequestID != nil && *c.RequestID != uuid.Nil {
		clockKey = *c.RequestID
	}
	if terminal {
		var turnaroundDueAt *time.Time
		err = tx.QueryRow(ctx, `
			SELECT turnaround_due_at
			FROM legal_sla_clocks
			WHERE tenant_id = $1 AND legal_request_id = $2 AND outcome = 'pending'
			ORDER BY cycle DESC
			LIMIT 1
			FOR SHARE`, tenantID, clockKey).Scan(&turnaroundDueAt)
		if err != nil && err != pgx.ErrNoRows {
			return nil, internalError("load active case SLA deadline", err)
		}
		lateJustification, validationErr := validateLateJustification(turnaroundDueAt, now, rawLateJustification)
		if validationErr != nil {
			return nil, validationErr
		}
		if lateJustification != nil {
			managerRole := legalCasesManagerRole
			transition.LateJustification = lateJustification
			transition.LateJustificationSubmittedBy = &userID
			transition.LateJustificationSubmittedAt = &now
			transition.LateJustificationManagerRole = &managerRole
			c.LateJustification = lateJustification
			c.LateJustificationSubmittedBy = &userID
			c.LateJustificationSubmittedAt = &now
			c.LateJustificationManagerRole = &managerRole
		}
	}
	if status == caseStatusOnHold {
		transition.HoldCategory = holdCategory
		transition.HoldReason = &reason
	}
	// WS3/C-2: stamp the SLA-clock-start instant the first time the case opens.
	if status == model.CaseStatusOpen && state.ClockStartedAt == nil {
		transition.ClockStartedAt = &now
	}

	if err := s.cases.UpdateStatusGuarded(ctx, tx, tenantID, id, transition); err != nil {
		if err == pgx.ErrNoRows {
			// The guard (status = expectedFrom) matched 0 rows: a concurrent writer
			// moved the case out from under us. 409 rather than a lost update.
			return nil, conflictError(fmt.Sprintf("legal case status changed concurrently; expected %s", previous))
		}
		return nil, internalError("update case status", err)
	}
	c.Status = status
	to := string(status)
	detail := map[string]any{"reason": reason}
	if terminal {
		detail["late_justification_recorded"] = transition.LateJustification != nil
	}
	if status == caseStatusOnHold {
		detail["hold_category"] = string(*holdCategory)
	}
	if transition.ClockStartedAt != nil {
		detail["clock_started_at"] = now
	}
	if dur := caseDurationFacts(c, state.ClockStartedAt, status, now); len(dur) > 0 {
		detail["duration"] = dur
	}
	if err := s.recordAudit(ctx, tx, c, userID, "case.status_changed", &previous, &to, detail); err != nil {
		return nil, err
	}
	if err := createAutomatedCaseTasks(ctx, tx, s.cases, s.tasks, tenantID, userID, id, statusChangeAutomationTasks(c, state.Status, status, now)); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case status", err)
	}

	// WS3: materialise the SLA clock once the case is open (best-effort, idempotent).
	if status == model.CaseStatusOpen {
		s.startCaseSLAClock(ctx, tenantID, userID, c, now)
	}
	if terminal && s.sla != nil {
		if _, resolveErr := s.sla.ResolveClockForRequest(ctx, tenantID, userID, clockKey, now); resolveErr != nil {
			s.logger.Warn().Err(resolveErr).Str("case_id", id.String()).Msg("case SLA clock resolution skipped")
		}
	}

	s.emitAudit(ctx, tenantID, userID, c, "case.status_changed", "warning",
		map[string]any{"status": previous},
		map[string]any{"status": to},
		detail,
	)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.status_changed", tenantID, &userID, map[string]any{
		"id":                id,
		"case_id":           id,
		"previous_status":   previous,
		"status":            status,
		"status_changed_at": now,
	}, s.logger)
	if status == model.CaseStatusClosed {
		writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.closed", tenantID, &userID, caseClosedEventPayload(c, now), s.logger)
	}
	return s.Get(ctx, tenantID, id)
}

// SetStrength records the litigation-strength assessment (CAP-034).
func (s *LegalCaseService) SetStrength(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.SetCaseStrengthRequest) (*model.LegalCase, error) {
	if !req.Strength.Valid() {
		return nil, validationError("invalid case strength", map[string]string{"strength": "invalid"})
	}
	return s.mutateAndAudit(ctx, tenantID, userID, id, "case.strength_set",
		func(ctx context.Context, tx pgx.Tx) error {
			return s.cases.UpdateStrength(ctx, tx, tenantID, id, req.Strength)
		},
		map[string]any{"strength": req.Strength, "reason": strings.TrimSpace(req.Reason)},
		"strength", req.Strength,
		"com.clario360.lex.case.strength_set",
		map[string]any{"id": id, "strength": req.Strength},
	)
}

// SetRiskRating records the graded litigation-risk rating (Othaim PRD 8.2). The
// band is either supplied explicitly or derived from a likelihood × impact matrix
// (each factor on the 1–5 scale); an explicit rating always wins over a
// derivation. The mutation, its governance audit row and version snapshot commit
// atomically through mutateAndAudit.
func (s *LegalCaseService) SetRiskRating(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.SetCaseRiskRatingRequest) (*model.LegalCase, error) {
	// Likelihood and impact are optional matrix inputs but must be supplied
	// together, each on the 1–5 scale.
	if (req.Likelihood == nil) != (req.Impact == nil) {
		return nil, validationError("likelihood and impact must be provided together",
			map[string]string{"likelihood": "paired", "impact": "paired"})
	}
	if req.Likelihood != nil {
		if !validCaseRiskFactor(*req.Likelihood) || !validCaseRiskFactor(*req.Impact) {
			return nil, validationError("likelihood and impact must be between 1 and 5",
				map[string]string{"likelihood": "range", "impact": "range"})
		}
	}
	// Resolve the graded band: an explicit rating wins; otherwise derive it from
	// the matrix. At least one of the two paths must be present.
	var rating model.RiskLevel
	switch {
	case req.Rating != nil:
		rating = *req.Rating
		if !model.CaseRiskRatingValid(rating) {
			return nil, validationError("invalid risk rating", map[string]string{"rating": "invalid"})
		}
	case req.Likelihood != nil:
		rating = model.DeriveCaseRiskRating(*req.Likelihood, *req.Impact)
	default:
		return nil, validationError("a rating, or both likelihood and impact, are required",
			map[string]string{"rating": "required"})
	}
	if req.ExposureValue != nil && *req.ExposureValue < 0 {
		return nil, validationError("exposure value must not be negative",
			map[string]string{"exposure_value": "invalid"})
	}
	exposureCurrency := normalizeExposureCurrency(req.ExposureCurrency)
	rationale := trimmedStringPtr(&req.Reason)
	return s.mutateAndAudit(ctx, tenantID, userID, id, "case.risk_rating_set",
		func(ctx context.Context, tx pgx.Tx) error {
			return s.cases.UpdateRiskRating(ctx, tx, tenantID, id, rating,
				req.Likelihood, req.Impact, req.ExposureValue, exposureCurrency, rationale, userID)
		},
		map[string]any{
			"risk_rating":       rating,
			"likelihood":        req.Likelihood,
			"impact":            req.Impact,
			"exposure_value":    req.ExposureValue,
			"exposure_currency": exposureCurrency,
			"reason":            strings.TrimSpace(req.Reason),
		},
		"risk_rating", rating,
		"com.clario360.lex.case.risk_rating_set",
		map[string]any{"id": id, "risk_rating": rating},
	)
}

// validCaseRiskFactor reports whether a likelihood/impact factor is on the 1–5
// scale used by the case risk matrix (Othaim PRD 8.2).
func validCaseRiskFactor(v int) bool { return v >= 1 && v <= 5 }

// normalizeExposureCurrency trims + upper-cases an optional currency code,
// returning nil when the input is nil or blank.
func normalizeExposureCurrency(code *string) *string {
	if code == nil {
		return nil
	}
	trimmed := strings.ToUpper(strings.TrimSpace(*code))
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// trimmedStringPtr trims an optional string, returning nil when nil or blank.
func trimmedStringPtr(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// SetPriority sets the case priority (CAP-041).
func (s *LegalCaseService) SetPriority(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.SetCasePriorityRequest) (*model.LegalCase, error) {
	if _, ok := allowedLegalPriorities[req.Priority]; !ok {
		return nil, validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	return s.mutateAndAudit(ctx, tenantID, userID, id, "case.priority_set",
		func(ctx context.Context, tx pgx.Tx) error {
			return s.cases.UpdatePriority(ctx, tx, tenantID, id, req.Priority)
		},
		map[string]any{"priority": req.Priority, "reason": strings.TrimSpace(req.Reason)},
		"priority", req.Priority,
		"com.clario360.lex.case.priority_set",
		map[string]any{"id": id, "priority": req.Priority},
	)
}

// TransferToSectionManager reassigns the owning section manager (CAP-037).
func (s *LegalCaseService) TransferToSectionManager(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.TransferToSectionManagerRequest) (*model.LegalCase, error) {
	if req.SectionManagerID == uuid.Nil {
		return nil, validationError("section_manager_id is required", map[string]string{"section_manager_id": "required"})
	}
	if err := s.validateCaseAssignment(ctx, tenantID, id, []caseAssignmentTarget{{field: "section_manager_id", userID: req.SectionManagerID}}); err != nil {
		return nil, err
	}
	return s.mutateAndAudit(ctx, tenantID, userID, id, "case.transferred_to_section_manager",
		func(ctx context.Context, tx pgx.Tx) error {
			return s.cases.UpdateAssignment(ctx, tx, tenantID, id, "section_manager_id", req.SectionManagerID)
		},
		map[string]any{"section_manager_id": req.SectionManagerID.String(), "reason": strings.TrimSpace(req.Reason)},
		"section_manager_id", req.SectionManagerID.String(),
		"com.clario360.lex.case.transferred_to_section_manager",
		map[string]any{"id": id, "section_manager_id": req.SectionManagerID},
	)
}

// AssignSupervisor assigns the case supervisor (CAP-038).
func (s *LegalCaseService) AssignSupervisor(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.AssignSupervisorRequest) (*model.LegalCase, error) {
	if req.SupervisorID == uuid.Nil {
		return nil, validationError("supervisor_id is required", map[string]string{"supervisor_id": "required"})
	}
	if err := s.validateCaseAssignment(ctx, tenantID, id, []caseAssignmentTarget{{field: "supervisor_id", userID: req.SupervisorID}}); err != nil {
		return nil, err
	}
	return s.mutateAndAudit(ctx, tenantID, userID, id, "case.supervisor_assigned",
		func(ctx context.Context, tx pgx.Tx) error {
			return s.cases.UpdateAssignment(ctx, tx, tenantID, id, "supervisor_id", req.SupervisorID)
		},
		map[string]any{"supervisor_id": req.SupervisorID.String(), "reason": strings.TrimSpace(req.Reason)},
		"supervisor_id", req.SupervisorID.String(),
		"com.clario360.lex.case.supervisor_assigned",
		map[string]any{"id": id, "supervisor_id": req.SupervisorID},
	)
}

// AssignOfficer assigns the handling officer (CAP-039).
func (s *LegalCaseService) AssignOfficer(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.AssignOfficerRequest) (*model.LegalCase, error) {
	if req.HandlingOfficerID == uuid.Nil {
		return nil, validationError("handling_officer_id is required", map[string]string{"handling_officer_id": "required"})
	}
	if err := s.validateCaseAssignment(ctx, tenantID, id, []caseAssignmentTarget{{field: "handling_officer_id", userID: req.HandlingOfficerID}}); err != nil {
		return nil, err
	}
	return s.mutateAndAudit(ctx, tenantID, userID, id, "case.officer_assigned",
		func(ctx context.Context, tx pgx.Tx) error {
			return s.cases.UpdateAssignment(ctx, tx, tenantID, id, "handling_officer_id", req.HandlingOfficerID)
		},
		map[string]any{"handling_officer_id": req.HandlingOfficerID.String(), "reason": strings.TrimSpace(req.Reason)},
		"handling_officer_id", req.HandlingOfficerID.String(),
		"com.clario360.lex.case.officer_assigned",
		map[string]any{"id": id, "handling_officer_id": req.HandlingOfficerID},
	)
}

func (s *LegalCaseService) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	if err := s.cases.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("legal case not found")
		}
		return internalError("delete legal case", err)
	}
	return nil
}

// --- governance audit & version ---------------------------------------------

// ListAudit returns the append-only governance audit trail (CAP-051).
func (s *LegalCaseService) ListAudit(ctx context.Context, tenantID, id uuid.UUID) ([]model.LegalCaseAuditEntry, error) {
	if _, err := s.cases.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	entries, err := s.cases.ListAudit(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load case audit", err)
	}
	return entries, nil
}

// ListVersions returns the immutable version history (CAP-051).
func (s *LegalCaseService) ListVersions(ctx context.Context, tenantID, id uuid.UUID) ([]model.LegalCaseVersion, error) {
	if _, err := s.cases.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	versions, err := s.cases.ListVersions(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load case versions", err)
	}
	return versions, nil
}

// --- parties ----------------------------------------------------------------

func (s *LegalCaseService) AddParty(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.CreateCasePartyRequest) (*model.CaseParty, error) {
	req.Normalize()
	if req.Name == "" {
		return nil, validationError("name is required", map[string]string{"name": "required"})
	}
	if !req.Role.Valid() {
		return nil, validationError("invalid party role", map[string]string{"role": "invalid"})
	}
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	p := &model.CaseParty{
		ID:         uuid.New(),
		TenantID:   tenantID,
		CaseID:     caseID,
		Role:       req.Role,
		Name:       req.Name,
		Identifier: req.Identifier,
		Contact:    req.Contact,
		Metadata:   req.Metadata,
		CreatedBy:  userID,
	}
	after := casePartySnapshot(p)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, p.ID, "party", "created", nil, after, func(ctx context.Context, tx pgx.Tx) error {
		return s.parties.Create(ctx, tx, p)
	}); err != nil {
		return nil, internalError("create case party", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.party_added", tenantID, &userID, map[string]any{
		"id": caseID, "party_id": p.ID, "role": p.Role,
	}, s.logger)
	return p, nil
}

// BulkAddParties creates several parties on a case in one request (WS9). Each
// item is validated and persisted via the same single-create path (AddParty), so
// audit rows, version snapshots and events are emitted identically. The batch is
// NOT atomic across items: the case is checked once up front, then each party is
// created on its own transaction. The first failing item aborts and returns its
// error along with the parties already created (so the caller can see partial
// progress). An empty list is a validation error.
func (s *LegalCaseService) BulkAddParties(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.BulkCreateCasePartiesRequest) ([]model.CaseParty, error) {
	if len(req.Parties) == 0 {
		return nil, validationError("parties must not be empty", map[string]string{"parties": "required"})
	}
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	created := make([]model.CaseParty, 0, len(req.Parties))
	for i := range req.Parties {
		p, err := s.AddParty(ctx, tenantID, userID, caseID, req.Parties[i])
		if err != nil {
			return created, err
		}
		created = append(created, *p)
	}
	return created, nil
}

func (s *LegalCaseService) UpdateParty(ctx context.Context, tenantID, userID, caseID, partyID uuid.UUID, req dto.UpdateCasePartyRequest) (*model.CaseParty, error) {
	p, err := s.parties.Get(ctx, tenantID, caseID, partyID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case party not found")
		}
		return nil, internalError("load case party", err)
	}
	beforeSnap := casePartySnapshot(p)
	if req.Role != nil {
		if !req.Role.Valid() {
			return nil, validationError("invalid party role", map[string]string{"role": "invalid"})
		}
		p.Role = *req.Role
	}
	if req.Name != nil {
		p.Name = strings.TrimSpace(*req.Name)
	}
	if req.Identifier != nil {
		p.Identifier = normalizeOptionalString(req.Identifier)
	}
	if req.Contact != nil {
		p.Contact = normalizeOptionalString(req.Contact)
	}
	if req.Metadata != nil {
		p.Metadata = req.Metadata
	}
	if p.Name == "" {
		return nil, validationError("name is required", map[string]string{"name": "required"})
	}
	afterSnap := casePartySnapshot(p)
	before, after := diffSnapshots(beforeSnap, afterSnap)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, p.ID, "party", "updated", before, after, func(ctx context.Context, tx pgx.Tx) error {
		return s.parties.Update(ctx, tx, p)
	}); err != nil {
		return nil, internalError("update case party", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.party_updated", tenantID, &userID, map[string]any{
		"id": caseID, "party_id": p.ID,
	}, s.logger)
	return p, nil
}

// DeleteParty soft-deletes a party with an append-only sub-resource audit row that
// captures the deleted-party before-state (WS4). userID is the actor.
func (s *LegalCaseService) DeleteParty(ctx context.Context, tenantID, userID, caseID, partyID uuid.UUID) error {
	p, err := s.parties.Get(ctx, tenantID, caseID, partyID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case party not found")
		}
		return internalError("load case party", err)
	}
	before := casePartySnapshot(p)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, partyID, "party", "deleted", before, nil, func(ctx context.Context, tx pgx.Tx) error {
		return s.parties.SoftDeleteTx(ctx, tx, tenantID, caseID, partyID)
	}); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case party not found")
		}
		return internalError("delete case party", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.party_removed", tenantID, &userID, map[string]any{
		"id": caseID, "party_id": partyID,
	}, s.logger)
	return nil
}

// --- hearings ---------------------------------------------------------------

func (s *LegalCaseService) AddHearing(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.CreateCaseHearingRequest) (*model.CaseHearing, error) {
	req.Normalize()
	if req.HearingDate.IsZero() {
		return nil, validationError("hearing_date is required", map[string]string{"hearing_date": "required"})
	}
	c, err := s.cases.Get(ctx, tenantID, caseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	h := &model.CaseHearing{
		ID:          uuid.New(),
		TenantID:    tenantID,
		CaseID:      caseID,
		HearingDate: req.HearingDate.UTC(),
		Location:    req.Location,
		Notes:       req.Notes,
		Decision:    req.Decision,
		Metadata:    req.Metadata,
		CreatedBy:   userID,
	}
	after := caseHearingSnapshot(h)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, h.ID, "hearing", "created", nil, after, func(ctx context.Context, tx pgx.Tx) error {
		if err := s.hearings.Create(ctx, tx, h); err != nil {
			return err
		}
		return createAutomatedCaseTasks(ctx, tx, s.cases, s.tasks, tenantID, userID, caseID, hearingAddedAutomationTasks(c, h, s.now().UTC()))
	}); err != nil {
		return nil, internalError("create case hearing", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.hearing_added", tenantID, &userID, map[string]any{
		"id": caseID, "hearing_id": h.ID, "hearing_date": h.HearingDate,
	}, s.logger)
	return h, nil
}

func (s *LegalCaseService) UpdateHearing(ctx context.Context, tenantID, userID, caseID, hearingID uuid.UUID, req dto.UpdateCaseHearingRequest) (*model.CaseHearing, error) {
	h, err := s.hearings.Get(ctx, tenantID, caseID, hearingID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case hearing not found")
		}
		return nil, internalError("load case hearing", err)
	}
	beforeSnap := caseHearingSnapshot(h)
	if req.HearingDate != nil {
		h.HearingDate = req.HearingDate.UTC()
	}
	if req.Location != nil {
		h.Location = normalizeOptionalString(req.Location)
	}
	if req.Notes != nil {
		h.Notes = strings.TrimSpace(*req.Notes)
	}
	if req.Decision != nil {
		h.Decision = normalizeOptionalString(req.Decision)
	}
	if req.Metadata != nil {
		h.Metadata = req.Metadata
	}
	afterSnap := caseHearingSnapshot(h)
	before, after := diffSnapshots(beforeSnap, afterSnap)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, h.ID, "hearing", "updated", before, after, func(ctx context.Context, tx pgx.Tx) error {
		return s.hearings.Update(ctx, tx, h)
	}); err != nil {
		return nil, internalError("update case hearing", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.hearing_updated", tenantID, &userID, map[string]any{
		"id": caseID, "hearing_id": h.ID,
	}, s.logger)
	return h, nil
}

// DeleteHearing soft-deletes a hearing with an append-only sub-resource audit row
// capturing the deleted-hearing before-state (WS4). userID is the actor.
func (s *LegalCaseService) DeleteHearing(ctx context.Context, tenantID, userID, caseID, hearingID uuid.UUID) error {
	h, err := s.hearings.Get(ctx, tenantID, caseID, hearingID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case hearing not found")
		}
		return internalError("load case hearing", err)
	}
	before := caseHearingSnapshot(h)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, hearingID, "hearing", "deleted", before, nil, func(ctx context.Context, tx pgx.Tx) error {
		return s.hearings.SoftDeleteTx(ctx, tx, tenantID, caseID, hearingID)
	}); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case hearing not found")
		}
		return internalError("delete case hearing", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.hearing_removed", tenantID, &userID, map[string]any{
		"id": caseID, "hearing_id": hearingID,
	}, s.logger)
	return nil
}

// --- tasks (CAP-040) --------------------------------------------------------

func (s *LegalCaseService) DefineTask(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.CreateCaseTaskRequest) (*model.CaseTask, error) {
	req.Normalize()
	if req.Title == "" {
		return nil, validationError("title is required", map[string]string{"title": "required"})
	}
	if _, ok := allowedLegalPriorities[req.Priority]; !ok {
		return nil, validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	if !req.Status.Valid() {
		return nil, validationError("invalid task status", map[string]string{"status": "invalid"})
	}
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	t := &model.CaseTask{
		ID:         uuid.New(),
		TenantID:   tenantID,
		CaseID:     caseID,
		Title:      req.Title,
		AssigneeID: req.AssigneeID,
		Priority:   req.Priority,
		Status:     req.Status,
		DueDate:    req.DueDate,
		Metadata:   req.Metadata,
		CreatedBy:  userID,
	}
	after := caseTaskSnapshot(t)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, t.ID, "task", "created", nil, after, func(ctx context.Context, tx pgx.Tx) error {
		return s.tasks.Create(ctx, tx, t)
	}); err != nil {
		return nil, internalError("create case task", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.task_defined", tenantID, &userID, map[string]any{
		"id": caseID, "task_id": t.ID, "priority": t.Priority, "status": t.Status,
	}, s.logger)
	return t, nil
}

// BulkDefineTasks defines several tasks on a case in one request (WS9). Each item
// is validated and persisted via the same single-create path (DefineTask), so
// audit rows, version snapshots and events are emitted identically. The batch is
// NOT atomic across items: the case is checked once up front, then each task is
// created on its own transaction. The first failing item aborts and returns its
// error along with the tasks already created. An empty list is a validation error.
func (s *LegalCaseService) BulkDefineTasks(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.BulkCreateCaseTasksRequest) ([]model.CaseTask, error) {
	if len(req.Tasks) == 0 {
		return nil, validationError("tasks must not be empty", map[string]string{"tasks": "required"})
	}
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	created := make([]model.CaseTask, 0, len(req.Tasks))
	for i := range req.Tasks {
		t, err := s.DefineTask(ctx, tenantID, userID, caseID, req.Tasks[i])
		if err != nil {
			return created, err
		}
		created = append(created, *t)
	}
	return created, nil
}

func (s *LegalCaseService) UpdateTask(ctx context.Context, tenantID, userID, caseID, taskID uuid.UUID, req dto.UpdateCaseTaskRequest) (*model.CaseTask, error) {
	t, err := s.tasks.Get(ctx, tenantID, caseID, taskID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case task not found")
		}
		return nil, internalError("load case task", err)
	}
	beforeSnap := caseTaskSnapshot(t)
	if req.Title != nil {
		t.Title = strings.TrimSpace(*req.Title)
	}
	if req.AssigneeID != nil {
		t.AssigneeID = req.AssigneeID
	}
	if req.Priority != nil {
		if _, ok := allowedLegalPriorities[*req.Priority]; !ok {
			return nil, validationError("invalid priority", map[string]string{"priority": "invalid"})
		}
		t.Priority = *req.Priority
	}
	if req.Status != nil {
		if !req.Status.Valid() {
			return nil, validationError("invalid task status", map[string]string{"status": "invalid"})
		}
		t.Status = *req.Status
	}
	if req.DueDate != nil {
		t.DueDate = req.DueDate
	}
	if req.Metadata != nil {
		t.Metadata = req.Metadata
	}
	if t.Title == "" {
		return nil, validationError("title is required", map[string]string{"title": "required"})
	}
	afterSnap := caseTaskSnapshot(t)
	before, after := diffSnapshots(beforeSnap, afterSnap)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, t.ID, "task", "updated", before, after, func(ctx context.Context, tx pgx.Tx) error {
		return s.tasks.Update(ctx, tx, t)
	}); err != nil {
		return nil, internalError("update case task", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.task_updated", tenantID, &userID, map[string]any{
		"id": caseID, "task_id": t.ID,
	}, s.logger)
	return t, nil
}

// DeleteTask soft-deletes a task with an append-only sub-resource audit row
// capturing the deleted-task before-state (WS4). userID is the actor.
func (s *LegalCaseService) DeleteTask(ctx context.Context, tenantID, userID, caseID, taskID uuid.UUID) error {
	t, err := s.tasks.Get(ctx, tenantID, caseID, taskID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case task not found")
		}
		return internalError("load case task", err)
	}
	before := caseTaskSnapshot(t)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, taskID, "task", "deleted", before, nil, func(ctx context.Context, tx pgx.Tx) error {
		return s.tasks.SoftDeleteTx(ctx, tx, tenantID, caseID, taskID)
	}); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case task not found")
		}
		return internalError("delete case task", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.task_removed", tenantID, &userID, map[string]any{
		"id": caseID, "task_id": taskID,
	}, s.logger)
	return nil
}

// --- persisted timeline milestones -----------------------------------------

func (s *LegalCaseService) ListMilestones(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.CaseMilestone, error) {
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	items, err := s.cases.ListMilestones(ctx, tenantID, caseID)
	if err != nil {
		return nil, internalError("list case milestones", err)
	}
	return items, nil
}

func (s *LegalCaseService) AddMilestone(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.CreateCaseMilestoneRequest) (*model.CaseMilestone, error) {
	req.Normalize()
	if req.Status == model.CaseMilestoneStatusCompleted && req.CompletedAt == nil {
		now := s.now().UTC()
		req.CompletedAt = &now
	}
	if err := validateCaseMilestone(req.Title, req.MilestoneType, req.Status, req.MilestoneDate, req.CompletedAt); err != nil {
		return nil, err
	}
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	milestone := &model.CaseMilestone{
		ID:              uuid.New(),
		TenantID:        tenantID,
		CaseID:          caseID,
		Title:           req.Title,
		Description:     req.Description,
		MilestoneType:   req.MilestoneType,
		Status:          req.Status,
		MilestoneDate:   req.MilestoneDate.UTC(),
		CompletedAt:     req.CompletedAt,
		OwnerID:         req.OwnerID,
		Source:          req.Source,
		SourceReference: req.SourceReference,
		Metadata:        req.Metadata,
		CreatedBy:       userID,
		UpdatedBy:       &userID,
	}
	after := caseMilestoneSnapshot(milestone)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, milestone.ID, "milestone", "created", nil, after, func(ctx context.Context, tx pgx.Tx) error {
		return s.cases.CreateMilestone(ctx, tx, milestone)
	}); err != nil {
		return nil, internalError("create case milestone", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.milestone_created", tenantID, &userID, map[string]any{
		"id": caseID, "case_id": caseID, "milestone_id": milestone.ID, "status": milestone.Status,
	}, s.logger)
	return milestone, nil
}

func (s *LegalCaseService) UpdateMilestone(ctx context.Context, tenantID, userID, caseID, milestoneID uuid.UUID, req dto.UpdateCaseMilestoneRequest) (*model.CaseMilestone, error) {
	milestone, err := s.cases.GetMilestone(ctx, tenantID, caseID, milestoneID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case milestone not found")
		}
		return nil, internalError("load case milestone", err)
	}
	beforeSnap := caseMilestoneSnapshot(milestone)
	if req.Title != nil {
		milestone.Title = strings.TrimSpace(*req.Title)
	}
	if req.Description != nil {
		milestone.Description = strings.TrimSpace(*req.Description)
	}
	if req.MilestoneType != nil {
		milestone.MilestoneType = model.CaseMilestoneType(strings.ToLower(strings.TrimSpace(string(*req.MilestoneType))))
	}
	if req.Status != nil {
		milestone.Status = model.CaseMilestoneStatus(strings.ToLower(strings.TrimSpace(string(*req.Status))))
	}
	if req.MilestoneDate != nil {
		milestone.MilestoneDate = req.MilestoneDate.UTC()
	}
	if req.CompletedAt != nil {
		milestone.CompletedAt = req.CompletedAt
	}
	if req.OwnerID != nil {
		milestone.OwnerID = req.OwnerID
	}
	if req.Source != nil {
		milestone.Source = strings.TrimSpace(*req.Source)
	}
	if req.SourceReference != nil {
		milestone.SourceReference = normalizeOptionalString(req.SourceReference)
	}
	if req.Metadata != nil {
		milestone.Metadata = req.Metadata
	}
	if milestone.Status == model.CaseMilestoneStatusCompleted && milestone.CompletedAt == nil {
		now := s.now().UTC()
		milestone.CompletedAt = &now
	}
	if milestone.Status != model.CaseMilestoneStatusCompleted {
		milestone.CompletedAt = nil
	}
	if milestone.Source == "" {
		milestone.Source = "manual"
	}
	if err := validateCaseMilestone(milestone.Title, milestone.MilestoneType, milestone.Status, milestone.MilestoneDate, milestone.CompletedAt); err != nil {
		return nil, err
	}
	milestone.UpdatedBy = &userID
	afterSnap := caseMilestoneSnapshot(milestone)
	before, after := diffSnapshots(beforeSnap, afterSnap)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, milestoneID, "milestone", "updated", before, after, func(ctx context.Context, tx pgx.Tx) error {
		return s.cases.UpdateMilestone(ctx, tx, milestone)
	}); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case milestone not found")
		}
		return nil, internalError("update case milestone", err)
	}
	return s.cases.GetMilestone(ctx, tenantID, caseID, milestoneID)
}

func (s *LegalCaseService) DeleteMilestone(ctx context.Context, tenantID, userID, caseID, milestoneID uuid.UUID) error {
	milestone, err := s.cases.GetMilestone(ctx, tenantID, caseID, milestoneID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case milestone not found")
		}
		return internalError("load case milestone", err)
	}
	before := caseMilestoneSnapshot(milestone)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, milestoneID, "milestone", "deleted", before, nil, func(ctx context.Context, tx pgx.Tx) error {
		return s.cases.SoftDeleteMilestone(ctx, tx, tenantID, caseID, milestoneID, userID)
	}); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case milestone not found")
		}
		return internalError("delete case milestone", err)
	}
	return nil
}

func validateCaseMilestone(title string, milestoneType model.CaseMilestoneType, status model.CaseMilestoneStatus, milestoneDate time.Time, completedAt *time.Time) error {
	fields := map[string]string{}
	if strings.TrimSpace(title) == "" {
		fields["title"] = "required"
	}
	if !milestoneType.Valid() {
		fields["milestone_type"] = "invalid"
	}
	if !status.Valid() {
		fields["status"] = "invalid"
	}
	if milestoneDate.IsZero() {
		fields["milestone_date"] = "required"
	}
	if status == model.CaseMilestoneStatusCompleted && completedAt == nil {
		fields["completed_at"] = "required_when_completed"
	}
	if len(fields) != 0 {
		return validationError("invalid case milestone", fields)
	}
	return nil
}

// --- collaboration comments -------------------------------------------------

func (s *LegalCaseService) ListComments(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.CaseComment, error) {
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	items, err := s.comments.ListByCase(ctx, tenantID, caseID)
	if err != nil {
		return nil, internalError("list case comments", err)
	}
	return items, nil
}

func (s *LegalCaseService) AddComment(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.CreateCaseCommentRequest) (*model.CaseComment, error) {
	req.Normalize()
	if req.Body == "" {
		return nil, validationError("comment body is required", map[string]string{"body": "required"})
	}
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	comment := &model.CaseComment{
		ID:        uuid.New(),
		TenantID:  tenantID,
		CaseID:    caseID,
		Body:      req.Body,
		Mentions:  req.Mentions,
		Metadata:  req.Metadata,
		CreatedBy: userID,
	}
	after := caseCommentSnapshot(comment)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, comment.ID, "comment", "created", nil, after, func(ctx context.Context, tx pgx.Tx) error {
		return s.comments.Create(ctx, tx, comment)
	}); err != nil {
		return nil, internalError("create case comment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.comment_added", tenantID, &userID, map[string]any{
		"id": caseID, "case_id": caseID, "comment_id": comment.ID, "mentions": comment.Mentions,
	}, s.logger)
	return comment, nil
}

func (s *LegalCaseService) UpdateComment(ctx context.Context, tenantID, userID, caseID, commentID uuid.UUID, req dto.UpdateCaseCommentRequest) (*model.CaseComment, error) {
	req.Normalize()
	comment, err := s.comments.Get(ctx, tenantID, caseID, commentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case comment not found")
		}
		return nil, internalError("load case comment", err)
	}
	beforeSnap := caseCommentSnapshot(comment)
	if req.Body != nil {
		comment.Body = *req.Body
	}
	if req.Mentions != nil {
		comment.Mentions = req.Mentions
	}
	if req.Metadata != nil {
		comment.Metadata = req.Metadata
	}
	if comment.Body == "" {
		return nil, validationError("comment body is required", map[string]string{"body": "required"})
	}
	comment.UpdatedBy = &userID
	afterSnap := caseCommentSnapshot(comment)
	before, after := diffSnapshots(beforeSnap, afterSnap)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, comment.ID, "comment", "updated", before, after, func(ctx context.Context, tx pgx.Tx) error {
		return s.comments.Update(ctx, tx, comment)
	}); err != nil {
		return nil, internalError("update case comment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.comment_updated", tenantID, &userID, map[string]any{
		"id": caseID, "case_id": caseID, "comment_id": comment.ID,
	}, s.logger)
	return comment, nil
}

func (s *LegalCaseService) DeleteComment(ctx context.Context, tenantID, userID, caseID, commentID uuid.UUID) error {
	comment, err := s.comments.Get(ctx, tenantID, caseID, commentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case comment not found")
		}
		return internalError("load case comment", err)
	}
	before := caseCommentSnapshot(comment)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, commentID, "comment", "deleted", before, nil, func(ctx context.Context, tx pgx.Tx) error {
		return s.comments.SoftDeleteTx(ctx, tx, tenantID, caseID, commentID)
	}); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case comment not found")
		}
		return internalError("delete case comment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.comment_deleted", tenantID, &userID, map[string]any{
		"id": caseID, "case_id": caseID, "comment_id": commentID,
	}, s.logger)
	return nil
}

// --- document registry links ------------------------------------------------

func (s *LegalCaseService) ListDocuments(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.CaseDocumentLink, error) {
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	items, err := s.caseDocs.ListByCase(ctx, tenantID, caseID)
	if err != nil {
		return nil, internalError("list case documents", err)
	}
	return items, nil
}

func (s *LegalCaseService) AddDocument(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.CreateCaseDocumentLinkRequest) (*model.CaseDocumentLink, error) {
	req.Normalize()
	if !req.EvidenceStatus.Valid() {
		return nil, validationError("invalid evidence status", map[string]string{"evidence_status": "invalid"})
	}
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}

	documentID := uuid.Nil
	if req.DocumentID != nil {
		if _, err := s.documents.Get(ctx, tenantID, *req.DocumentID); err != nil {
			if err == pgx.ErrNoRows {
				return nil, validationError("linked document not found", map[string]string{"document_id": "not_found"})
			}
			return nil, internalError("load linked document", err)
		}
		documentID = *req.DocumentID
	} else if strings.TrimSpace(req.Title) == "" {
		return nil, validationError("title is required when document_id is omitted", map[string]string{"title": "required"})
	} else if !req.Type.Valid() {
		return nil, validationError("invalid document type", map[string]string{"type": "invalid"})
	} else if !req.Confidentiality.Valid() {
		return nil, validationError("invalid document confidentiality", map[string]string{"confidentiality": "invalid"})
	}

	source := req.Source
	if source == "" {
		source = "linked"
		if req.DocumentID == nil {
			source = "metadata"
			if req.Document != nil {
				source = "uploaded_reference"
			}
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case document transaction", err)
	}
	defer tx.Rollback(ctx)

	if req.DocumentID == nil {
		document := &model.LegalDocument{
			ID:              uuid.New(),
			TenantID:        tenantID,
			Title:           req.Title,
			Type:            req.Type,
			Description:     req.Description,
			Category:        req.Category,
			Confidentiality: req.Confidentiality,
			CurrentVersion:  1,
			Status:          model.DocumentStatusActive,
			Tags:            req.Tags,
			Metadata:        req.DocumentMetadata,
			CreatedBy:       userID,
		}
		if err := s.documents.Create(ctx, tx, document); err != nil {
			return nil, internalError("create case document metadata", err)
		}
		if req.Document != nil {
			version := &model.DocumentVersion{
				ID:            uuid.New(),
				TenantID:      tenantID,
				DocumentID:    document.ID,
				Version:       1,
				FileID:        req.Document.FileID,
				FileName:      req.Document.FileName,
				FileSizeBytes: req.Document.FileSizeBytes,
				ContentHash:   req.Document.ContentHash,
				ChangeSummary: normalizeOptionalString(&req.Document.ChangeSummary),
				UploadedBy:    userID,
			}
			if err := s.documents.InsertVersion(ctx, tx, version); err != nil {
				return nil, internalError("create case document version", err)
			}
			if err := s.documents.UpdateFile(ctx, tx, tenantID, document.ID, req.Document.FileID, req.Document.FileName, req.Document.FileSizeBytes, 1); err != nil {
				return nil, internalError("update case document file reference", err)
			}
		}
		documentID = document.ID
	}

	link := &model.CaseDocumentLink{
		ID:             uuid.New(),
		TenantID:       tenantID,
		CaseID:         caseID,
		DocumentID:     documentID,
		Source:         source,
		Category:       req.Category,
		Notes:          req.Notes,
		EvidenceStatus: req.EvidenceStatus,
		CourtReference: req.CourtReference,
		SubmittedBy:    req.SubmittedBy,
		SubmittedAt:    req.SubmittedAt,
		Metadata:       req.Metadata,
		CreatedBy:      userID,
		UpdatedBy:      &userID,
	}
	if link.EvidenceStatus != model.EvidenceStatusPending {
		if link.SubmittedBy == nil {
			link.SubmittedBy = &userID
		}
		if link.SubmittedAt == nil {
			now := s.now().UTC()
			link.SubmittedAt = &now
		}
	}
	if err := s.caseDocs.Create(ctx, tx, link); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("document is already linked to this case")
		}
		return nil, internalError("link case document", err)
	}
	entry := &repository.LegalCaseSubAuditEntry{
		ID:           uuid.New(),
		TenantID:     tenantID,
		CaseID:       caseID,
		ResourceType: "document_link",
		ResourceID:   link.ID,
		Action:       "created",
		AfterState:   caseDocumentLinkSnapshot(link),
		ActorUserID:  userID,
	}
	if err := s.cases.AppendSubAudit(ctx, tx, entry); err != nil {
		return nil, internalError("append case document audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case document transaction", err)
	}
	s.emitSubAudit(ctx, tenantID, userID, caseID, link.ID, "document_link", "created", "info", nil, caseDocumentLinkSnapshot(link))
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.document_linked", tenantID, &userID, map[string]any{
		"id": caseID, "case_id": caseID, "case_document_id": link.ID, "document_id": documentID, "source": source,
	}, s.logger)
	return s.caseDocs.Get(ctx, tenantID, caseID, link.ID)
}

func (s *LegalCaseService) UpdateDocument(ctx context.Context, tenantID, userID, caseID, linkID uuid.UUID, req dto.UpdateCaseDocumentLinkRequest) (*model.CaseDocumentLink, error) {
	link, err := s.caseDocs.Get(ctx, tenantID, caseID, linkID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case document link not found")
		}
		return nil, internalError("load case document link", err)
	}
	beforeSnap := caseDocumentLinkSnapshot(link)
	if req.Category != nil {
		link.Category = normalizeOptionalString(req.Category)
	}
	if req.Notes != nil {
		link.Notes = strings.TrimSpace(*req.Notes)
	}
	if req.EvidenceStatus != nil {
		status := model.EvidenceStatus(strings.ToLower(strings.TrimSpace(string(*req.EvidenceStatus))))
		if !status.Valid() {
			return nil, validationError("invalid evidence status", map[string]string{"evidence_status": "invalid"})
		}
		link.EvidenceStatus = status
	}
	if req.CourtReference != nil {
		link.CourtReference = normalizeOptionalString(req.CourtReference)
	}
	if req.SubmittedBy != nil {
		link.SubmittedBy = req.SubmittedBy
	}
	if req.SubmittedAt != nil {
		link.SubmittedAt = req.SubmittedAt
	}
	if req.Metadata != nil {
		link.Metadata = req.Metadata
	}
	if link.EvidenceStatus != model.EvidenceStatusPending {
		if link.SubmittedBy == nil {
			link.SubmittedBy = &userID
		}
		if link.SubmittedAt == nil {
			now := s.now().UTC()
			link.SubmittedAt = &now
		}
	}
	link.UpdatedBy = &userID
	afterSnap := caseDocumentLinkSnapshot(link)
	before, after := diffSnapshots(beforeSnap, afterSnap)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, linkID, "document_link", "updated", before, after, func(ctx context.Context, tx pgx.Tx) error {
		return s.caseDocs.Update(ctx, tx, link)
	}); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("case document link not found")
		}
		return nil, internalError("update case document link", err)
	}
	return s.caseDocs.Get(ctx, tenantID, caseID, linkID)
}

func (s *LegalCaseService) DeleteDocument(ctx context.Context, tenantID, userID, caseID, linkID uuid.UUID) error {
	link, err := s.caseDocs.Get(ctx, tenantID, caseID, linkID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case document link not found")
		}
		return internalError("load case document link", err)
	}
	before := caseDocumentLinkSnapshot(link)
	if err := s.subResourceTx(ctx, tenantID, userID, caseID, linkID, "document_link", "deleted", before, nil, func(ctx context.Context, tx pgx.Tx) error {
		return s.caseDocs.SoftDeleteTx(ctx, tx, tenantID, caseID, linkID)
	}); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("case document link not found")
		}
		return internalError("delete case document link", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.document_unlinked", tenantID, &userID, map[string]any{
		"id": caseID, "case_id": caseID, "case_document_id": linkID, "document_id": link.DocumentID,
	}, s.logger)
	return nil
}

// --- internals --------------------------------------------------------------

func (s *LegalCaseService) validateCaseAssignment(ctx context.Context, tenantID, caseID uuid.UUID, targets []caseAssignmentTarget) error {
	if s.assignment == nil {
		return internalError("case assignment validator is not configured", fmt.Errorf("missing case assignment validator"))
	}
	c, err := s.cases.Get(ctx, tenantID, caseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("legal case not found")
		}
		return internalError("load legal case for assignment", err)
	}
	return s.assignment.validateTargets(ctx, tenantID, c.Metadata, targets)
}

func legalCaseAssignmentTargets(c *model.LegalCase) []caseAssignmentTarget {
	if c == nil {
		return nil
	}
	targets := make([]caseAssignmentTarget, 0, 3)
	if c.SectionManagerID != nil && *c.SectionManagerID != uuid.Nil {
		targets = append(targets, caseAssignmentTarget{field: "section_manager_id", userID: *c.SectionManagerID})
	}
	if c.SupervisorID != nil && *c.SupervisorID != uuid.Nil {
		targets = append(targets, caseAssignmentTarget{field: "supervisor_id", userID: *c.SupervisorID})
	}
	if c.HandlingOfficerID != nil && *c.HandlingOfficerID != uuid.Nil {
		targets = append(targets, caseAssignmentTarget{field: "handling_officer_id", userID: *c.HandlingOfficerID})
	}
	return targets
}

// mutateAndAudit runs a single-column case mutation, then appends the governance
// audit row + version snapshot in the same transaction, then emits the event.
func (s *LegalCaseService) mutateAndAudit(
	ctx context.Context,
	tenantID, userID, id uuid.UUID,
	action string,
	mutate func(ctx context.Context, tx pgx.Tx) error,
	detail map[string]any,
	field string,
	newValue any,
	eventType string,
	eventPayload map[string]any,
) (*model.LegalCase, error) {
	c, err := s.cases.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	// Field-level before/after diff (WS4): the old value is lifted from the loaded
	// case snapshot, the new value is the mutation's target.
	var before, after map[string]any
	if field != "" {
		before = map[string]any{field: legalCaseSnapshot(c)[field]}
		after = map[string]any{field: newValue}
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case mutation transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := mutate(ctx, tx); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("apply case mutation", err)
	}
	auditDetail := map[string]any{}
	for k, v := range detail {
		auditDetail[k] = v
	}
	if len(before) > 0 {
		auditDetail["before"] = before
	}
	if len(after) > 0 {
		auditDetail["after"] = after
	}
	if err := s.recordAudit(ctx, tx, c, userID, action, nil, nil, auditDetail); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case mutation", err)
	}
	s.emitAudit(ctx, tenantID, userID, c, action, "info", before, after, detail)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, eventType, tenantID, &userID, eventPayload, s.logger)
	return s.Get(ctx, tenantID, id)
}

// emitAudit routes one structured record to the immutable audit_db ledger (WS4).
// It is best-effort and never fails the operation (the emitter swallows publish
// errors). before/after carry the changed-field diff; detail carries the action's
// context (reason, hold category, ...). severity defaults to info when blank.
func (s *LegalCaseService) emitAudit(ctx context.Context, tenantID, userID uuid.UUID, c *model.LegalCase, action, severity string, before, after, detail map[string]any) {
	if s.audit == nil {
		return
	}
	actor := userID
	s.audit.Emit(ctx, LexAuditRecord{
		TenantID:     tenantID,
		ActorUserID:  &actor,
		Action:       action,
		ResourceType: "legal_case",
		ResourceID:   c.ID.String(),
		Severity:     severity,
		OldValue:     before,
		NewValue:     after,
		Detail:       detail,
	})
}

// emitSubAudit routes one sub-resource (party/hearing/task) change to the
// immutable audit_db ledger (WS4). Best-effort, never fails the operation.
func (s *LegalCaseService) emitSubAudit(ctx context.Context, tenantID, userID, caseID, resourceID uuid.UUID, resourceType, action, severity string, before, after map[string]any) {
	if s.audit == nil {
		return
	}
	actor := userID
	s.audit.Emit(ctx, LexAuditRecord{
		TenantID:     tenantID,
		ActorUserID:  &actor,
		Action:       "case." + resourceType + "." + action,
		ResourceType: "legal_case_" + resourceType,
		ResourceID:   resourceID.String(),
		Severity:     severity,
		OldValue:     before,
		NewValue:     after,
		Detail:       map[string]any{"case_id": caseID.String()},
	})
}

// startCaseSLAClock materialises the case's SLA clock on open (WS3). The clock keys
// on the case's RequestID back-link when present (so a case spawned from a request
// shares the request's SLA spine), else on the case ID. BeneficiaryEntityID is the
// owning org entity (read from case metadata "beneficiary_entity_id"), so the
// escalation ladder resolves. All failures are non-fatal: a missing SLA target /
// calendar logs and continues — clock_started_at was already stamped in the tx.
func (s *LegalCaseService) startCaseSLAClock(ctx context.Context, tenantID, userID uuid.UUID, c *model.LegalCase, startedAt time.Time) {
	if s.sla == nil {
		return
	}
	clockKey := c.ID
	if c.RequestID != nil && *c.RequestID != uuid.Nil {
		clockKey = *c.RequestID
	}
	serviceCode := caseSLAServiceCode
	if c.Metadata != nil {
		if sc, ok := c.Metadata["service_code"].(string); ok && strings.TrimSpace(sc) != "" {
			serviceCode = strings.TrimSpace(sc)
		}
	}
	metadata := map[string]any{
		"case_id":     c.ID.String(),
		"case_number": c.CaseNumber,
		"source":      "lex_legal_case_open",
	}
	if c.SectionManagerID != nil && *c.SectionManagerID != uuid.Nil {
		metadata["assignee_user_id"] = c.SectionManagerID.String()
	} else if c.HandlingOfficerID != nil && *c.HandlingOfficerID != uuid.Nil {
		metadata["assignee_user_id"] = c.HandlingOfficerID.String()
	}
	started := startedAt.UTC()
	req := dto.StartSLAClockRequest{
		LegalRequestID:      clockKey,
		ServiceCode:         serviceCode,
		Priority:            caseSLAPriority(c.Priority),
		BeneficiaryEntityID: caseBeneficiaryEntityID(c),
		StartedAt:           &started,
		Metadata:            metadata,
	}
	if _, err := s.sla.StartClock(ctx, tenantID, userID, req); err != nil {
		s.logger.Warn().Err(err).Str("case_id", c.ID.String()).Msg("case sla clock auto-start skipped")
	}
}

// recordAudit appends the immutable governance audit row AND a version snapshot
// for the case (CAP-051), inside the caller's transaction.
func (s *LegalCaseService) recordAudit(ctx context.Context, tx pgx.Tx, c *model.LegalCase, userID uuid.UUID, action string, fromStatus, toStatus *string, detail map[string]any) error {
	entry := &model.LegalCaseAuditEntry{
		ID:          uuid.New(),
		TenantID:    c.TenantID,
		CaseID:      c.ID,
		Action:      action,
		FromStatus:  fromStatus,
		ToStatus:    toStatus,
		Detail:      detail,
		ActorUserID: userID,
	}
	if err := s.cases.AppendAudit(ctx, tx, entry); err != nil {
		return internalError("append case audit", err)
	}
	createdBy := userID
	version := &model.LegalCaseVersion{
		ID:           uuid.New(),
		TenantID:     c.TenantID,
		CaseID:       c.ID,
		Snapshot:     legalCaseSnapshot(c),
		ChangeReason: action,
		CreatedBy:    &createdBy,
	}
	if err := s.cases.AppendVersion(ctx, tx, version); err != nil {
		return internalError("append case version", err)
	}
	return nil
}

func (s *LegalCaseService) ensureCaseExists(ctx context.Context, tenantID, caseID uuid.UUID) error {
	if _, err := s.cases.Get(ctx, tenantID, caseID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("legal case not found")
		}
		return internalError("load legal case", err)
	}
	return nil
}

// subResourceTx runs a party/hearing/task create/update/delete inside a single
// transaction, appends the immutable sub-resource audit row with the before/after
// diff (WS4), commits, then routes the change to the audit_db ledger. before/after
// are the field-level diff (nil for the unchanged side of a create/delete).
func (s *LegalCaseService) subResourceTx(
	ctx context.Context,
	tenantID, userID, caseID, resourceID uuid.UUID,
	resourceType, action string,
	before, after map[string]any,
	mutate func(ctx context.Context, tx pgx.Tx) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start case sub-resource transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := mutate(ctx, tx); err != nil {
		return err
	}
	entry := &repository.LegalCaseSubAuditEntry{
		ID:           uuid.New(),
		TenantID:     tenantID,
		CaseID:       caseID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Action:       action,
		BeforeState:  before,
		AfterState:   after,
		ActorUserID:  userID,
	}
	if err := s.cases.AppendSubAudit(ctx, tx, entry); err != nil {
		return internalError("append case sub-resource audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit case sub-resource mutation", err)
	}
	severity := "info"
	if action == "deleted" {
		severity = "warning"
	}
	s.emitSubAudit(ctx, tenantID, userID, caseID, resourceID, resourceType, action, severity, before, after)
	return nil
}

// diffSnapshots returns only the keys that changed between two snapshots, as a
// (before, after) pair of maps (WS4). Equality is by fmt.Sprint so nested values
// and pointers compare by their rendered form. Both maps are nil when nothing
// changed.
func diffSnapshots(before, after map[string]any) (map[string]any, map[string]any) {
	changedBefore := map[string]any{}
	changedAfter := map[string]any{}
	for k, av := range after {
		bv, ok := before[k]
		if !ok || fmt.Sprint(bv) != fmt.Sprint(av) {
			changedBefore[k] = before[k]
			changedAfter[k] = av
		}
	}
	for k, bv := range before {
		if _, ok := after[k]; !ok {
			changedBefore[k] = bv
			changedAfter[k] = nil
		}
	}
	if len(changedAfter) == 0 {
		return nil, nil
	}
	return changedBefore, changedAfter
}

func casePartySnapshot(p *model.CaseParty) map[string]any {
	return map[string]any{
		"id":         p.ID.String(),
		"role":       string(p.Role),
		"name":       p.Name,
		"identifier": ptrStringOrEmpty(p.Identifier),
		"contact":    ptrStringOrEmpty(p.Contact),
	}
}

func caseHearingSnapshot(h *model.CaseHearing) map[string]any {
	return map[string]any{
		"id":           h.ID.String(),
		"hearing_date": h.HearingDate.UTC().Format(time.RFC3339),
		"location":     ptrStringOrEmpty(h.Location),
		"notes":        h.Notes,
		"decision":     ptrStringOrEmpty(h.Decision),
	}
}

func caseTaskSnapshot(t *model.CaseTask) map[string]any {
	snap := map[string]any{
		"id":       t.ID.String(),
		"title":    t.Title,
		"priority": string(t.Priority),
		"status":   string(t.Status),
	}
	if t.AssigneeID != nil {
		snap["assignee_id"] = t.AssigneeID.String()
	} else {
		snap["assignee_id"] = ""
	}
	if t.DueDate != nil {
		snap["due_date"] = t.DueDate.UTC().Format(time.RFC3339)
	} else {
		snap["due_date"] = ""
	}
	return snap
}

func caseMilestoneSnapshot(m *model.CaseMilestone) map[string]any {
	snapshot := map[string]any{
		"id":               m.ID.String(),
		"title":            m.Title,
		"description":      m.Description,
		"milestone_type":   string(m.MilestoneType),
		"status":           string(m.Status),
		"milestone_date":   m.MilestoneDate.UTC().Format(time.RFC3339),
		"source":           m.Source,
		"source_reference": ptrStringOrEmpty(m.SourceReference),
	}
	if m.CompletedAt != nil {
		snapshot["completed_at"] = m.CompletedAt.UTC().Format(time.RFC3339)
	}
	if m.OwnerID != nil {
		snapshot["owner_id"] = m.OwnerID.String()
	}
	return snapshot
}

func caseCommentSnapshot(c *model.CaseComment) map[string]any {
	mentions := make([]string, len(c.Mentions))
	copy(mentions, c.Mentions)
	snap := map[string]any{
		"id":       c.ID.String(),
		"body":     c.Body,
		"mentions": mentions,
	}
	if c.UpdatedBy != nil {
		snap["updated_by"] = c.UpdatedBy.String()
	}
	return snap
}

func caseDocumentLinkSnapshot(link *model.CaseDocumentLink) map[string]any {
	snapshot := map[string]any{
		"id":              link.ID.String(),
		"document_id":     link.DocumentID.String(),
		"source":          link.Source,
		"category":        ptrStringOrEmpty(link.Category),
		"notes":           link.Notes,
		"evidence_status": string(link.EvidenceStatus),
		"court_reference": ptrStringOrEmpty(link.CourtReference),
	}
	if link.SubmittedBy != nil {
		snapshot["submitted_by"] = link.SubmittedBy.String()
	}
	if link.SubmittedAt != nil {
		snapshot["submitted_at"] = link.SubmittedAt.UTC().Format(time.RFC3339)
	}
	return snapshot
}

func legalCaseSnapshot(c *model.LegalCase) map[string]any {
	return map[string]any{
		"id":                       c.ID.String(),
		"case_number":              c.CaseNumber,
		"court_number":             c.CourtNumber,
		"case_type":                c.CaseType,
		"other_case_type":          c.OtherCaseType,
		"classification_id":        c.ClassificationID,
		"court_id":                 c.CourtID,
		"contract_id":              c.ContractID,
		"company_status":           c.CompanyStatus,
		"competent_court":          c.CompetentCourt,
		"chamber":                  c.Chamber,
		"filing_date":              c.FilingDate,
		"title":                    c.Title,
		"description":              c.Description,
		"strength":                 c.Strength,
		"claim_amount":             c.ClaimAmount,
		"court_fees":               c.CourtFees,
		"legal_fees":               c.LegalFees,
		"currency":                 c.Currency,
		"expected_resolution_date": c.ExpectedResolution,
		"risk_rating":              c.RiskRating,
		"risk_likelihood":          c.RiskLikelihood,
		"risk_impact":              c.RiskImpact,
		"risk_exposure_value":      c.RiskExposureValue,
		"status":                   c.Status,
		"priority":                 c.Priority,
		"section_manager_id":       c.SectionManagerID,
		"supervisor_id":            c.SupervisorID,
		"handling_officer_id":      c.HandlingOfficerID,
		"responsible_lawyer":       c.ResponsibleLawyer,
		"department":               c.Department,
		"request_id":               c.RequestID,
	}
}

func caseClosedEventPayload(c *model.LegalCase, closedAt time.Time) map[string]any {
	return map[string]any{
		"id":             c.ID,
		"case_id":        c.ID,
		"case_number":    c.CaseNumber,
		"case_type":      c.CaseType,
		"department":     c.Department,
		"request_id":     c.RequestID,
		"created_at":     c.CreatedAt,
		"started_at":     c.CreatedAt,
		"closed_at":      closedAt,
		"completed_at":   closedAt,
		"company_status": c.CompanyStatus,
		"status":         model.CaseStatusClosed,
	}
}

func caseTransitionAllowed(from, to model.CaseStatus) bool {
	targets, ok := caseStatusTransitions[from]
	if !ok {
		return false
	}
	_, ok = targets[to]
	return ok
}

// caseStatusKnown reports whether status is a known FSM state, including the
// on_hold state this unit adds (model.CaseStatus.Valid predates on_hold and is
// owned outside this unit, so the check is broadened here).
func caseStatusKnown(status model.CaseStatus) bool {
	if status == caseStatusOnHold {
		return true
	}
	return status.Valid()
}

// caseSLAPriority maps the case priority onto the two-tier SLA priority. critical
// or high map to urgent; everything else to normal so a target can still resolve.
func caseSLAPriority(p model.LegalPriority) model.SLATargetPriority {
	switch p {
	case model.LegalPriorityCritical, model.LegalPriorityHigh:
		return model.SLATargetPriorityUrgent
	default:
		return model.SLATargetPriorityNormal
	}
}

// caseBeneficiaryEntityID resolves the owning org entity for the SLA escalation
// ladder (WS3). The case has no hard org FK, so the entity is read from case
// metadata "beneficiary_entity_id" (stamped at intake/creation). Returns nil when
// absent/invalid: the clock still materialises, escalation falls back gracefully.
func caseBeneficiaryEntityID(c *model.LegalCase) *uuid.UUID {
	if c.Metadata == nil {
		return nil
	}
	raw, ok := c.Metadata["beneficiary_entity_id"].(string)
	if !ok {
		return nil
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil {
		return nil
	}
	return &id
}

// caseDurationFacts records the elapsed-time facts on the operational transitions
// (C-2): on open it captures the intake→open lead time; on under_procedure /
// closed it captures elapsed-since-open and elapsed-since-creation. Times are
// computed against the SLA clock start (preferred, set on open) falling back to
// the case creation time. Returns an empty map for non-fact-bearing transitions.
func caseDurationFacts(c *model.LegalCase, clockStartedAt *time.Time, status model.CaseStatus, now time.Time) map[string]any {
	facts := map[string]any{}
	switch status {
	case model.CaseStatusOpen:
		if !c.CreatedAt.IsZero() {
			facts["seconds_intake_to_open"] = int64(now.Sub(c.CreatedAt.UTC()).Seconds())
		}
	case model.CaseStatusUnderProcedure, model.CaseStatusClosed:
		if clockStartedAt != nil && !clockStartedAt.IsZero() {
			facts["seconds_since_open"] = int64(now.Sub(clockStartedAt.UTC()).Seconds())
		}
		if !c.CreatedAt.IsZero() {
			facts["seconds_since_created"] = int64(now.Sub(c.CreatedAt.UTC()).Seconds())
		}
	}
	if len(facts) == 0 {
		return nil
	}
	return facts
}

func validateLegalCaseCreate(req dto.CreateLegalCaseRequest) error {
	if req.CaseType == "" {
		return validationError("case_type is required", map[string]string{"case_type": "required"})
	}
	if req.Title.IsEmpty() {
		return validationError("title is required", map[string]string{"title": "required"})
	}
	if _, ok := allowedCaseCompanyStatuses[req.CompanyStatus]; !ok {
		return validationError("invalid company_status", map[string]string{"company_status": "invalid"})
	}
	if !req.Status.Valid() {
		return validationError("invalid case status", map[string]string{"status": "invalid"})
	}
	if _, ok := allowedLegalPriorities[req.Priority]; !ok {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	if req.Strength != nil && !req.Strength.Valid() {
		return validationError("invalid case strength", map[string]string{"strength": "invalid"})
	}
	if err := validateCaseFinancials(req.ClaimAmount, req.CourtFees, req.LegalFees, req.Currency); err != nil {
		return err
	}
	return nil
}

func linkLegalRequestToCase(ctx context.Context, tx pgx.Tx, tenantID, requestID, caseID uuid.UUID) error {
	result, err := tx.Exec(ctx, `
		UPDATE legal_requests
		SET subject_type = 'legal_case', subject_id = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		  AND subject_type IS NULL AND subject_id IS NULL`,
		tenantID, requestID, caseID,
	)
	if err != nil {
		return internalError("link legal request to case", err)
	}
	if result.RowsAffected() != 1 {
		return conflictError("the legal request is already linked to another legal work item")
	}
	return nil
}

func sameOptionalUUID(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func (s *LegalCaseService) canonicalizeCreateReferences(ctx context.Context, tenantID uuid.UUID, req *dto.CreateLegalCaseRequest, expectedCaseID *uuid.UUID) error {
	if req.ContractID != nil && req.RequestID != nil {
		return validationError("contract_id and request_id are mutually exclusive", map[string]string{
			"contract_id": "mutually_exclusive",
			"request_id":  "mutually_exclusive",
		})
	}
	if req.ContractID != nil {
		if *req.ContractID == uuid.Nil {
			return validationError("contract_id is invalid", map[string]string{"contract_id": "invalid"})
		}
		if s.contracts == nil {
			return internalError("contract reference repository is not configured", fmt.Errorf("missing contract repository"))
		}
		if _, err := s.contracts.Get(ctx, tenantID, *req.ContractID); err != nil {
			if err == pgx.ErrNoRows {
				return validationError("contract_id must reference an active contract in this tenant", map[string]string{"contract_id": "not_found"})
			}
			return internalError("validate case contract reference", err)
		}
	}
	if req.RequestID != nil {
		if *req.RequestID == uuid.Nil {
			return validationError("request_id is invalid", map[string]string{"request_id": "invalid"})
		}
		if s.requests == nil {
			return internalError("request reference repository is not configured", fmt.Errorf("missing legal request repository"))
		}
		request, err := s.requests.Get(ctx, tenantID, *req.RequestID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return validationError("request_id must reference an active request in this tenant", map[string]string{"request_id": "not_found"})
			}
			return internalError("validate case request reference", err)
		}
		linkedToExpectedCase := expectedCaseID != nil && request.SubjectID != nil && *request.SubjectID == *expectedCaseID && request.SubjectType != nil && *request.SubjectType == "legal_case"
		if (request.SubjectID != nil || request.SubjectType != nil) && !linkedToExpectedCase {
			return conflictError("the legal request is already linked to another legal work item")
		}
	}
	if req.CourtID != nil {
		if *req.CourtID == uuid.Nil {
			return validationError("court_id is invalid", map[string]string{"court_id": "invalid"})
		}
		if s.courts == nil {
			return internalError("court reference repository is not configured", fmt.Errorf("missing legal court repository"))
		}
		court, err := s.courts.Get(ctx, tenantID, *req.CourtID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return validationError("court_id must reference an active court in this tenant", map[string]string{"court_id": "not_found"})
			}
			return internalError("validate case court reference", err)
		}
		if !court.Active {
			return validationError("court_id must reference an active court", map[string]string{"court_id": "inactive"})
		}
	}
	if req.ClassificationID != nil {
		if *req.ClassificationID == uuid.Nil {
			return validationError("classification_id is invalid", map[string]string{"classification_id": "invalid"})
		}
		if s.classes == nil {
			return internalError("case classification repository is not configured", fmt.Errorf("missing case classification repository"))
		}
		classification, err := s.classes.Get(ctx, tenantID, *req.ClassificationID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return validationError("classification_id must reference an active selectable case type", map[string]string{"classification_id": "not_found"})
			}
			return internalError("validate case classification", err)
		}
		if !classification.Active || classification.ParentID != nil {
			return validationError("classification_id must reference an active root case type", map[string]string{"classification_id": "not_selectable"})
		}
		req.CaseType = classification.Code
	}
	return validateAndCanonicalizeOtherCaseType(&req.CaseType, &req.OtherCaseType, req.ClassificationID)
}

func (s *LegalCaseService) canonicalizeUpdateReferences(ctx context.Context, tenantID uuid.UUID, current *model.LegalCase, req *dto.UpdateLegalCaseRequest) error {
	if req.ContractID != nil && req.RequestID != nil {
		return validationError("contract_id and request_id are mutually exclusive", map[string]string{"contract_id": "mutually_exclusive", "request_id": "mutually_exclusive"})
	}
	shape := dto.CreateLegalCaseRequest{
		CaseType: current.CaseType, OtherCaseType: current.OtherCaseType,
		ClassificationID: current.ClassificationID, CourtID: current.CourtID,
		ContractID: current.ContractID, RequestID: current.RequestID,
	}
	if req.CaseType != nil {
		shape.CaseType = *req.CaseType
	}
	if req.OtherCaseType != nil {
		shape.OtherCaseType = req.OtherCaseType
	}
	if req.ShouldClear("other_case_type") {
		shape.OtherCaseType = nil
	}
	if req.ClassificationID != nil {
		shape.ClassificationID = req.ClassificationID
	}
	if req.CourtID != nil {
		shape.CourtID = req.CourtID
	}
	if req.ShouldClear("court_id") {
		shape.CourtID = nil
	}
	if req.ContractID != nil {
		shape.ContractID, shape.RequestID = req.ContractID, nil
	}
	if req.RequestID != nil {
		shape.RequestID, shape.ContractID = req.RequestID, nil
	}
	if req.ShouldClear("contract_id") {
		shape.ContractID = nil
	}
	if req.ShouldClear("request_id") {
		shape.RequestID = nil
	}
	if req.ShouldClear("classification_id") {
		shape.ClassificationID = nil
	}
	if strings.EqualFold(strings.TrimSpace(shape.CaseType), "OTHER") {
		shape.ClassificationID = nil
	}
	if err := s.canonicalizeCreateReferences(ctx, tenantID, &shape, &current.ID); err != nil {
		return err
	}
	caseType := shape.CaseType
	req.CaseType, req.OtherCaseType = &caseType, shape.OtherCaseType
	req.ClassificationID, req.CourtID = shape.ClassificationID, shape.CourtID
	req.ContractID, req.RequestID = shape.ContractID, shape.RequestID
	return nil
}

func validateAndCanonicalizeOtherCaseType(caseType *string, other **string, classificationID *uuid.UUID) error {
	value := strings.TrimSpace(*caseType)
	if strings.EqualFold(value, "OTHER") {
		*caseType = "OTHER"
		if classificationID != nil {
			return validationError("Other cannot also select a classification", map[string]string{"classification_id": "mutually_exclusive"})
		}
		if *other == nil || strings.TrimSpace(**other) == "" {
			return validationError("other_case_type is required when case_type is OTHER", map[string]string{"other_case_type": "required"})
		}
		trimmed := strings.TrimSpace(**other)
		if len([]rune(trimmed)) > 255 {
			return validationError("other_case_type is too long", map[string]string{"other_case_type": "max_255"})
		}
		*other = &trimmed
		return nil
	}
	*caseType = value
	if *other != nil {
		return validationError("other_case_type is only valid when case_type is OTHER", map[string]string{"other_case_type": "not_allowed"})
	}
	return nil
}

func validateLegalCase(c *model.LegalCase) error {
	caseType := c.CaseType
	otherCaseType := c.OtherCaseType
	if err := validateAndCanonicalizeOtherCaseType(&caseType, &otherCaseType, c.ClassificationID); err != nil {
		return err
	}
	c.CaseType = caseType
	c.OtherCaseType = otherCaseType
	if c.ContractID != nil && c.RequestID != nil {
		return validationError("contract_id and request_id are mutually exclusive", map[string]string{"contract_id": "mutually_exclusive", "request_id": "mutually_exclusive"})
	}
	if strings.TrimSpace(c.CaseType) == "" {
		return validationError("case_type is required", map[string]string{"case_type": "required"})
	}
	if c.Title.IsEmpty() {
		return validationError("title is required", map[string]string{"title": "required"})
	}
	if _, ok := allowedCaseCompanyStatuses[c.CompanyStatus]; !ok {
		return validationError("invalid company_status", map[string]string{"company_status": "invalid"})
	}
	if !c.Status.Valid() {
		return validationError("invalid case status", map[string]string{"status": "invalid"})
	}
	if _, ok := allowedLegalPriorities[c.Priority]; !ok {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	if c.Strength != nil && !c.Strength.Valid() {
		return validationError("invalid case strength", map[string]string{"strength": "invalid"})
	}
	if err := validateCaseFinancials(c.ClaimAmount, c.CourtFees, c.LegalFees, c.Currency); err != nil {
		return err
	}
	return nil
}

func validateCaseFinancials(claimAmount, courtFees, legalFees *float64, currency *string) error {
	for field, value := range map[string]*float64{
		"claim_amount": claimAmount,
		"court_fees":   courtFees,
		"legal_fees":   legalFees,
	} {
		if value != nil && *value < 0 {
			return validationError(field+" must not be negative", map[string]string{field: "must_not_be_negative"})
		}
	}
	if currency != nil {
		value := strings.ToUpper(strings.TrimSpace(*currency))
		if len(value) != 3 {
			return validationError("currency must be a 3-letter ISO code", map[string]string{"currency": "invalid"})
		}
	}
	return nil
}

func applyLegalCaseUpdate(c *model.LegalCase, req dto.UpdateLegalCaseRequest) {
	if req.ShouldClear("other_case_type") {
		c.OtherCaseType = nil
	}
	if req.ShouldClear("classification_id") {
		c.ClassificationID = nil
	}
	if req.ShouldClear("court_id") {
		c.CourtID = nil
	}
	if req.ShouldClear("contract_id") {
		c.ContractID = nil
	}
	if req.ShouldClear("request_id") {
		c.RequestID = nil
	}
	if req.CaseNumber != nil {
		c.CaseNumber = strings.TrimSpace(*req.CaseNumber)
	}
	if req.CourtNumber != nil {
		c.CourtNumber = normalizeOptionalString(req.CourtNumber)
	}
	if req.CaseType != nil {
		c.CaseType = strings.TrimSpace(*req.CaseType)
	}
	if req.OtherCaseType != nil || !strings.EqualFold(c.CaseType, "OTHER") {
		c.OtherCaseType = normalizeOptionalString(req.OtherCaseType)
	}
	if req.ClassificationID != nil {
		c.ClassificationID = req.ClassificationID
	} else if strings.EqualFold(c.CaseType, "OTHER") {
		c.ClassificationID = nil
	}
	if req.CourtID != nil {
		c.CourtID = req.CourtID
	}
	if req.ContractID != nil {
		c.ContractID = req.ContractID
		c.RequestID = nil
	}
	if req.RequestID != nil {
		c.RequestID = req.RequestID
		c.ContractID = nil
	}
	if req.CompanyStatus != nil {
		c.CompanyStatus = *req.CompanyStatus
	}
	if req.CompetentCourt != nil {
		c.CompetentCourt = normalizeOptionalString(req.CompetentCourt)
	}
	if req.Chamber != nil {
		c.Chamber = normalizeOptionalString(req.Chamber)
	}
	if req.FilingDate != nil {
		c.FilingDate = req.FilingDate
	}
	if req.Title != nil {
		c.Title = *req.Title
	}
	if req.Description != nil {
		c.Description = strings.TrimSpace(*req.Description)
	}
	if req.Strength != nil {
		c.Strength = req.Strength
	}
	if req.ClaimAmount != nil {
		c.ClaimAmount = req.ClaimAmount
	}
	if req.CourtFees != nil {
		c.CourtFees = req.CourtFees
	}
	if req.LegalFees != nil {
		c.LegalFees = req.LegalFees
	}
	if req.Currency != nil {
		value := strings.ToUpper(strings.TrimSpace(*req.Currency))
		c.Currency = &value
	}
	if req.ExpectedResolution != nil {
		c.ExpectedResolution = req.ExpectedResolution
	}
	// responsible_lawyer is a legacy display field and is intentionally not
	// mutable through the generic edit endpoint. Work allocation must use the
	// restricted, audited assignment endpoints with an IAM user id.
	if req.Department != nil {
		c.Department = normalizeOptionalString(req.Department)
	}
	// Status is intentionally NOT applied here: case status transitions run through
	// the guarded FSM (the /status endpoint) with automation + audit. It is accepted
	// in UpdateLegalCaseRequest only so the edit form's full payload clears the strict
	// unknown-field decoder — the plain edit never moves the case through the FSM.
	if req.Priority != nil {
		c.Priority = *req.Priority
	}
	if req.Metadata != nil {
		c.Metadata = req.Metadata
	}
}
