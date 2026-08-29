package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/drafting"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

const defendantResponseWorkflowName = "Lex Defendant Response Memo Review"
const defendantResponseStepID = "defendant_response_review"

// LitigationDefendantService owns the defendant-side flows (CAP-067..073): registering
// an incoming lawsuit + notification date, recording the Najiz (ناجز) company
// representative (manual; real API deferred CAP-069/175), uploading the served
// statement of claim, notifying the concerned department, drafting the first-response
// memo (مذكرة الرد الأولى) via the AID engine, and the two-tier
// supervisor→section_manager review of that memo via the shared sequential
// ApprovalOrchestrator chain. Every mutation emits a CloudEvent.
type LitigationDefendantService struct {
	db           *pgxpool.Pool
	defendants   *repository.LegalDefendantRepository
	cases        *repository.LegalCaseRepository
	tasks        *repository.CaseTaskRepository
	drafter      *drafting.Drafter
	orchestrator *ApprovalOrchestrator
	defRepo      *workflowrepo.DefinitionRepository
	instRepo     *workflowrepo.InstanceRepository
	taskRepo     *workflowrepo.TaskRepository
	publisher    Publisher
	metrics      *metrics.Metrics
	topic        string
	logger       zerolog.Logger
	now          func() time.Time
	audit        *LexAuditEmitter

	// najiz is the optional CAP-069 court-portal adapter. When wired AND an
	// active Najiz endpoint is registered for the tenant, SetNajizRepresentative
	// calls it; otherwise it keeps the honest manual-entry + status behavior.
	najiz NajizCourtPort

	// hearings is the optional CAP-175 ingestion sink: when wired, a successful
	// SyncNajizCase pulls the portal's scheduled hearings (pull_hearings) into the
	// legal-case hearing calendar (legal_case_hearings), upserting by the portal's
	// najiz_reference so a re-sync reconciles (never duplicates). When nil, the
	// sync still returns the normalized portal view but does not persist hearings.
	hearings caseHearingIngestor
}

// caseHearingIngestor is the narrow seam the CAP-175 hearing-calendar ingestion
// needs from the case-hearing repository. *repository.CaseHearingRepository
// satisfies it; tests substitute an in-memory fake so the ingestion is exercisable
// without a database.
type caseHearingIngestor interface {
	ListByCase(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.CaseHearing, error)
	Create(ctx context.Context, q repository.Queryer, h *model.CaseHearing) error
	Update(ctx context.Context, q repository.Queryer, h *model.CaseHearing) error
}

func NewLitigationDefendantService(
	db *pgxpool.Pool,
	defendants *repository.LegalDefendantRepository,
	cases *repository.LegalCaseRepository,
	tasks *repository.CaseTaskRepository,
	drafter *drafting.Drafter,
	orchestrator *ApprovalOrchestrator,
	defRepo *workflowrepo.DefinitionRepository,
	instRepo *workflowrepo.InstanceRepository,
	taskRepo *workflowrepo.TaskRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *LitigationDefendantService {
	return &LitigationDefendantService{
		db:           db,
		defendants:   defendants,
		cases:        cases,
		tasks:        tasks,
		drafter:      drafter,
		orchestrator: orchestrator,
		defRepo:      defRepo,
		instRepo:     instRepo,
		taskRepo:     taskRepo,
		publisher:    publisherOrNoop(publisher),
		metrics:      appMetrics,
		topic:        topic,
		logger:       logger.With().Str("service", "lex-litigation-defendant").Logger(),
		now:          time.Now,
	}
}

// WithNajizCourtPort wires the CAP-069 Najiz court-portal adapter. Passing nil
// (or never calling this) keeps the manual-entry behavior. Returns the receiver
// for chaining at construction time. The integrator wires this in app.go after
// building the integration repository + HTTPNajizCourtAdapter.
func (s *LitigationDefendantService) WithNajizCourtPort(port NajizCourtPort) *LitigationDefendantService {
	s.najiz = port
	return s
}

// WithCaseHearingIngest wires the CAP-175 hearing-calendar ingestion sink. When
// set, a successful SyncNajizCase ingests the Najiz portal's scheduled hearings
// (pull_hearings) into legal_case_hearings, upserting each by its najiz_reference
// so re-syncs reconcile rather than duplicate. Passing nil (or never calling this)
// keeps the read-only behavior (the normalized portal view is still returned to
// the caller). The integrator wires this in app.go with store.CaseHearings.
func (s *LitigationDefendantService) WithCaseHearingIngest(repo caseHearingIngestor) *LitigationDefendantService {
	// Guard against a typed-nil concrete pointer wrapped in the interface.
	if repo == nil {
		return s
	}
	s.hearings = repo
	return s
}

// SetAuditEmitter wires the immutable audit_db ledger emitter (chainable). When set,
// defendant-case transitions Emit() a tamper-evident audit record in addition to the
// in-tx append-only legal_litigation_audit_log row. Safe to leave nil.
func (s *LitigationDefendantService) SetAuditEmitter(audit *LexAuditEmitter) *LitigationDefendantService {
	s.audit = audit
	return s
}

// Register registers an incoming lawsuit against the company on a defendant case
// (CAP-067/068).
func (s *LitigationDefendantService) Register(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.RegisterDefendantCaseRequest) (*model.LegalDefendantCase, error) {
	req.Normalize()
	if req.PlaintiffName == "" {
		return nil, validationError("plaintiff_name is required", map[string]string{"plaintiff_name": "required"})
	}
	c, err := s.cases.Get(ctx, tenantID, caseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	d := &model.LegalDefendantCase{
		ID:               uuid.New(),
		TenantID:         tenantID,
		CaseID:           caseID,
		PlaintiffName:    req.PlaintiffName,
		CourtName:        normalizeOptionalString(req.CourtName),
		NotificationDate: req.NotificationDate,
		NajizStatus:      model.NajizSyncStatusManual,
		Status:           model.DefendantCaseStatusRegistered,
		Metadata:         req.Metadata,
		CreatedBy:        userID,
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start defendant register transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.defendants.Create(ctx, tx, d); err != nil {
		return nil, internalError("register defendant case", err)
	}
	if err := s.appendDefendantAudit(ctx, tx, d, userID, "defendant.registered", nil, ptrString(string(d.Status)), nil, nil, defendantAuditState(d), map[string]any{
		"plaintiff_name":    d.PlaintiffName,
		"notification_date": dateDetail(d.NotificationDate),
	}); err != nil {
		return nil, err
	}
	if d.NotificationDate != nil && !d.NotificationDate.IsZero() {
		if err := createAutomatedCaseTasks(ctx, tx, s.cases, s.tasks, tenantID, userID, caseID, defendantNotificationAutomationTasks(c, d, s.now().UTC())); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit defendant register", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.defendant.registered", tenantID, &userID, map[string]any{
		"id": d.ID, "case_id": caseID, "plaintiff_name": d.PlaintiffName, "notification_date": d.NotificationDate,
	}, s.logger)
	s.emitDefendantAudit(ctx, d, &userID, "defendant.registered", "info", nil, defendantAuditState(d), nil)
	return s.Get(ctx, tenantID, caseID, d.ID)
}

func (s *LitigationDefendantService) List(ctx context.Context, tenantID, caseID uuid.UUID, filters model.LegalDefendantCaseListFilters) ([]model.LegalDefendantCase, int, error) {
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, 0, err
	}
	return s.defendants.List(ctx, tenantID, caseID, filters)
}

func (s *LitigationDefendantService) Get(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.LegalDefendantCase, error) {
	d, err := s.defendants.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("defendant case not found")
		}
		return nil, internalError("load defendant case", err)
	}
	if d.Attachments, err = s.defendants.ListAttachments(ctx, tenantID, id); err != nil {
		return nil, internalError("load defendant attachments", err)
	}
	return d, nil
}

func (s *LitigationDefendantService) Update(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.UpdateDefendantCaseRequest) (*model.LegalDefendantCase, error) {
	d, err := s.defendants.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("defendant case not found")
		}
		return nil, internalError("load defendant case", err)
	}
	if req.PlaintiffName != nil {
		d.PlaintiffName = strings.TrimSpace(*req.PlaintiffName)
	}
	if req.CourtName != nil {
		d.CourtName = normalizeOptionalString(req.CourtName)
	}
	notificationReceived := false
	if req.NotificationDate != nil {
		d.NotificationDate = req.NotificationDate
		notificationReceived = d.NotificationDate != nil && !d.NotificationDate.IsZero()
	}
	if req.Metadata != nil {
		d.Metadata = req.Metadata
	}
	if strings.TrimSpace(d.PlaintiffName) == "" {
		return nil, validationError("plaintiff_name is required", map[string]string{"plaintiff_name": "required"})
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start defendant update transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.defendants.Update(ctx, tx, d); err != nil {
		return nil, internalError("update defendant case", err)
	}
	if notificationReceived {
		c, err := s.cases.Get(ctx, tenantID, caseID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil, notFoundError("legal case not found")
			}
			return nil, internalError("load legal case", err)
		}
		if err := createAutomatedCaseTasks(ctx, tx, s.cases, s.tasks, tenantID, userID, caseID, defendantNotificationAutomationTasks(c, d, s.now().UTC())); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit defendant update", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.defendant.updated", tenantID, &userID, map[string]any{
		"id": d.ID, "case_id": caseID,
	}, s.logger)
	return s.Get(ctx, tenantID, caseID, id)
}

func (s *LitigationDefendantService) Delete(ctx context.Context, tenantID, caseID, id uuid.UUID) error {
	if err := s.defendants.SoftDelete(ctx, tenantID, caseID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("defendant case not found")
		}
		return internalError("delete defendant case", err)
	}
	return nil
}

// SetNajizRepresentative records the Najiz (ناجز) court-portal company
// representative (CAP-069/175). When a NajizCourtPort is wired AND an active
// Najiz integration endpoint is registered for the tenant, it dispatches the
// representative to the portal through the adapter and stamps the portal-returned
// sync status + reference. Otherwise — no port, no active endpoint, or an active
// endpoint that is mis-configured — it falls back to the honest manual entry +
// operator-supplied status (no faked "synced"). A transport failure against a
// configured endpoint stamps najiz_status=failed but still persists the
// operator's manual representative so the entry is never lost.
func (s *LitigationDefendantService) SetNajizRepresentative(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.SetNajizRepresentativeRequest) (*model.LegalDefendantCase, error) {
	req.Normalize()
	if req.CompanyRepresentative == "" {
		return nil, validationError("company_representative is required", map[string]string{"company_representative": "required"})
	}
	if !req.NajizStatus.Valid() {
		return nil, validationError("invalid najiz_status", map[string]string{"najiz_status": "invalid"})
	}
	d, err := s.defendants.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("defendant case not found")
		}
		return nil, internalError("load defendant case", err)
	}

	// Default: honest manual entry with the operator-supplied status.
	d.CompanyRepresentative = &req.CompanyRepresentative
	d.NajizStatus = req.NajizStatus
	d.NajizReference = normalizeOptionalString(req.NajizReference)

	source := "manual"
	var adapterDetail string
	if s.najiz != nil {
		result, perr := s.najiz.AddRepresentative(ctx, tenantID, NajizRepresentativeRequest{
			CaseID:                caseID,
			DefendantCaseID:       id,
			CompanyRepresentative: req.CompanyRepresentative,
			CourtName:             ptrStringOrEmpty(d.CourtName),
			PlaintiffName:         d.PlaintiffName,
			NajizReference:        ptrStringOrEmpty(d.NajizReference),
		})
		switch {
		case perr == nil && result != nil:
			// Portal accepted: stamp portal-returned status + reference.
			source = "najiz"
			adapterDetail = result.Detail
			d.NajizStatus = result.Status
			if result.Reference != "" {
				ref := result.Reference
				d.NajizReference = &ref
			}
			d.Metadata = mergeMetadata(d.Metadata, result.Metadata)
		case errors.Is(perr, ErrNajizNotConfigured), errors.Is(perr, ErrNajizWritesDisabled):
			// No active/usable endpoint, OR the endpoint is read-only (writes gated
			// pending MoJ Takamul write-scope onboarding): keep the manual fallback
			// silently. A read-only Najiz wiring is the honest default — it is NOT a
			// failure, so we never stamp najiz_status=failed for it.
			s.logger.Debug().Str("defendant_case_id", id.String()).Msg("najiz endpoint not configured or read-only; manual representative entry")
		default:
			// Configured endpoint failed (transport/portal rejection): record
			// the failure but persist the manual representative.
			source = "najiz_failed"
			adapterDetail = perr.Error()
			d.NajizStatus = model.NajizSyncStatusFailed
			d.Metadata = mergeMetadata(d.Metadata, map[string]any{
				"najiz_adapter":      "http",
				"najiz_last_error":   perr.Error(),
				"najiz_attempted_at": s.now().UTC().Format(time.RFC3339Nano),
			})
			s.logger.Warn().Err(perr).Str("defendant_case_id", id.String()).Msg("najiz add-representative failed; recorded as failed")
		}
	}

	if err := s.defendants.Update(ctx, s.db, d); err != nil {
		return nil, internalError("set najiz representative", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.defendant.najiz_representative_set", tenantID, &userID, map[string]any{
		"id": d.ID, "case_id": caseID, "najiz_status": d.NajizStatus, "source": source, "detail": adapterDetail,
	}, s.logger)
	return s.Get(ctx, tenantID, caseID, id)
}

// NajizCaseSyncOutcome is the result returned to the API for a Najiz READ-first
// sync: the normalized portal view plus whether a live (vs sandbox / not-wired)
// pull occurred. It never fabricates live MoJ success — when no Najiz port is
// wired or no active endpoint exists, Synced is false and Result is nil.
type NajizCaseSyncOutcome struct {
	Synced  bool                 `json:"synced"`
	Sandbox bool                 `json:"sandbox"`
	Detail  string               `json:"detail"`
	Result  *NajizCaseSyncResult `json:"result,omitempty"`
	// HearingsIngested / HearingsUpdated count the portal hearings that were
	// written into / reconciled onto the legal-case hearing calendar (CAP-175).
	// Both are zero when no CaseHearing ingestion sink is wired.
	HearingsIngested int `json:"hearings_ingested"`
	HearingsUpdated  int `json:"hearings_updated"`
}

// SyncNajizCase performs the READ-first pull of the defendant case's portal state
// from Najiz (CAP-069). Reads are the always-allowed direction — even a read-only
// endpoint serves them — so this never requires allow_writes. It is exposed under
// the WRITE RBAC tier because it RECONCILES the local row (stamps last-sync
// metadata). When no NajizCourtPort is wired or no active endpoint is configured
// for the tenant, it returns an honest not-synced outcome (Synced=false) rather
// than erroring or faking success. The defendant case is tenant+case-scoped via
// the repository Get, so cross-tenant access is impossible.
func (s *LitigationDefendantService) SyncNajizCase(ctx context.Context, tenantID, userID, caseID, id uuid.UUID) (*NajizCaseSyncOutcome, error) {
	d, err := s.defendants.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("defendant case not found")
		}
		return nil, internalError("load defendant case", err)
	}
	if s.najiz == nil {
		return &NajizCaseSyncOutcome{Synced: false, Detail: "Najiz court-portal adapter not wired"}, nil
	}
	result, perr := s.najiz.SyncCase(ctx, tenantID, NajizCaseSyncRequest{
		CaseID:         caseID,
		NajizReference: ptrStringOrEmpty(d.NajizReference),
	})
	if perr != nil {
		// A not-configured endpoint is the honest default (read-only / planned), NOT
		// a failure: surface it as not-synced without erroring or stamping failed.
		if errors.Is(perr, ErrNajizNotConfigured) {
			return &NajizCaseSyncOutcome{Synced: false, Detail: "no active Najiz endpoint configured for tenant"}, nil
		}
		return nil, internalError("najiz case sync", perr)
	}
	// Reconcile: stamp non-sensitive last-sync metadata on the local row so the
	// console can show provenance. We never blindly overwrite operator-entered
	// case fields here — the normalized portal view is returned to the caller for
	// an explicit reconcile decision.
	if d.Metadata == nil {
		d.Metadata = map[string]any{}
	}
	d.Metadata["najiz_last_sync_at"] = s.now().UTC().Format(time.RFC3339Nano)
	d.Metadata["najiz_last_sync_sandbox"] = result.Sandbox
	if result.EndpointCode != "" {
		d.Metadata["najiz_endpoint_code"] = result.EndpointCode
	}
	if result.Reference != "" && d.NajizReference == nil {
		d.NajizReference = &result.Reference
	}
	if err := s.defendants.Update(ctx, s.db, d); err != nil {
		return nil, internalError("record najiz case sync", err)
	}

	// CAP-175: ingest the pulled hearings into the legal-case hearing calendar so
	// they surface on the case timeline / calendar UI, not just in the sync
	// response. Idempotent: each portal hearing is keyed by its najiz_reference and
	// upserted, so a re-sync reconciles (updates date/status) rather than
	// duplicating. The ingestion failing must not fail the sync itself (the portal
	// view is still valid), so we record but tolerate an ingestion error.
	var ingested, updated int
	if s.hearings != nil && len(result.Hearings) > 0 {
		var ierr error
		ingested, updated, ierr = s.ingestNajizHearings(ctx, tenantID, userID, caseID, result.Hearings)
		if ierr != nil {
			s.logger.Warn().Err(ierr).Str("case_id", caseID.String()).Msg("najiz hearing-calendar ingestion failed; portal view still returned")
		}
	}

	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.defendant.najiz_case_synced", tenantID, &userID, map[string]any{
		"id": d.ID, "case_id": caseID, "sandbox": result.Sandbox, "endpoint_code": result.EndpointCode,
		"hearings": len(result.Hearings), "representatives": len(result.Representatives),
		"hearings_ingested": ingested, "hearings_updated": updated,
	}, s.logger)
	return &NajizCaseSyncOutcome{
		Synced:           true,
		Sandbox:          result.Sandbox,
		Detail:           "najiz case state pulled",
		Result:           result,
		HearingsIngested: ingested,
		HearingsUpdated:  updated,
	}, nil
}

// najizHearingRefKey is the metadata key under which a CaseHearing row records the
// Najiz portal reference it was reconciled from. It is the dedup/upsert key for
// CAP-175 ingestion: a re-sync matches on it to UPDATE the existing row rather
// than INSERT a duplicate.
const najizHearingRefKey = "najiz_reference"

// ingestNajizHearings upserts the portal's scheduled hearings (pull_hearings)
// into the legal-case hearing calendar (CAP-175). Each portal hearing carries a
// stable najiz_reference; we match it against the case's existing hearings by the
// najiz_reference recorded in their metadata. A match UPDATEs the row's date /
// status / detail (reconcile); a miss CREATEs a new calendar row. Operator-entered
// hearings (no najiz_reference) are never touched. Hearings with no usable
// scheduled time or reference are skipped (we never fabricate a calendar date).
// Returns (created, updated, err).
func (s *LitigationDefendantService) ingestNajizHearings(ctx context.Context, tenantID, userID, caseID uuid.UUID, hearings []NajizHearing) (int, int, error) {
	existing, err := s.hearings.ListByCase(ctx, tenantID, caseID)
	if err != nil {
		return 0, 0, internalError("list case hearings for najiz ingest", err)
	}
	// Index existing portal-sourced hearings by their najiz_reference so a re-sync
	// reconciles in place.
	byRef := make(map[string]*model.CaseHearing, len(existing))
	for i := range existing {
		if ref := najizHearingRef(existing[i].Metadata); ref != "" {
			byRef[ref] = &existing[i]
		}
	}

	var created, updated int
	for _, h := range hearings {
		ref := strings.TrimSpace(h.Reference)
		if ref == "" || h.ScheduledAt.IsZero() {
			// No stable key or no real date: skip rather than fabricate a calendar row.
			continue
		}
		notes := strings.TrimSpace(h.Detail)
		var location *string
		if c := strings.TrimSpace(h.Court); c != "" {
			location = &c
		}
		hearingMeta := map[string]any{
			najizHearingRefKey: ref,
			"source":           "najiz",
			"najiz_status":     strings.TrimSpace(h.Status),
			"najiz_synced_at":  s.now().UTC().Format(time.RFC3339Nano),
		}

		if cur, ok := byRef[ref]; ok {
			// Reconcile the existing portal-sourced row in place.
			cur.HearingDate = h.ScheduledAt
			cur.Location = location
			if notes != "" {
				cur.Notes = notes
			}
			cur.Metadata = mergeMetadata(cur.Metadata, hearingMeta)
			if err := s.hearings.Update(ctx, s.db, cur); err != nil {
				return created, updated, internalError("reconcile najiz hearing into calendar", err)
			}
			updated++
			continue
		}

		row := &model.CaseHearing{
			ID:          uuid.New(),
			TenantID:    tenantID,
			CaseID:      caseID,
			HearingDate: h.ScheduledAt,
			Location:    location,
			Notes:       notes,
			Metadata:    hearingMeta,
			CreatedBy:   userID,
		}
		if err := s.hearings.Create(ctx, s.db, row); err != nil {
			return created, updated, internalError("ingest najiz hearing into calendar", err)
		}
		created++
	}
	return created, updated, nil
}

// najizHearingRef extracts the recorded Najiz portal reference from a hearing's
// metadata blob (the CAP-175 upsert key), tolerating an absent/typed-wrong value.
func najizHearingRef(meta map[string]any) string {
	if meta == nil {
		return ""
	}
	if v, ok := meta[najizHearingRefKey].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

// NajizCourtHealth returns the honest connectivity verdict for the tenant's Najiz
// wiring (not_configured / planned / read_only / read_write), NEVER fabricating
// live MoJ success. When no port is wired it reports not_configured. Read-tier.
func (s *LitigationDefendantService) NajizCourtHealth(ctx context.Context, tenantID uuid.UUID) NajizHealth {
	if s.najiz == nil {
		return NajizHealth{
			Configured: false,
			Verdict:    "not_configured",
			Detail:     "Najiz court-portal adapter not wired",
			CheckedAt:  s.now().UTC(),
		}
	}
	return s.najiz.Health(ctx, tenantID)
}

// AddAttachment uploads the served statement of claim / supporting documents
// (CAP-070).
func (s *LitigationDefendantService) AddAttachment(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.AddDefendantAttachmentRequest) (*model.LegalDefendantAttachment, error) {
	req.Normalize()
	if req.FileName == "" {
		return nil, validationError("file_name is required", map[string]string{"file_name": "required"})
	}
	if _, err := s.defendants.Get(ctx, tenantID, caseID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("defendant case not found")
		}
		return nil, internalError("load defendant case", err)
	}
	a := &model.LegalDefendantAttachment{
		ID:              uuid.New(),
		TenantID:        tenantID,
		DefendantCaseID: id,
		FileID:          req.FileID,
		FileName:        req.FileName,
		Caption:         req.Caption,
		Kind:            req.Kind,
		CreatedBy:       userID,
	}
	if err := s.defendants.AddAttachment(ctx, s.db, a); err != nil {
		return nil, internalError("add defendant attachment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.defendant.attachment_added", tenantID, &userID, map[string]any{
		"id": id, "case_id": caseID, "kind": a.Kind, "file_id": req.FileID,
	}, s.logger)
	return a, nil
}

// NotifyDepartment notifies the concerned department of an incoming lawsuit
// (CAP-071) and advances the status to notified_dept.
func (s *LitigationDefendantService) NotifyDepartment(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.NotifyDepartmentRequest) (*model.LegalDefendantCase, error) {
	req.Normalize()
	if req.ConcernedDepartment == "" {
		return nil, validationError("concerned_department is required", map[string]string{"concerned_department": "required"})
	}
	d, err := s.defendants.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("defendant case not found")
		}
		return nil, internalError("load defendant case", err)
	}
	before := defendantAuditState(d)
	fromStatus := string(d.Status)
	now := s.now().UTC()
	d.ConcernedDepartment = &req.ConcernedDepartment
	d.DeptNotifiedAt = &now
	if d.Status == model.DefendantCaseStatusRegistered {
		d.Status = model.DefendantCaseStatusNotifiedDept
	}
	if req.Metadata != nil {
		d.Metadata = req.Metadata
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start defendant notify transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.defendants.Update(ctx, tx, d); err != nil {
		return nil, internalError("notify department", err)
	}
	if err := s.appendDefendantAudit(ctx, tx, d, userID, "defendant.department_notified", ptrString(fromStatus), ptrString(string(d.Status)), optionalReason(req.Note), before, defendantAuditState(d), map[string]any{
		"concerned_department": req.ConcernedDepartment,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit defendant notify", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.defendant.department_notified", tenantID, &userID, map[string]any{
		"id": d.ID, "case_id": caseID, "concerned_department": req.ConcernedDepartment, "note": req.Note,
	}, s.logger)
	s.emitDefendantAudit(ctx, d, &userID, "defendant.department_notified", "info", before, defendantAuditState(d), nil)
	return s.Get(ctx, tenantID, caseID, id)
}

// DraftResponseMemo drafts the first-response memo (مذكرة الرد الأولى, CAP-072). When
// GenerateBody is set and no body is supplied, the AID engine drafts it (Arabic
// default). Advances the status to response_drafting.
func (s *LitigationDefendantService) DraftResponseMemo(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.DraftResponseMemoRequest) (*model.LegalDefendantCase, error) {
	req.Normalize()
	d, err := s.defendants.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("defendant case not found")
		}
		return nil, internalError("load defendant case", err)
	}
	body := req.Body
	aiGenerated := false
	if body == "" && req.GenerateBody {
		drafted, derr := s.draftResponseMemoBody(ctx, tenantID, caseID, d, req)
		if derr != nil {
			return nil, derr
		}
		body = drafted
		aiGenerated = true
	}
	if body == "" {
		return nil, validationError("body is required (or set generate_body)", map[string]string{"body": "required"})
	}
	before := defendantAuditState(d)
	fromStatus := string(d.Status)
	d.ResponseMemo = body
	d.ResponseMemoAI = aiGenerated
	if d.Status == model.DefendantCaseStatusRegistered || d.Status == model.DefendantCaseStatusNotifiedDept || d.Status == model.DefendantCaseStatusResponseRejected {
		d.Status = model.DefendantCaseStatusResponseDrafting
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start defendant draft transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.defendants.Update(ctx, tx, d); err != nil {
		return nil, internalError("draft response memo", err)
	}
	if err := s.appendDefendantAudit(ctx, tx, d, userID, "defendant.response_drafted", ptrString(fromStatus), ptrString(string(d.Status)), nil, before, defendantAuditState(d), map[string]any{
		"ai_generated": aiGenerated,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit defendant draft", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.defendant.response_drafted", tenantID, &userID, map[string]any{
		"id": d.ID, "case_id": caseID, "ai_generated": aiGenerated,
	}, s.logger)
	s.emitDefendantAudit(ctx, d, &userID, "defendant.response_drafted", "info", before, defendantAuditState(d), nil)
	return s.Get(ctx, tenantID, caseID, id)
}

// StartResponseReview opens the two-tier supervisor→section_manager review of the
// first-response memo over the shared SEQUENTIAL ApprovalOrchestrator chain
// (CAP-073). The supervisor is the first approver; on advance the orchestrator
// creates the section_manager task automatically.
func (s *LitigationDefendantService) StartResponseReview(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.StartResponseReviewRequest) (*model.LegalDefendantCase, error) {
	if s.instRepo == nil || s.taskRepo == nil || s.orchestrator == nil {
		return nil, internalError("defendant response workflow repositories are not configured", fmt.Errorf("missing workflow dependencies"))
	}
	d, err := s.defendants.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("defendant case not found")
		}
		return nil, internalError("load defendant case", err)
	}
	if strings.TrimSpace(d.ResponseMemo) == "" {
		return nil, conflictError("draft the first-response memo before starting review")
	}
	if d.Status != model.DefendantCaseStatusResponseDrafting {
		return nil, conflictError("only a drafted response can be submitted for review")
	}
	if d.WorkflowInstanceID != nil {
		return nil, conflictError("defendant response already has an active review workflow")
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
		CurrentStepID: ptrString(defendantResponseStepID),
		Variables: map[string]any{
			"defendant_case_id": d.ID.String(),
			"case_id":           caseID.String(),
		},
		StepOutputs: map[string]any{},
		StartedBy:   ptrString(userID.String()),
	}
	if err := s.instRepo.Create(ctx, instance); err != nil {
		return nil, internalError("create defendant review instance", err)
	}
	stepExec := &workflowmodel.StepExecution{
		InstanceID: instance.ID,
		StepID:     defendantResponseStepID,
		StepType:   workflowexec.StepTypeApprovalChain,
		Status:     workflowmodel.StepStatusPending,
		Attempt:    1,
		CreatedAt:  now,
	}
	if err := s.instRepo.CreateStepExecution(ctx, stepExec); err != nil {
		return nil, internalError("create defendant review step", err)
	}
	workflowID := uuid.MustParse(instance.ID)
	approvers := defendantReviewApprovers(req)
	// Enforce the mandatory two-tier review: the first-response memo MUST pass BOTH
	// the supervisor THEN the section_manager. The chain is sequential with
	// QuorumAll, so the orchestrator only advances the defendant case to
	// response_approved after both tiers approve in order. Guard the chain shape
	// here so a misconfigured single-tier chain can never short-circuit the review.
	if err := validateTwoTierReviewChain(approvers); err != nil {
		return nil, err
	}
	task := s.buildFirstApproverTask(tenantID, d, instance.ID, stepExec.ID, approvers, now)
	before := defendantAuditState(d)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start defendant review transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := insertWorkflowTask(ctx, tx, task); err != nil {
		return nil, internalError("create defendant review task", err)
	}
	if err := s.defendants.UpdateStatusTx(ctx, tx, tenantID, id, model.DefendantCaseStatusResponseInReview, &workflowID, nil, nil, false); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("defendant case not found")
		}
		return nil, internalError("move defendant response into review", err)
	}
	d.Status = model.DefendantCaseStatusResponseInReview
	if err := s.appendDefendantAudit(ctx, tx, d, userID, "defendant.review_started", ptrString(string(model.DefendantCaseStatusResponseDrafting)), ptrString(string(model.DefendantCaseStatusResponseInReview)), nil, before, defendantAuditState(d), map[string]any{
		"workflow_instance_id": workflowID.String(),
		"approver_total":       len(approvers),
		"tier_1":               approvers[0].Ref,
		"tier_2":               approvers[1].Ref,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit defendant review start", err)
	}
	if s.metrics != nil {
		s.metrics.WorkflowActive.Inc()
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.defendant.review_started", tenantID, &userID, map[string]any{
		"id": d.ID, "case_id": caseID, "workflow_instance_id": workflowID, "approver_total": len(approvers),
	}, s.logger)
	s.emitDefendantAudit(ctx, d, &userID, "defendant.review_started", "info", before, defendantAuditState(d), map[string]any{
		"approver_total": len(approvers),
	})
	return s.Get(ctx, tenantID, caseID, id)
}

// DecideResponseReview records one approver decision in the two-tier review through
// the reusable sequential orchestrator (CAP-073).
func (s *LitigationDefendantService) DecideResponseReview(ctx context.Context, tenantID, userID, caseID, id, workflowInstanceID, taskID uuid.UUID, req dto.WorkflowDecisionRequest) (*ApprovalDecisionOutcome, error) {
	d, err := s.defendants.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("defendant case not found")
		}
		return nil, internalError("load defendant case", err)
	}
	if d.WorkflowInstanceID == nil || *d.WorkflowInstanceID != workflowInstanceID {
		return nil, conflictError("workflow instance does not belong to this defendant case")
	}
	spec := s.responseSubjectSpec(id)
	return s.orchestrator.DecideTask(ctx, spec, tenantID, userID, workflowInstanceID, taskID, req)
}

// responseSubjectSpec builds the orchestrator hook set for the response memo review:
// lock the defendant-case row and advance its FSM (approved on advance, rejected on
// reject) inside the orchestrator transaction.
func (s *LitigationDefendantService) responseSubjectSpec(defendantCaseID uuid.UUID) ApprovalSubjectSpec {
	return ApprovalSubjectSpec{
		SubjectType: "legal_defendant_case",
		SubjectID:   defendantCaseID,
		EventEntity: "defendant",
		LockSubject: s.defendants.LockStatus,
		AdvanceSubject: func(ctx context.Context, tx pgx.Tx, tenantID, uid, subjectID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error) {
			switch resolution {
			case workflowexec.ResolutionAdvance:
				// Load the bounds for the C-2 first-response turnaround fact + audit
				// (the orchestrator already holds the FOR UPDATE lock on this row).
				notifiedAt, createdAt, ferr := s.responseTurnaroundBounds(ctx, tx, tenantID, subjectID)
				if ferr != nil {
					return "", ferr
				}
				if err := s.defendants.UpdateStatusTx(ctx, tx, tenantID, subjectID, model.DefendantCaseStatusResponseApproved, nil, &uid, &now, true); err != nil {
					return "", internalError("approve defendant response", err)
				}
				// C-2: defendant first-response turnaround (notification_date — or
				// created_at when never served — through final approval), in-tx.
				started := createdAt
				if notifiedAt != nil {
					started = *notifiedAt
				}
				if err := s.defendants.UpsertDurationFact(ctx, tx, &repository.LitigationDurationFact{
					TenantID:   tenantID,
					Kind:       defendantFirstResponseDurationKind,
					SubjectID:  subjectID,
					StartedAt:  started,
					EndedAt:    now,
					OccurredAt: now,
				}); err != nil {
					return "", internalError("record defendant first-response duration fact", err)
				}
				if err := s.appendDefendantApprovalAudit(ctx, tx, tenantID, subjectID, uid, "defendant.response_approved", model.DefendantCaseStatusResponseApproved, decision); err != nil {
					return "", err
				}
				return string(model.DefendantCaseStatusResponseApproved), nil
			case workflowexec.ResolutionReject:
				if err := s.defendants.UpdateStatusTx(ctx, tx, tenantID, subjectID, model.DefendantCaseStatusResponseRejected, nil, nil, nil, true); err != nil {
					return "", internalError("reject defendant response", err)
				}
				if err := s.appendDefendantApprovalAudit(ctx, tx, tenantID, subjectID, uid, "defendant.response_rejected", model.DefendantCaseStatusResponseRejected, decision); err != nil {
					return "", err
				}
				return string(model.DefendantCaseStatusResponseRejected), nil
			default:
				return string(model.DefendantCaseStatusResponseInReview), nil
			}
		},
	}
}

// buildFirstApproverTask materialises the first (supervisor) task of the sequential
// two-tier chain; the orchestrator creates the section_manager task on advance from
// the chain config stamped on this task's metadata.
func (s *LitigationDefendantService) buildFirstApproverTask(tenantID uuid.UUID, d *model.LegalDefendantCase, instanceID, stepExecID string, approvers []workflowexec.Approver, now time.Time) *workflowmodel.HumanTask {
	chainCfg := map[string]any{
		"approvers": approverConfigList(approvers),
		"mode":      workflowexec.ApprovalModeSequential,
		"quorum":    workflowexec.QuorumAll,
		// Opt the defendant two-tier memo review into the engine's distinct-approver
		// constraint (acceptance bullet 6, second half / CAP Defendant §5.4): tier-2
		// (section_manager) cannot be DECIDED by the same actor who decided tier-1
		// (supervisor) at runtime, even when one user holds both roles. The
		// orchestrator re-runs DistinctApproverConflict over the recorded decisions
		// on each decision and rejects a repeat decider.
		"require_distinct_approvers": true,
	}
	metadata := map[string]any{
		"defendant_case_id":     d.ID.String(),
		"case_id":               d.CaseID.String(),
		"subject_type":          "legal_defendant_case",
		"approval_mode":         workflowexec.ApprovalModeSequential,
		"approval_quorum":       workflowexec.QuorumAll,
		"approval_chain":        true,
		"approval_chain_config": chainCfg,
		"approver_total":        len(approvers),
		"approver_index":        0,
		"approver_type":         approvers[0].Type,
		"approver_ref":          approvers[0].Ref,
		"source":                "lex_litigation_defendant",
	}
	task := &workflowmodel.HumanTask{
		TenantID:   tenantID.String(),
		InstanceID: instanceID,
		StepID:     defendantResponseStepID,
		StepExecID: stepExecID,
		Name:       "Review first-response memo",
		Status:     workflowmodel.TaskStatusPending,
		FormSchema: defendantReviewFormSchema(),
		FormData:   map[string]any{},
		Metadata:   metadata,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if approvers[0].IsRole() {
		role := approvers[0].Ref
		task.AssigneeRole = &role
	} else {
		assignee := approvers[0].Ref
		task.AssigneeID = &assignee
	}
	return task
}

// defendantReviewApprovers builds the ordered two-tier approver chain. When explicit
// approver ids are supplied they address specific users; otherwise the tiers fall
// back to the "legal-case-supervisor" and "legal-cases-manager" roles.
func defendantReviewApprovers(req dto.StartResponseReviewRequest) []workflowexec.Approver {
	supervisor := workflowexec.Approver{Type: "role", Ref: "legal-case-supervisor"}
	if req.SupervisorID != nil && *req.SupervisorID != uuid.Nil {
		supervisor = workflowexec.Approver{Type: "user", Ref: req.SupervisorID.String()}
	}
	sectionManager := workflowexec.Approver{Type: "role", Ref: "legal-cases-manager"}
	if req.SectionManagerID != nil && *req.SectionManagerID != uuid.Nil {
		sectionManager = workflowexec.Approver{Type: "user", Ref: req.SectionManagerID.String()}
	}
	return []workflowexec.Approver{supervisor, sectionManager}
}

func (s *LitigationDefendantService) ensureDefinition(ctx context.Context, tenantID, userID uuid.UUID) (*workflowmodel.WorkflowDefinition, error) {
	var existing workflowmodel.WorkflowDefinition
	err := s.db.QueryRow(ctx, `
		SELECT id, version
		FROM workflow_definitions
		WHERE tenant_id = $1 AND name = $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY version DESC
		LIMIT 1`,
		tenantID, defendantResponseWorkflowName,
	).Scan(&existing.ID, &existing.Version)
	if err == nil {
		existing.TenantID = tenantID.String()
		return &existing, nil
	}
	if err != pgx.ErrNoRows {
		return nil, internalError("load defendant review definition", err)
	}
	definition := &workflowmodel.WorkflowDefinition{
		ID:          uuid.NewString(),
		TenantID:    tenantID.String(),
		Name:        defendantResponseWorkflowName,
		Description: "Two-tier supervisor→section_manager review of the defendant first-response memo for Clario Lex.",
		Version:     1,
		Status:      workflowmodel.DefinitionStatusActive,
		TriggerConfig: workflowmodel.TriggerConfig{
			Type: workflowmodel.TriggerTypeManual,
		},
		Variables: map[string]workflowmodel.VariableDef{
			"defendant_case_id": {Type: "string"},
			"case_id":           {Type: "string"},
		},
		Steps: []workflowmodel.StepDefinition{
			{ID: defendantResponseStepID, Type: workflowexec.StepTypeApprovalChain, Name: "Response Memo Review", Config: map[string]any{}, Transitions: []workflowmodel.Transition{{Target: "end"}}},
			{ID: "end", Type: workflowmodel.StepTypeEnd, Name: "Completed", Config: map[string]any{}, Transitions: nil},
		},
		CreatedBy: userID.String(),
	}
	if err := s.defRepo.Create(ctx, definition); err != nil {
		return nil, internalError("create defendant review definition", err)
	}
	return definition, nil
}

func defendantReviewFormSchema() []workflowmodel.FormField {
	return []workflowmodel.FormField{
		{Name: "decision", Type: "select", Label: "Decision", Required: true, Options: []string{"approve", "request_changes", "reject"}},
		{Name: "notes", Type: "textarea", Label: "Review notes", Required: false},
	}
}

// draftResponseMemoBody drives the AID engine to draft the first-response memo body
// (CAP-072), Arabic by default.
func (s *LitigationDefendantService) draftResponseMemoBody(ctx context.Context, tenantID, caseID uuid.UUID, d *model.LegalDefendantCase, req dto.DraftResponseMemoRequest) (string, error) {
	if s.drafter == nil || !s.drafter.Enabled() {
		return "", draftingUnavailable()
	}
	c, err := s.cases.Get(ctx, tenantID, caseID)
	if err != nil {
		return "", internalError("load legal case for memo draft", err)
	}
	lang := req.Language
	if lang == "" {
		lang = "ar"
	}
	dealTerms := map[string]any{
		"case_number":    c.CaseNumber,
		"case_type":      c.CaseType,
		"plaintiff_name": d.PlaintiffName,
		"court_name":     ptrStringOrEmpty(d.CourtName),
		"title_ar":       c.Title.AR,
		"title_en":       c.Title.EN,
		"description":    c.Description,
		"instructions":   req.DraftPrompt,
	}
	out, err := s.drafter.DraftContract(ctx, tenantID, drafting.ContractDraftRequest{
		ContractType: "first_response_memo",
		DealTerms:    dealTerms,
		TemplateHint: "Draft the defendant's first-response memo (مذكرة الرد الأولى): acknowledge the claim, state defences and objections, respond to each plaintiff allegation, and request dismissal where appropriate.",
		Language:     lang,
	})
	if err != nil {
		return "", mapDraftingError(err)
	}
	return assembleDraftSections(out.Title, out.Sections, out.Summary), nil
}

func (s *LitigationDefendantService) ensureCaseExists(ctx context.Context, tenantID, caseID uuid.UUID) error {
	if _, err := s.cases.Get(ctx, tenantID, caseID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("legal case not found")
		}
		return internalError("load legal case", err)
	}
	return nil
}

func ptrStringOrEmpty(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// defendantFirstResponseDurationKind is the C-2 duration-fact kind for the defendant
// first-response turnaround (notification_date -> response approved). Widened in the
// staged migration.
const defendantFirstResponseDurationKind = "defendant_first_response"

// validateTwoTierReviewChain hard-enforces the mandatory two-tier supervisor THEN
// section_manager review (CAP-073). Both tiers are required: a single-tier or
// collapsed chain is rejected so the review can never short-circuit. The first tier
// must be the supervisor (role or explicit user) and the second the section_manager,
// and the two approvers must be distinct.
func validateTwoTierReviewChain(approvers []workflowexec.Approver) error {
	if len(approvers) != 2 {
		return conflictError("the first-response memo review must have exactly two tiers (supervisor then section_manager)")
	}
	first, second := approvers[0], approvers[1]
	if first.IsRole() && first.Ref != "legal-case-supervisor" {
		return conflictError("the first review tier must be the supervisor")
	}
	if second.IsRole() && second.Ref != "legal-cases-manager" {
		return conflictError("the second review tier must be the section_manager")
	}
	if first.Type == second.Type && first.Ref == second.Ref {
		return validationError("the supervisor and section_manager tiers must be distinct", map[string]string{"section_manager_id": "duplicate"})
	}
	return nil
}

// responseTurnaroundBounds reads the notification_date (when served) and created_at
// of a defendant case inside the caller's tx, for the C-2 first-response fact.
func (s *LitigationDefendantService) responseTurnaroundBounds(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (notifiedAt *time.Time, createdAt time.Time, err error) {
	row := tx.QueryRow(ctx, `
		SELECT notification_date::timestamptz, created_at
		FROM legal_defendant_cases
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id,
	)
	var notified *time.Time
	if scanErr := row.Scan(&notified, &createdAt); scanErr != nil {
		return nil, time.Time{}, internalError("load defendant turnaround bounds", scanErr)
	}
	if notified != nil {
		utc := notified.UTC()
		notified = &utc
	}
	return notified, createdAt.UTC(), nil
}

// appendDefendantAudit writes the in-tx append-only governance audit row for a
// defendant-case transition. Immutable: legal_litigation_audit_log has no
// UPDATE/DELETE.
func (s *LitigationDefendantService) appendDefendantAudit(ctx context.Context, tx pgx.Tx, d *model.LegalDefendantCase, actorID uuid.UUID, action string, from, to, reason *string, before, after, detail map[string]any) error {
	caseID := d.CaseID
	entry := &repository.LitigationAuditEntry{
		ID:          uuid.New(),
		TenantID:    d.TenantID,
		SubjectType: "legal_defendant_case",
		SubjectID:   d.ID,
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
	if err := s.defendants.AppendAudit(ctx, tx, entry); err != nil {
		return internalError("append defendant audit", err)
	}
	return nil
}

// appendDefendantApprovalAudit writes the orchestrator-driven approval/rejection audit
// row inside the orchestrator's transaction (subject row already locked). It does not
// need the full case aggregate, only the id + actor + outcome.
func (s *LitigationDefendantService) appendDefendantApprovalAudit(ctx context.Context, tx pgx.Tx, tenantID, subjectID, actorID uuid.UUID, action string, target model.DefendantCaseStatus, decision string) error {
	entry := &repository.LitigationAuditEntry{
		ID:          uuid.New(),
		TenantID:    tenantID,
		SubjectType: "legal_defendant_case",
		SubjectID:   subjectID,
		Action:      action,
		FromStatus:  ptrString(string(model.DefendantCaseStatusResponseInReview)),
		ToStatus:    ptrString(string(target)),
		Reason:      optionalReason(decision),
		After:       map[string]any{"status": string(target)},
		ActorUserID: actorID,
	}
	if err := s.defendants.AppendAudit(ctx, tx, entry); err != nil {
		return internalError("append defendant approval audit", err)
	}
	return nil
}

// emitDefendantAudit routes a tamper-evident record to the immutable audit_db ledger
// (best-effort; never blocks the business operation).
func (s *LitigationDefendantService) emitDefendantAudit(ctx context.Context, d *model.LegalDefendantCase, actorID *uuid.UUID, action, severity string, before, after, detail map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.Emit(ctx, LexAuditRecord{
		TenantID:     d.TenantID,
		ActorUserID:  actorID,
		Action:       action,
		ResourceType: "legal_defendant_case",
		ResourceID:   d.ID.String(),
		Severity:     severity,
		OldValue:     before,
		NewValue:     after,
		Detail:       detail,
	})
}

// defendantAuditState is the before/after snapshot recorded in the audit trail. PII
// (plaintiff_name, company_representative) is intentionally NOT snapshotted here — the
// audit row records the transition + status, while the encrypted fields stay in the
// source row guarded by FieldCrypto.
func defendantAuditState(d *model.LegalDefendantCase) map[string]any {
	return map[string]any{
		"status":               string(d.Status),
		"najiz_status":         string(d.NajizStatus),
		"concerned_department": ptrStringOrEmpty(d.ConcernedDepartment),
		"response_memo_ai":     d.ResponseMemoAI,
		"has_response_memo":    strings.TrimSpace(d.ResponseMemo) != "",
		"response_approved_by": uuidPtrDetail(d.ResponseApprovedBy),
		"notification_date":    dateDetail(d.NotificationDate),
	}
}
