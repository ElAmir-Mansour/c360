package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/calendar"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

const (
	defaultSLADispatchProvider = "local"
	defaultSLADispatchLimit    = 100
	maxSLADispatchLimit        = 500
)

// SLAReminderNotificationDispatcher is the SLA-side delivery seam. It mirrors the
// obligation reminder dispatcher: a deterministic default for tests/dev and an
// HTTP adapter for production. The SLA module REUSES this seam shape rather than
// building a new channel layer.
type SLAReminderNotificationDispatcher interface {
	DispatchSLANotification(ctx context.Context, tenantID uuid.UUID, item model.SLANotificationOutboxItem, provider string, now time.Time) (*SLANotificationProviderDispatch, error)
}

// SLANotificationProviderDispatch is the normalized provider verdict.
type SLANotificationProviderDispatch struct {
	Status            model.SLANotificationOutboxStatus
	Provider          string
	ProviderStatus    string
	DeliveryStatus    string
	ProviderMessageID string
	ProviderMetadata  map[string]any
	ErrorMessage      string
}

// DeterministicSLANotificationDispatcher always accepts delivery; it is the
// fail-open default wired when no HTTP provider is configured.
type DeterministicSLANotificationDispatcher struct{}

func (DeterministicSLANotificationDispatcher) DispatchSLANotification(_ context.Context, tenantID uuid.UUID, item model.SLANotificationOutboxItem, provider string, now time.Time) (*SLANotificationProviderDispatch, error) {
	provider = normalizeSLADispatchProvider(provider)
	return &SLANotificationProviderDispatch{
		Status:         model.SLANotificationOutboxSent,
		Provider:       provider,
		ProviderStatus: "sent",
		DeliveryStatus: "accepted",
		ProviderMessageID: strings.Join([]string{
			"sla", string(item.EventType), item.ID.String(),
		}, ":"),
		ProviderMetadata: map[string]any{
			"provider_adapter":       "deterministic",
			"tenant_id":              tenantID.String(),
			"provider_dispatched_at": now.UTC().Format(time.RFC3339Nano),
		},
	}, nil
}

// HTTPSLANotificationDispatcherConfig configures the production HTTP dispatcher.
type HTTPSLANotificationDispatcherConfig struct {
	Endpoint string
	APIKey   string
	Timeout  time.Duration
	Client   *http.Client
}

// HTTPSLANotificationDispatcher POSTs SLA notifications to an external provider.
// It mirrors HTTPObligationReminderNotificationDispatcher (the shared dispatcher
// seam) so SLA delivery reuses the same provider contract rather than a new
// channel layer.
type HTTPSLANotificationDispatcher struct {
	endpoint string
	apiKey   string
	client   *http.Client
}

func NewHTTPSLANotificationDispatcher(cfg HTTPSLANotificationDispatcherConfig) (*HTTPSLANotificationDispatcher, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		return nil, validationError("sla notification provider endpoint is required", map[string]string{"endpoint": "required"})
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	if apiKey == "" {
		return nil, validationError("sla notification provider API key is required", map[string]string{"api_key": "required"})
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	} else if client.Timeout == 0 {
		dup := *client
		dup.Timeout = timeout
		client = &dup
	}
	return &HTTPSLANotificationDispatcher{endpoint: endpoint, apiKey: apiKey, client: client}, nil
}

func (d *HTTPSLANotificationDispatcher) DispatchSLANotification(ctx context.Context, tenantID uuid.UUID, item model.SLANotificationOutboxItem, provider string, now time.Time) (*SLANotificationProviderDispatch, error) {
	provider = normalizeSLADispatchProvider(provider)
	payload := map[string]any{
		"tenant_id":    tenantID.String(),
		"provider":     provider,
		"requested_at": now.UTC(),
		"outbox_item":  item,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, internalError("marshal sla notification provider dispatch", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, d.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, validationError("sla notification provider endpoint is invalid", map[string]string{"endpoint": "invalid"})
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+d.apiKey)
	httpReq.Header.Set("X-Clario360-Tenant-ID", tenantID.String())
	httpReq.Header.Set("X-Clario360-SLA-Notification-Provider", provider)

	resp, err := d.client.Do(httpReq)
	if err != nil {
		return nil, internalError("dispatch sla notification to HTTP provider", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, internalError("read sla notification provider response", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, internalError("sla notification provider rejected dispatch", fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody))))
	}
	var providerResp struct {
		Status            model.SLANotificationOutboxStatus `json:"status"`
		Provider          string                            `json:"provider"`
		ProviderStatus    string                            `json:"provider_status"`
		DeliveryStatus    string                            `json:"delivery_status"`
		ProviderMessageID string                            `json:"provider_message_id"`
		ProviderMetadata  map[string]any                    `json:"provider_metadata"`
		ErrorMessage      string                            `json:"error_message"`
	}
	if err := json.Unmarshal(respBody, &providerResp); err != nil {
		return nil, internalError("decode sla notification provider response", err)
	}
	dispatchProvider := strings.TrimSpace(providerResp.Provider)
	if dispatchProvider == "" {
		dispatchProvider = provider
	}
	return &SLANotificationProviderDispatch{
		Status:            providerResp.Status,
		Provider:          dispatchProvider,
		ProviderStatus:    strings.TrimSpace(providerResp.ProviderStatus),
		DeliveryStatus:    strings.TrimSpace(providerResp.DeliveryStatus),
		ProviderMessageID: strings.TrimSpace(providerResp.ProviderMessageID),
		ProviderMetadata: mergeMetadata(providerResp.ProviderMetadata, map[string]any{
			"provider_adapter":       "http",
			"provider_endpoint":      d.endpoint,
			"provider_dispatched_at": now.UTC().Format(time.RFC3339Nano),
		}),
		ErrorMessage: strings.TrimSpace(providerResp.ErrorMessage),
	}, nil
}

// SLAService owns SLA targets, clock materialisation, the ack/breach/escalation
// state machine, and outbox dispatch. It coordinates with Execution purely through
// the legal_requests spine and CloudEvents — no cross-package import.
type SLAService struct {
	db           *pgxpool.Pool
	targets      *repository.SLATargetRepository
	clocks       *repository.SLAClockRepository
	requests     *repository.LegalRequestRepository
	outbox       *repository.SLAOutboxRepository
	escalation   *EscalationService
	calendars    *slaBusinessCalendar
	publisher    Publisher
	metrics      *metrics.Metrics
	topic        string
	logger       zerolog.Logger
	now          func() time.Time
	dispatcher   SLAReminderNotificationDispatcher
	auditEmitter materialAuditEmitter
	slaMetrics   *SLAMetrics
}

// SetSLAMetrics wires the WS7 SLA lifecycle counters (clock_started/ack_overdue/
// breached/escalated/resolved). Nil-tolerant: when unset, every Record* helper is
// a no-op, so unit tests that construct the service without a registry still run.
func (s *SLAService) SetSLAMetrics(m *SLAMetrics) {
	s.slaMetrics = m
}

// slaWorkingMinutesImminenceWindow is the working-minute lead time within which an
// unsatisfied ack/turnaround/escalation rung is flagged "at risk"/"imminent" on the
// operations-board clock view (WS9). One working day == 8 working hours == 480
// working minutes; the default lead time is two working hours.
const slaWorkingMinutesImminenceWindow = 120

// SetAuditEmitter wires the LexAuditEmitter so material SLA clock lifecycle events
// (clock_started/acknowledged/breached/escalated/resolved) are relayed to the
// immutable audit_db ledger in addition to the in-tx append-only
// legal_sla_audit_log row. Nil-tolerant (ledger relay skipped).
func (s *SLAService) SetAuditEmitter(emitter materialAuditEmitter) {
	s.auditEmitter = emitter
}

// emitSLAAudit relays a material SLA-clock lifecycle event to the immutable
// ledger. The append-only legal_sla_audit_log row is the source of truth; this is
// a best-effort relay (never blocks/fails the mutation).
func (s *SLAService) emitSLAAudit(ctx context.Context, tenantID uuid.UUID, actor *uuid.UUID, clock model.SLAClock, action, severity string, detail map[string]any) {
	if s.auditEmitter == nil {
		return
	}
	if severity == "" {
		severity = "info"
	}
	merged := map[string]any{
		"legal_request_id": clock.LegalRequestID.String(),
		"service_code":     clock.ServiceCode,
	}
	for k, v := range detail {
		merged[k] = v
	}
	s.auditEmitter.Emit(ctx, LexAuditRecord{
		TenantID:     tenantID,
		ActorUserID:  actor,
		Action:       "sla_" + action,
		ResourceType: "legal_sla_clock",
		ResourceID:   clock.ID.String(),
		Severity:     severity,
		Detail:       merged,
	})
}

// newSLAAuditEntry builds an append-only SLA-clock audit row.
func newSLAAuditEntry(clock model.SLAClock, actor *uuid.UUID, action, from, to, reason string, level int, detail map[string]any) *model.LegalSLAAuditEntry {
	entry := &model.LegalSLAAuditEntry{
		ID:              uuid.New(),
		TenantID:        clock.TenantID,
		SLAClockID:      clock.ID,
		LegalRequestID:  clock.LegalRequestID,
		Action:          action,
		EscalationLevel: level,
		Detail:          detail,
		ActorUserID:     actor,
	}
	if from != "" {
		f := from
		entry.FromStatus = &f
	}
	if to != "" {
		t := to
		entry.ToStatus = &t
	}
	if reason != "" {
		r := reason
		entry.Reason = &r
	}
	return entry
}

func NewSLAService(
	db *pgxpool.Pool,
	targets *repository.SLATargetRepository,
	clocks *repository.SLAClockRepository,
	requests *repository.LegalRequestRepository,
	outbox *repository.SLAOutboxRepository,
	escalation *EscalationService,
	calendars *slaBusinessCalendar,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *SLAService {
	return &SLAService{
		db:         db,
		targets:    targets,
		clocks:     clocks,
		requests:   requests,
		outbox:     outbox,
		escalation: escalation,
		calendars:  calendars,
		publisher:  publisherOrNoop(publisher),
		metrics:    appMetrics,
		topic:      topic,
		logger:     logger.With().Str("service", "lex-sla").Logger(),
		now:        time.Now,
		dispatcher: DeterministicSLANotificationDispatcher{},
	}
}

// SetNotificationDispatcher swaps the delivery seam (HTTP provider in prod).
func (s *SLAService) SetNotificationDispatcher(dispatcher SLAReminderNotificationDispatcher) {
	if dispatcher == nil {
		s.dispatcher = DeterministicSLANotificationDispatcher{}
		return
	}
	s.dispatcher = dispatcher
}

// --- SLA target catalogue (admin CRUD) -------------------------------------

func (s *SLAService) CreateTarget(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateSLATargetRequest) (*model.SLATarget, error) {
	req.Normalize()
	if err := validateSLATargetCreate(req); err != nil {
		return nil, err
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	target := &model.SLATarget{
		ID:                        uuid.New(),
		TenantID:                  tenantID,
		ServiceCode:               req.ServiceCode,
		Priority:                  req.Priority,
		TurnaroundWorkingDaysFrom: req.TurnaroundWorkingDaysFrom,
		TurnaroundWorkingDays:     req.TurnaroundWorkingDays,
		AckWindowValue:            req.AckWindowValue,
		AckWindowUnit:             req.AckWindowUnit,
		EscalationL1Days:          req.EscalationL1Days,
		EscalationL2Days:          req.EscalationL2Days,
		EscalationL3Days:          req.EscalationL3Days,
		Active:                    active,
		Metadata:                  req.Metadata,
		CreatedBy:                 userID,
	}
	if err := s.targets.Create(ctx, s.db, target); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("an SLA target already exists for this service_code and priority")
		}
		return nil, internalError("create sla target", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.sla.target_created", tenantID, &userID, map[string]any{
		"id":           target.ID,
		"service_code": target.ServiceCode,
		"priority":     target.Priority,
	}, s.logger)
	return target, nil
}

func (s *SLAService) ListTargets(ctx context.Context, tenantID uuid.UUID, filters model.SLATargetListFilters) ([]model.SLATarget, int, error) {
	return s.targets.List(ctx, tenantID, filters)
}

func (s *SLAService) GetTarget(ctx context.Context, tenantID, id uuid.UUID) (*model.SLATarget, error) {
	target, err := s.targets.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("sla target not found")
		}
		return nil, internalError("load sla target", err)
	}
	return target, nil
}

func (s *SLAService) UpdateTarget(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateSLATargetRequest) (*model.SLATarget, error) {
	req.Normalize()
	target, err := s.targets.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("sla target not found")
		}
		return nil, internalError("load sla target", err)
	}
	applySLATargetUpdate(target, req)
	if err := validateSLATarget(target); err != nil {
		return nil, err
	}
	if err := s.targets.Update(ctx, s.db, target); err != nil {
		return nil, internalError("update sla target", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.sla.target_updated", tenantID, &userID, map[string]any{
		"id":           target.ID,
		"service_code": target.ServiceCode,
		"priority":     target.Priority,
		"active":       target.Active,
	}, s.logger)
	return s.GetTarget(ctx, tenantID, id)
}

func (s *SLAService) DeleteTarget(ctx context.Context, tenantID, id uuid.UUID) error {
	if err := s.targets.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("sla target not found")
		}
		return internalError("delete sla target", err)
	}
	return nil
}

// --- SLA clock lifecycle ----------------------------------------------------

// StartClock materialises the ack + turnaround + L1/L2/L3 escalation deadlines for
// a request whose completeness has been confirmed by Execution (CAP-012). All
// deadlines are computed with the frozen calendar.Calculator (C-1); a repeated
// signal for the same request is idempotent.
func (s *SLAService) StartClock(ctx context.Context, tenantID, userID uuid.UUID, req dto.StartSLAClockRequest) (*model.SLAClock, error) {
	req.Normalize()
	if req.LegalRequestID == uuid.Nil {
		return nil, validationError("legal_request_id is required", map[string]string{"legal_request_id": "required"})
	}
	if req.ServiceCode == "" {
		return nil, validationError("service_code is required", map[string]string{"service_code": "required"})
	}
	if !req.Priority.Valid() {
		return nil, validationError("invalid priority", map[string]string{"priority": "invalid"})
	}

	// Idempotency is now scoped to the LIVE clock, not to the request: a repeated
	// clock-start signal while the SLA is running returns the running clock, but a
	// start after the previous cycle was stopped by a return legitimately opens a
	// NEW cycle. That is the client's "a new SLA starts over when the requestor
	// sends the request back" — the restart needs no separate entry point.
	if existing, err := s.clocks.GetActiveByRequest(ctx, s.db, tenantID, req.LegalRequestID); err == nil {
		return existing, nil
	} else if err != pgx.ErrNoRows {
		return nil, internalError("check existing sla clock", err)
	}

	// The clock adopts the REQUEST's review round (000111) so the SLA cycle and the
	// conversation round are the same number everywhere they are shown. Falling
	// back to max(clock cycle)+1 keeps a request whose row predates the counter
	// (or is unreadable) from colliding with an existing (request, cycle) row.
	cycle, err := s.resolveClockCycle(ctx, tenantID, req.LegalRequestID)
	if err != nil {
		return nil, err
	}

	target, err := s.targets.Resolve(ctx, tenantID, req.ServiceCode, req.Priority)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, validationError("no active SLA target configured for this service_code and priority", map[string]string{"service_code": "not_configured"})
		}
		return nil, internalError("resolve sla target", err)
	}

	calc, err := s.calendars.Calculator(ctx, tenantID, req.CalendarID)
	if err != nil {
		return nil, err
	}

	startedAt := s.now().UTC()
	if req.StartedAt != nil {
		startedAt = req.StartedAt.UTC()
	}
	deadlines := materialiseSLADeadlines(calc, startedAt, target)

	clock := &model.SLAClock{
		ID:                  uuid.New(),
		TenantID:            tenantID,
		LegalRequestID:      req.LegalRequestID,
		SLATargetID:         &target.ID,
		ServiceCode:         target.ServiceCode,
		Priority:            target.Priority,
		BeneficiaryEntityID: req.BeneficiaryEntityID,
		ClockStartedAt:      startedAt,
		AckDueAt:            deadlines.AckDueAt,
		TurnaroundFromDueAt: turnaroundFromDuePtr(deadlines),
		TurnaroundDueAt:     deadlines.TurnaroundDueAt,
		EscalationL1DueAt:   deadlines.L1DueAt,
		EscalationL2DueAt:   deadlines.L2DueAt,
		EscalationL3DueAt:   deadlines.L3DueAt,
		AckDone:             false,
		EscalationLevel:     0,
		Breached:            false,
		Outcome:             model.SLAClockOutcomePending,
		Cycle:               cycle,
		Metadata:            req.Metadata,
		CreatedBy:           userID,
	}
	// Materialise the clock AND append the append-only audit row in one
	// transaction so the clock and its immutable trail commit atomically. Create
	// is ON CONFLICT DO NOTHING (returns pgx.ErrNoRows on a lost race); in that
	// case no audit row is written and the winning row is returned.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start sla clock transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.clocks.Create(ctx, tx, clock); err != nil {
		if err == pgx.ErrNoRows {
			// Lost a materialisation race; return the row that won. The winner is
			// by definition the live clock — the partial unique index on
			// outcome = 'pending' guarantees there is at most one.
			if existing, getErr := s.clocks.GetActiveByRequest(ctx, s.db, tenantID, req.LegalRequestID); getErr == nil {
				return existing, nil
			}
		}
		return nil, internalError("materialise sla clock", err)
	}
	startDetail := map[string]any{
		"priority":          string(clock.Priority),
		"ack_due_at":        clock.AckDueAt.UTC().Format(time.RFC3339Nano),
		"turnaround_due_at": clock.TurnaroundDueAt.UTC().Format(time.RFC3339Nano),
	}
	if err := s.clocks.AppendAudit(ctx, tx, newSLAAuditEntry(*clock, actorPtr(userID), "clock_started", string(model.SLAClockOutcomePending), string(model.SLAClockOutcomePending), "completeness confirmed", 0, startDetail)); err != nil {
		return nil, internalError("record sla clock_started audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit sla clock materialisation", err)
	}
	s.slaMetrics.RecordClockStarted()
	s.emitSLAAudit(ctx, tenantID, actorPtr(userID), *clock, "clock_started", "info", startDetail)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.sla.clock_started", tenantID, &userID, map[string]any{
		"id":                clock.ID,
		"legal_request_id":  clock.LegalRequestID,
		"service_code":      clock.ServiceCode,
		"priority":          clock.Priority,
		"ack_due_at":        clock.AckDueAt,
		"turnaround_due_at": clock.TurnaroundDueAt,
	}, s.logger)
	return clock, nil
}

// resolveClockCycle returns the review round the next clock belongs to.
//
// The request's own counter is authoritative (000111): it advances on every
// returned→submitted resubmission and is what notes and attachments are stamped
// with, so adopting it keeps "SLA cycle 2" and "round 2 of the conversation" the
// same number. If that round already has a clock — or the request row cannot be
// read — fall back to one past the highest clock cycle so the unique
// (request, cycle) index can never be violated.
func (s *SLAService) resolveClockCycle(ctx context.Context, tenantID, legalRequestID uuid.UUID) (int, error) {
	maxClockCycle, err := s.clocks.MaxCycle(ctx, s.db, tenantID, legalRequestID)
	if err != nil {
		return 0, internalError("resolve sla clock cycle", err)
	}

	var requestCycle int
	err = s.db.QueryRow(ctx,
		`SELECT cycle FROM legal_requests WHERE tenant_id = $1 AND id = $2`,
		tenantID, legalRequestID,
	).Scan(&requestCycle)
	if err != nil && err != pgx.ErrNoRows {
		return 0, internalError("load request review round", err)
	}

	if err == nil && requestCycle > maxClockCycle {
		return requestCycle, nil
	}
	return maxClockCycle + 1, nil
}

// StopClockForRequest halts the running SLA cycle because the request was
// RETURNED to the requester (client feedback, Requests Page: "The SLA stops if
// the request is returned to the requestor").
//
// The cycle terminates as 'stopped' — deliberately neither on_time nor breached.
// The department did not deliver, but it also did not miss a deadline it still
// controlled, so folding the cycle into either aggregate would misstate SLA
// compliance. Stopped cycles are excluded from every outcome count.
//
// The clock is not resolved (resolved_at stays NULL) and the row is retained, so
// "this request was bounced twice, and here is what each round cost" stays
// answerable. When the requester resubmits, StartClock opens the next cycle with
// deadlines materialised afresh from the resubmission instant.
//
// Idempotent and total: a request with no running clock — never started, already
// delivered, or already stopped — is a no-op returning (nil, nil), so the
// transition hook can call this on every return without inspecting SLA state.
func (s *SLAService) StopClockForRequest(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID, stoppedAt time.Time) (*model.SLAClock, error) {
	if legalRequestID == uuid.Nil {
		return nil, validationError("legal_request_id is required", map[string]string{"legal_request_id": "required"})
	}
	if stoppedAt.IsZero() {
		stoppedAt = s.now().UTC()
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("stop sla clock transaction", err)
	}
	defer tx.Rollback(ctx)

	clock, err := s.clocks.StopActiveForRequest(ctx, tx, tenantID, legalRequestID, stoppedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, internalError("stop sla clock", err)
	}

	stopDetail := map[string]any{
		"cycle":             clock.Cycle,
		"stopped_at":        stoppedAt.UTC().Format(time.RFC3339Nano),
		"turnaround_due_at": clock.TurnaroundDueAt.UTC().Format(time.RFC3339Nano),
		"reason":            "returned_to_requester",
	}
	if err := s.clocks.AppendAudit(ctx, tx, newSLAAuditEntry(*clock, actorPtr(userID), "clock_stopped",
		string(model.SLAClockOutcomePending), string(model.SLAClockOutcomeStopped),
		"returned to requester", clock.EscalationLevel, stopDetail)); err != nil {
		return nil, internalError("record sla clock_stopped audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit sla clock stop", err)
	}

	s.emitSLAAudit(ctx, tenantID, actorPtr(userID), *clock, "clock_stopped", "info", stopDetail)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.sla.clock_stopped", tenantID, &userID, map[string]any{
		"id":               clock.ID,
		"legal_request_id": clock.LegalRequestID,
		"cycle":            clock.Cycle,
		"service_code":     clock.ServiceCode,
		"stopped_at":       stoppedAt,
	}, s.logger)
	return clock, nil
}

// ResolveClockForRequest closes the SLA clock for a delivered/closed request with
// its terminal on_time/breached verdict (the >=90% quarterly KPI is computed off
// these resolved outcomes; without this call the clock never leaves 'pending' and
// the KPI is structurally 0%). It is invoked in-process by Execution's delivery
// path (DeliveryConfirmationService) via the SLAResolver seam — no cross-package
// import, the two domains still coordinate through legal_requests + events.
//
// The outcome is computed against the FROZEN calendar (C-1): delivered on or before
// the materialised turnaround_due_at is on_time, otherwise breached. It is
// idempotent: SLAClockRepository.Resolve guards on resolved_at IS NULL, so a second
// delivery signal returns the already-resolved clock without re-emitting. A request
// with no clock (completeness never confirmed) is a no-op (nil, nil).
func (s *SLAService) ResolveClockForRequest(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID, deliveredAt time.Time) (*model.SLAClock, error) {
	if legalRequestID == uuid.Nil {
		return nil, validationError("legal_request_id is required", map[string]string{"legal_request_id": "required"})
	}
	// The LIVE cycle only. A request delivered after a return must resolve the
	// cycle that was actually running (the resubmission), never a cycle already
	// stopped when the request was handed back — resolving a stopped cycle would
	// judge the department against a deadline that stopped applying.
	clock, err := s.clocks.GetActiveByRequest(ctx, s.db, tenantID, legalRequestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			// No running clock: never materialised, already resolved, or stopped
			// pending a resubmission. Nothing to resolve.
			return nil, nil
		}
		return nil, internalError("load sla clock for resolution", err)
	}
	if clock.ResolvedAt != nil {
		// Already terminal — idempotent no-op.
		return clock, nil
	}

	resolvedAt := deliveredAt.UTC()
	if resolvedAt.IsZero() {
		resolvedAt = s.now().UTC()
	}

	outcome := model.SLAClockOutcomeOnTime
	if resolvedAt.After(clock.TurnaroundDueAt) {
		outcome = model.SLAClockOutcomeBreached
	}

	// sla_target_minutes is the working-minute budget between clock start and the
	// materialised turnaround deadline, computed off the same calendar that
	// materialised the clock so the KPI denominator is calendar-consistent.
	targetMinutes := 0
	if calc, cerr := s.calendars.Calculator(ctx, tenantID, slaCalendarIDFromMetadata(clock.Metadata)); cerr == nil && calc != nil {
		targetMinutes = calc.WorkingMinutesBetween(clock.ClockStartedAt, clock.TurnaroundDueAt)
	}

	// Resolve the clock AND append the append-only audit row in one transaction.
	// Resolve guards on resolved_at IS NULL (returns nil updated on a lost race);
	// in that case no audit row is written and the winning row is returned.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start sla resolve transaction", err)
	}
	defer tx.Rollback(ctx)
	updated, err := s.clocks.Resolve(ctx, tx, tenantID, clock.ID, outcome, resolvedAt)
	if err != nil {
		return nil, internalError("resolve sla clock", err)
	}
	if updated == nil {
		// Lost the resolution race (a concurrent delivery already resolved it):
		// return the winning row.
		if existing, gerr := s.clocks.GetByRequest(ctx, s.db, tenantID, legalRequestID); gerr == nil {
			return existing, nil
		}
		return clock, nil
	}
	resolveDetail := map[string]any{
		"sla_outcome":        string(outcome),
		"sla_target_minutes": targetMinutes,
		"resolved_at":        resolvedAt.UTC().Format(time.RFC3339Nano),
	}
	if err := s.clocks.AppendAudit(ctx, tx, newSLAAuditEntry(*updated, actorPtr(userID), "resolved", string(model.SLAClockOutcomePending), string(outcome), "", updated.EscalationLevel, resolveDetail)); err != nil {
		return nil, internalError("record sla resolved audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit sla resolution", err)
	}

	uid := userID
	var actor *uuid.UUID
	if uid != uuid.Nil {
		actor = &uid
	}
	severity := "info"
	if outcome == model.SLAClockOutcomeBreached {
		severity = "warning"
	}
	s.slaMetrics.RecordResolved(outcome)
	s.emitSLAAudit(ctx, tenantID, actor, *updated, "resolved", severity, resolveDetail)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.sla.resolved", tenantID, actor, map[string]any{
		"id":                 updated.ID,
		"legal_request_id":   updated.LegalRequestID,
		"service_code":       updated.ServiceCode,
		"priority":           updated.Priority,
		"sla_outcome":        string(outcome),
		"sla_target_minutes": targetMinutes,
		"turnaround_due_at":  updated.TurnaroundDueAt,
		"resolved_at":        updated.ResolvedAt,
	}, s.logger)
	return updated, nil
}

// slaCalendarIDFromMetadata reads the working-calendar id StartClock stamped onto
// the clock metadata, so resolution measures the target budget against the SAME
// calendar that materialised the deadlines. Returns nil (tenant default) when
// absent.
func slaCalendarIDFromMetadata(metadata map[string]any) *uuid.UUID {
	if id, ok := uuidFromMetadata(metadata, "working_calendar_id"); ok {
		return &id
	}
	return nil
}

func (s *SLAService) GetClock(ctx context.Context, tenantID, id uuid.UUID) (*model.SLAClock, error) {
	clock, err := s.clocks.Get(ctx, s.db, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("sla clock not found")
		}
		return nil, internalError("load sla clock", err)
	}
	return clock, nil
}

func (s *SLAService) GetClockByRequest(ctx context.Context, tenantID, legalRequestID uuid.UUID) (*model.SLAClock, error) {
	clock, err := s.clocks.GetByRequest(ctx, s.db, tenantID, legalRequestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			if s.requests != nil {
				if _, requestErr := s.requests.Get(ctx, tenantID, legalRequestID); requestErr != nil {
					if requestErr == pgx.ErrNoRows {
						return nil, notFoundError("legal request not found")
					}
					return nil, internalError("load legal request", requestErr)
				}
			}
			return nil, nil
		}
		return nil, internalError("load sla clock", err)
	}
	return clock, nil
}

// ListClockViews returns a paginated, computed operations-board projection of SLA
// clocks for a tenant (WS9). Each row is a model.SLAClock decorated with
// working-time-remaining, the next escalation rung/recipient, and ack-risk /
// breach-imminent flags, all evaluated against the SAME frozen working calendar
// (C-1) that materialised the clock so the board agrees with the monitor.
//
// The default scope is unresolved clocks; IncludeResolved widens it to history.
// Filters (outcome, breached, escalation_level, service_code, priority,
// due-before) compose with AND. The query is read-only and built with bound
// parameters; only the sort column/direction (validated against an allowlist by
// the handler) are interpolated.
func (s *SLAService) ListClockViews(ctx context.Context, tenantID uuid.UUID, filters dto.SLAClockListFilters) ([]dto.SLAClockView, int, error) {
	clocks, total, err := s.listClocks(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, err
	}
	asOf := s.now().UTC()
	views := make([]dto.SLAClockView, 0, len(clocks))
	for i := range clocks {
		views = append(views, s.buildClockView(ctx, tenantID, clocks[i], asOf))
	}
	return views, total, nil
}

func (s *SLAService) listClocks(ctx context.Context, tenantID uuid.UUID, filters dto.SLAClockListFilters) ([]model.SLAClock, int, error) {
	page := filters.Page
	if page < 1 {
		page = 1
	}
	perPage := filters.PerPage
	if perPage < 1 {
		perPage = 25
	}

	where := []string{"c.tenant_id = $1"}
	args := []any{tenantID}
	if !filters.IncludeResolved {
		where = append(where, "c.resolved_at IS NULL")
	}
	if filters.Outcome != nil {
		args = append(args, string(*filters.Outcome))
		where = append(where, fmt.Sprintf("c.outcome = $%d", len(args)))
	}
	if filters.Breached != nil {
		args = append(args, *filters.Breached)
		where = append(where, fmt.Sprintf("c.breached = $%d", len(args)))
	}
	if filters.EscalationLevel != nil {
		args = append(args, *filters.EscalationLevel)
		where = append(where, fmt.Sprintf("c.escalation_level = $%d", len(args)))
	}
	if strings.TrimSpace(filters.ServiceCode) != "" {
		args = append(args, strings.TrimSpace(filters.ServiceCode))
		where = append(where, fmt.Sprintf("c.service_code = $%d", len(args)))
	}
	if filters.Priority != nil {
		args = append(args, string(*filters.Priority))
		where = append(where, fmt.Sprintf("c.priority = $%d", len(args)))
	}
	if filters.DueBefore != nil {
		args = append(args, filters.DueBefore.UTC())
		where = append(where, fmt.Sprintf("c.turnaround_due_at <= $%d", len(args)))
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	if err := s.db.QueryRow(ctx, "SELECT count(*) FROM legal_sla_clocks c WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, internalError("count sla clocks", err)
	}
	if total == 0 {
		return nil, 0, nil
	}

	sortCol := filters.SortColumn
	if sortCol == "" {
		sortCol = "turnaround_due_at"
	}
	sortDir := strings.ToUpper(filters.SortDirection)
	if sortDir != "ASC" && sortDir != "DESC" {
		sortDir = "ASC"
	}
	limitArg := len(args) + 1
	offsetArg := len(args) + 2
	args = append(args, perPage, (page-1)*perPage)

	query := fmt.Sprintf(`
		SELECT row_to_json(t)
		FROM (
			SELECT c.id, c.tenant_id, c.legal_request_id, c.sla_target_id, c.service_code, c.priority,
			       c.beneficiary_entity_id, c.clock_started_at, c.ack_due_at,
			       c.turnaround_from_due_at, c.turnaround_due_at,
			       c.escalation_l1_due_at, c.escalation_l2_due_at, c.escalation_l3_due_at,
			       c.ack_done, c.ack_done_at, c.escalation_level, c.breached, c.breached_at, c.outcome,
			       c.resolved_at, COALESCE(c.metadata, '{}'::jsonb) AS metadata,
			       c.created_by, c.created_at, c.updated_at
			FROM legal_sla_clocks c
			WHERE %s
			ORDER BY c.%s %s, c.created_at ASC
			LIMIT $%d OFFSET $%d
		) t`, whereSQL, sortCol, sortDir, limitArg, offsetArg)

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, internalError("list sla clocks", err)
	}
	defer rows.Close()
	clocks := make([]model.SLAClock, 0, perPage)
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, 0, internalError("scan sla clock row", err)
		}
		var clock model.SLAClock
		if err := json.Unmarshal(raw, &clock); err != nil {
			return nil, 0, internalError("decode sla clock row", err)
		}
		clocks = append(clocks, clock)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, internalError("iterate sla clock rows", err)
	}
	return clocks, total, nil
}

// buildClockView decorates a raw clock with the computed operations-board fields.
// Working-time remaining is measured on the clock's own calendar; when the
// calendar cannot be resolved the countdown fields are omitted (nil) rather than
// guessed, but the deadline-derived risk flags still fire off wall-clock
// comparisons so a board never hides an overdue clock.
func (s *SLAService) buildClockView(ctx context.Context, tenantID uuid.UUID, clock model.SLAClock, asOf time.Time) dto.SLAClockView {
	view := dto.SLAClockView{SLAClock: clock, EvaluatedAt: asOf}

	resolved := clock.ResolvedAt != nil

	var calc calendar.Calculator
	if s.calendars != nil {
		if c, err := s.calendars.Calculator(ctx, tenantID, slaCalendarIDFromMetadata(clock.Metadata)); err == nil {
			calc = c
		}
	}

	// Ack countdown + risk: only meaningful while the ack rung is unsatisfied and
	// the clock is live.
	if !clock.AckDone && !resolved {
		view.AckOverdue = !asOf.Before(clock.AckDueAt)
		if !view.AckOverdue {
			if calc != nil {
				rem := calc.WorkingMinutesBetween(asOf, clock.AckDueAt)
				view.AckWorkingMinutesRemaining = &rem
				view.AckRisk = rem <= slaWorkingMinutesImminenceWindow
			} else {
				view.AckRisk = asOf.Add(slaWorkingMinutesImminenceWindow*time.Minute).After(clock.AckDueAt) || asOf.Add(slaWorkingMinutesImminenceWindow*time.Minute).Equal(clock.AckDueAt)
			}
		} else if calc != nil {
			zero := 0
			view.AckWorkingMinutesRemaining = &zero
		}
	}

	// Turnaround countdown + breach imminence: only while unbreached + live.
	if !clock.Breached && !resolved {
		if calc != nil {
			rem := calc.WorkingMinutesBetween(asOf, clock.TurnaroundDueAt)
			view.TurnaroundWorkingMinutesRemaining = &rem
			view.BreachImminent = rem <= slaWorkingMinutesImminenceWindow
			// Earliest-promise (From) countdown of the From–To window: display-only,
			// measured on the same frozen calendar. Only meaningful when the From
			// instant is set and still ahead of the To deadline (a distinct window).
			if clock.TurnaroundFromDueAt != nil && clock.TurnaroundFromDueAt.Before(clock.TurnaroundDueAt) {
				fromRem := calc.WorkingMinutesBetween(asOf, *clock.TurnaroundFromDueAt)
				view.TurnaroundFromWorkingMinutesRemaining = &fromRem
			}
		} else {
			view.BreachImminent = asOf.Add(slaWorkingMinutesImminenceWindow*time.Minute).After(clock.TurnaroundDueAt) || asOf.Add(slaWorkingMinutesImminenceWindow*time.Minute).Equal(clock.TurnaroundDueAt)
		}
	}

	// Next escalation rung (current level + 1, up to L3) once the clock is live.
	if !resolved && clock.EscalationLevel < 3 {
		nextLevel := clock.EscalationLevel + 1
		due := slaEscalationDueForLevel(clock, nextLevel)
		view.NextEscalationLevel = &nextLevel
		if !due.IsZero() {
			d := due
			view.NextEscalationDueAt = &d
			if calc != nil {
				view.EscalationImminent = calc.WorkingMinutesBetween(asOf, due) <= slaWorkingMinutesImminenceWindow
			} else {
				view.EscalationImminent = asOf.Add(slaWorkingMinutesImminenceWindow*time.Minute).After(due) || asOf.Add(slaWorkingMinutesImminenceWindow*time.Minute).Equal(due)
			}
		}
		// The next recipient is only resolvable (and only fires) after breach,
		// since pre-breach escalation rungs have not started running.
		if clock.Breached {
			if ladder := s.resolveEscalationRecipients(ctx, tenantID, &clock); ladder != nil {
				for _, recipient := range ladder.Recipients {
					if recipient.Level == nextLevel {
						view.NextEscalationRecipient = recipient.Label.Localize("en")
						break
					}
				}
			}
		}
	}

	return view
}

func slaEscalationDueForLevel(clock model.SLAClock, level int) time.Time {
	switch level {
	case 1:
		return clock.EscalationL1DueAt
	case 2:
		return clock.EscalationL2DueAt
	case 3:
		return clock.EscalationL3DueAt
	default:
		return time.Time{}
	}
}

// Acknowledge records the acknowledgement of a request, satisfying the ack rung.
func (s *SLAService) Acknowledge(ctx context.Context, tenantID, userID, clockID uuid.UUID, req dto.AcknowledgeSLAClockRequest) (*model.SLAClock, error) {
	req.Normalize()
	ackedAt := s.now().UTC()
	if req.AcknowledgedAt != nil {
		ackedAt = req.AcknowledgedAt.UTC()
	}
	// Mark the ack rung AND append the append-only audit row in one transaction.
	// MarkAck guards on ack_done = false (returns nil on a repeated ack); in that
	// case no audit row is written and the current state is returned.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start sla acknowledge transaction", err)
	}
	defer tx.Rollback(ctx)
	updated, err := s.clocks.MarkAck(ctx, tx, tenantID, clockID, ackedAt)
	if err != nil {
		return nil, internalError("acknowledge sla clock", err)
	}
	if updated == nil {
		// Either not found or already acknowledged: load the current state.
		return s.GetClock(ctx, tenantID, clockID)
	}
	ackDetail := map[string]any{}
	if updated.AckDoneAt != nil {
		ackDetail["ack_done_at"] = updated.AckDoneAt.UTC().Format(time.RFC3339Nano)
	}
	if err := s.clocks.AppendAudit(ctx, tx, newSLAAuditEntry(*updated, actorPtr(userID), "acknowledged", "false", "true", "", updated.EscalationLevel, ackDetail)); err != nil {
		return nil, internalError("record sla acknowledged audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit sla acknowledgement", err)
	}
	s.emitSLAAudit(ctx, tenantID, actorPtr(userID), *updated, "acknowledged", "info", ackDetail)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.sla.acknowledged", tenantID, &userID, map[string]any{
		"id":               updated.ID,
		"legal_request_id": updated.LegalRequestID,
		"ack_done_at":      updated.AckDoneAt,
	}, s.logger)
	return updated, nil
}

// TriggerEscalation forces an escalation to the requested rung (manual override of
// the monitor ladder), enqueues the escalation notification, and emits the event.
func (s *SLAService) TriggerEscalation(ctx context.Context, tenantID, userID, clockID uuid.UUID, req dto.TriggerSLAEscalationRequest) (*model.SLAClock, error) {
	req.Normalize()
	if req.Level < 1 || req.Level > 3 {
		return nil, validationError("escalation level must be 1, 2 or 3", map[string]string{"level": "out_of_range"})
	}
	clock, err := s.clocks.Get(ctx, s.db, tenantID, clockID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("sla clock not found")
		}
		return nil, internalError("load sla clock", err)
	}
	recipients := s.resolveEscalationRecipients(ctx, tenantID, clock)
	updated, _, err := s.advanceEscalationAndEnqueue(ctx, tenantID, clockID, req.Level, recipients, userID)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		// Already at or above the requested rung: no-op, return current.
		return clock, nil
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.sla.escalated", tenantID, &userID, slaEscalationEventPayload(*updated, req.Level, true, req.Note, recipients), s.logger)
	return updated, nil
}

// --- outbox dispatch (shared dispatcher seam) -------------------------------

func (s *SLAService) DispatchOutbox(ctx context.Context, tenantID, userID uuid.UUID, req dto.DispatchSLAOutboxRequest) (*model.SLAOutboxDispatchResult, error) {
	req.Normalize()
	limit, err := normalizeSLADispatchLimit(req.Limit)
	if err != nil {
		return nil, err
	}
	asOf := s.now().UTC()
	if req.AsOf != nil {
		asOf = req.AsOf.UTC()
	}
	provider := normalizeSLADispatchProvider(req.Provider)
	items, err := s.outbox.ListDispatchCandidates(ctx, tenantID, asOf, limit, req.Retry)
	if err != nil {
		return nil, internalError("list sla outbox dispatch candidates", err)
	}
	result, err := s.dispatchOutboxItems(ctx, tenantID, userID, provider, req.Retry, items)
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.sla.outbox_dispatched", tenantID, &userID, map[string]any{
		"provider":         result.Provider,
		"retry":            result.Retry,
		"requested_count":  result.RequestedCount,
		"dispatched_count": result.DispatchedCount,
		"sent_count":       result.SentCount,
		"failed_count":     result.FailedCount,
		"skipped_count":    result.SkippedCount,
	}, s.logger)
	return result, nil
}

func (s *SLAService) dispatchOutboxItems(ctx context.Context, tenantID, userID uuid.UUID, provider string, retry bool, items []model.SLANotificationOutboxItem) (*model.SLAOutboxDispatchResult, error) {
	result := &model.SLAOutboxDispatchResult{
		Provider:       provider,
		Retry:          retry,
		RequestedCount: len(items),
		Attempts:       []model.SLAOutboxDispatchAttempt{},
	}
	for _, item := range items {
		attempt, err := s.dispatchOutboxItem(ctx, tenantID, provider, retry, item)
		if err != nil {
			return nil, err
		}
		result.Attempts = append(result.Attempts, attempt)
		switch {
		case attempt.SkippedReason != "":
			result.SkippedCount++
		case attempt.Status == model.SLANotificationOutboxSent:
			result.DispatchedCount++
			result.SentCount++
		case attempt.Status == model.SLANotificationOutboxFailed:
			result.DispatchedCount++
			result.FailedCount++
		}
	}
	return result, nil
}

func (s *SLAService) dispatchOutboxItem(ctx context.Context, tenantID uuid.UUID, provider string, retry bool, item model.SLANotificationOutboxItem) (model.SLAOutboxDispatchAttempt, error) {
	attempt := model.SLAOutboxDispatchAttempt{
		OutboxID:       item.ID,
		SLAClockID:     item.SLAClockID,
		EventType:      item.EventType,
		Channel:        item.Channel,
		PreviousStatus: item.Status,
		Status:         item.Status,
		Provider:       provider,
	}
	if reason := slaDispatchSkipReason(item.Status, retry); reason != "" {
		attempt.SkippedReason = reason
		return attempt, nil
	}

	dispatcher := s.dispatcher
	if dispatcher == nil {
		dispatcher = DeterministicSLANotificationDispatcher{}
	}
	attemptedAt := s.now().UTC()
	dispatch, derr := dispatcher.DispatchSLANotification(ctx, tenantID, item, provider, attemptedAt)

	var (
		status            model.SLANotificationOutboxStatus
		appliedProvider   = normalizeSLADispatchProvider(provider)
		providerMessageID *string
		providerMetadata  map[string]any
		errorMessage      *string
	)
	if derr != nil {
		status = model.SLANotificationOutboxFailed
		msg := derr.Error()
		errorMessage = &msg
		providerMetadata = map[string]any{"provider_error": msg}
	} else {
		status = dispatch.Status
		if strings.TrimSpace(dispatch.Provider) != "" {
			appliedProvider = strings.TrimSpace(dispatch.Provider)
		}
		if strings.TrimSpace(dispatch.ProviderMessageID) != "" {
			id := strings.TrimSpace(dispatch.ProviderMessageID)
			providerMessageID = &id
		}
		providerMetadata = dispatch.ProviderMetadata
		if strings.TrimSpace(dispatch.ErrorMessage) != "" {
			msg := strings.TrimSpace(dispatch.ErrorMessage)
			errorMessage = &msg
		}
	}

	recorded, err := s.outbox.MarkDelivery(ctx, s.db, tenantID, item.ID, status, attemptedAt, appliedProvider, providerMessageID, providerMetadata, errorMessage)
	if err != nil {
		return model.SLAOutboxDispatchAttempt{}, internalError("record sla outbox delivery", err)
	}
	if recorded == nil {
		// MarkDelivery now guards on status IN (pending,failed): 0 rows means a
		// concurrent pass already delivered this row (it is terminal 'sent'), or it
		// was deleted out from under us. Treat as a lost-race skip, not a hard error,
		// so the dispatcher stays idempotent under concurrency.
		attempt.SkippedReason = "lost_dispatch_race"
		attempt.Status = item.Status
		return attempt, nil
	}
	attempt.Status = recorded.Status
	attempt.Provider = recorded.Provider
	attempt.ProviderMessageID = recorded.ProviderMessageID
	attempt.ProviderMetadata = recorded.ProviderMetadata
	attempt.ErrorMessage = recorded.ErrorMessage
	attempt.Item = recorded
	return attempt, nil
}

// --- monitor entry points ---------------------------------------------------

var slaMonitorActorID = uuid.MustParse("00000000-0000-0000-0000-000000000001")

// ListTenantIDs is the cross-tenant fan-out source for the monitor.
func (s *SLAService) ListTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	return s.clocks.ListTenantIDs(ctx)
}

// SLAMonitorTenantResult summarises one tenant's processing pass.
type SLAMonitorTenantResult struct {
	ScannedClocks    int
	AckQueued        int
	BreachQueued     int
	EscalationQueued int
}

// ProcessDueClocks scans a tenant's unresolved clocks as of asOf and applies the
// idempotent ack/breach/escalation state machine, enqueueing outbox rows and
// emitting com.clario360.lex.sla.* events. Delivery itself is performed separately
// by DispatchOutbox via the shared dispatcher seam.
func (s *SLAService) ProcessDueClocks(ctx context.Context, tenantID uuid.UUID, asOf time.Time, limit int) (SLAMonitorTenantResult, error) {
	asOf = asOf.UTC()
	clocks, err := s.clocks.ListDue(ctx, tenantID, asOf, limit)
	if err != nil {
		return SLAMonitorTenantResult{}, internalError("list due sla clocks", err)
	}
	result := SLAMonitorTenantResult{ScannedClocks: len(clocks)}
	for _, clock := range clocks {
		n, err := s.processClock(ctx, tenantID, clock, asOf)
		if err != nil {
			return result, err
		}
		result.AckQueued += n.AckQueued
		result.BreachQueued += n.BreachQueued
		result.EscalationQueued += n.EscalationQueued
	}
	return result, nil
}

func (s *SLAService) processClock(ctx context.Context, tenantID uuid.UUID, clock model.SLAClock, asOf time.Time) (SLAMonitorTenantResult, error) {
	var result SLAMonitorTenantResult

	// Ack rung: lapsed without acknowledgement.
	if !clock.AckDone && !asOf.Before(clock.AckDueAt) {
		queued, err := s.enqueueAckOutbox(ctx, s.db, clock, slaMonitorActorID)
		if err != nil {
			return result, err
		}
		if len(queued) > 0 {
			result.AckQueued += len(queued)
			s.slaMetrics.RecordAckOverdue()
			ackPayload := map[string]any{
				"id":               clock.ID,
				"legal_request_id": clock.LegalRequestID,
				"ack_due_at":       clock.AckDueAt,
			}
			addSLARecipientToPayload(ackPayload, queued[0], &clock)
			writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.sla.ack_overdue", tenantID, nil, ackPayload, s.logger)
		}
	}

	// Turnaround rung: breach.
	if !clock.Breached && !asOf.Before(clock.TurnaroundDueAt) {
		updated, queued, err := s.markBreachedAndEnqueue(ctx, tenantID, clock, asOf, slaMonitorActorID)
		if err != nil {
			return result, err
		}
		if updated != nil {
			clock = *updated
			result.BreachQueued += len(queued)
			breachPayload := map[string]any{
				"id":                clock.ID,
				"legal_request_id":  clock.LegalRequestID,
				"turnaround_due_at": clock.TurnaroundDueAt,
				"breached_at":       clock.BreachedAt,
			}
			if len(queued) > 0 {
				addSLARecipientToPayload(breachPayload, queued[0], &clock)
			} else {
				addSLARecipientToPayload(breachPayload, model.SLANotificationOutboxItem{}, &clock)
			}
			writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.sla.breached", tenantID, nil, breachPayload, s.logger)
		}
	}

	// Escalation rungs: after breach, advance each due rung once. A late sweep may
	// legitimately enqueue multiple missed rungs, but never duplicates a level.
	if clock.Breached {
		ladder := s.resolveEscalationRecipients(ctx, tenantID, &clock)
		for _, rung := range []struct {
			level int
			due   time.Time
		}{
			{1, clock.EscalationL1DueAt},
			{2, clock.EscalationL2DueAt},
			{3, clock.EscalationL3DueAt},
		} {
			if clock.EscalationLevel >= rung.level || asOf.Before(rung.due) {
				continue
			}
			updated, queued, err := s.advanceEscalationAndEnqueue(ctx, tenantID, clock.ID, rung.level, ladder, slaMonitorActorID)
			if err != nil {
				return result, err
			}
			if updated == nil {
				continue
			}
			clock = *updated
			if len(queued) > 0 {
				result.EscalationQueued += len(queued)
				writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.sla.escalated", tenantID, nil, slaEscalationEventPayload(clock, rung.level, false, "", ladder), s.logger)
			}
		}
	}
	return result, nil
}

// --- shared internals reused by the monitor ---------------------------------

func (s *SLAService) markBreachedAndEnqueue(ctx context.Context, tenantID uuid.UUID, clock model.SLAClock, breachedAt time.Time, userID uuid.UUID) (*model.SLAClock, []model.SLANotificationOutboxItem, error) {
	if s.db == nil {
		return nil, nil, internalError("start sla breach transaction", fmt.Errorf("database is not configured"))
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, internalError("start sla breach transaction", err)
	}
	defer tx.Rollback(ctx)

	updated, err := s.clocks.MarkBreached(ctx, tx, tenantID, clock.ID, breachedAt)
	if err != nil {
		return nil, nil, internalError("mark sla clock breached", err)
	}
	if updated == nil {
		if err := tx.Commit(ctx); err != nil {
			return nil, nil, internalError("commit sla breach transaction", err)
		}
		return nil, nil, nil
	}
	queued, err := s.enqueueBreachOutbox(ctx, tx, *updated, userID)
	if err != nil {
		return nil, nil, err
	}
	breachDetail := map[string]any{
		"turnaround_due_at": updated.TurnaroundDueAt.UTC().Format(time.RFC3339Nano),
	}
	if updated.BreachedAt != nil {
		breachDetail["breached_at"] = updated.BreachedAt.UTC().Format(time.RFC3339Nano)
	}
	if err := s.clocks.AppendAudit(ctx, tx, newSLAAuditEntry(*updated, actorPtr(userID), "breached", "false", "true", "turnaround deadline lapsed", updated.EscalationLevel, breachDetail)); err != nil {
		return nil, nil, internalError("record sla breached audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, internalError("commit sla breach transaction", err)
	}
	s.slaMetrics.RecordBreached()
	s.emitSLAAudit(ctx, tenantID, actorPtr(userID), *updated, "breached", "warning", breachDetail)
	return updated, queued, nil
}

func (s *SLAService) advanceEscalationAndEnqueue(ctx context.Context, tenantID, clockID uuid.UUID, level int, ladder *model.EscalationLadder, userID uuid.UUID) (*model.SLAClock, []model.SLANotificationOutboxItem, error) {
	if s.db == nil {
		return nil, nil, internalError("start sla escalation transaction", fmt.Errorf("database is not configured"))
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, internalError("start sla escalation transaction", err)
	}
	defer tx.Rollback(ctx)

	updated, err := s.clocks.AdvanceEscalation(ctx, tx, tenantID, clockID, level)
	if err != nil {
		return nil, nil, internalError("advance sla escalation", err)
	}
	if updated == nil {
		if err := tx.Commit(ctx); err != nil {
			return nil, nil, internalError("commit sla escalation transaction", err)
		}
		return nil, nil, nil
	}
	queued, err := s.enqueueEscalationOutbox(ctx, tx, *updated, level, ladder, userID)
	if err != nil {
		return nil, nil, err
	}
	manual := userID != slaMonitorActorID
	escReason := "استحقاق درجة التصعيد بعد تجاوز المهلة"
	if manual {
		escReason = "تجاوز يدوي للتصعيد"
	}
	escDetail := map[string]any{
		"escalation_level": level,
		"manual":           manual,
	}
	if err := s.clocks.AppendAudit(ctx, tx, newSLAAuditEntry(*updated, actorPtr(userID), "escalated", fmt.Sprintf("L%d", level-1), fmt.Sprintf("L%d", level), escReason, level, escDetail)); err != nil {
		return nil, nil, internalError("record sla escalated audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, internalError("commit sla escalation transaction", err)
	}
	s.slaMetrics.RecordEscalated(level)
	s.emitSLAAudit(ctx, tenantID, actorPtr(userID), *updated, "escalated", "warning", escDetail)
	return updated, queued, nil
}

// slaDeadlines is the materialised deadline set for one clock.
type slaDeadlines struct {
	AckDueAt time.Time
	// TurnaroundFromDueAt is the earliest-promise instant (lower bound of the
	// From–To window); display-only. TurnaroundDueAt is the enforced upper-bound
	// deadline that breach/escalation key off.
	TurnaroundFromDueAt time.Time
	TurnaroundDueAt     time.Time
	L1DueAt             time.Time
	L2DueAt             time.Time
	L3DueAt             time.Time
}

// materialiseSLADeadlines computes every deadline from the working-time
// Calculator. Ack windows: Normal in whole working DAYS, Urgent in working HOURS
// (CAP-013/014). Escalation rungs are working-day offsets from the breach point,
// which is the materialised turnaround due instant.
func materialiseSLADeadlines(calc calendar.Calculator, startedAt time.Time, target *model.SLATarget) slaDeadlines {
	var ackDue time.Time
	if target.AckWindowUnit == model.SLAAckUnitWorkingHours {
		ackDue = calc.AddWorkingHours(startedAt, time.Duration(target.AckWindowValue)*time.Hour)
	} else {
		ackDue = calc.AddWorkingDays(startedAt, target.AckWindowValue)
	}
	// The From (lower) bound defaults to the To bound when unset, so a single-figure
	// target materialises from == to (no visible window). Breach/escalation math is
	// unchanged — it keys off turnaroundDue (the To bound) exclusively.
	turnaroundFrom := target.TurnaroundWorkingDaysFrom
	if turnaroundFrom <= 0 || turnaroundFrom > target.TurnaroundWorkingDays {
		turnaroundFrom = target.TurnaroundWorkingDays
	}
	turnaroundDue := calc.AddWorkingDays(startedAt, target.TurnaroundWorkingDays)
	return slaDeadlines{
		AckDueAt:            ackDue,
		TurnaroundFromDueAt: calc.AddWorkingDays(startedAt, turnaroundFrom),
		TurnaroundDueAt:     turnaroundDue,
		L1DueAt:             calc.AddWorkingDays(turnaroundDue, target.EscalationL1Days),
		L2DueAt:             calc.AddWorkingDays(turnaroundDue, target.EscalationL2Days),
		L3DueAt:             calc.AddWorkingDays(turnaroundDue, target.EscalationL3Days),
	}
}

// turnaroundFromDuePtr returns a pointer to the earliest-promise (From) instant
// for persistence on the clock. It is always materialised (defaulting to the To
// instant when the target carries no distinct lower bound), so the column is
// populated for every clock the window feature materialises.
func turnaroundFromDuePtr(d slaDeadlines) *time.Time {
	from := d.TurnaroundFromDueAt.UTC()
	return &from
}

// resolveEscalationRecipients walks the beneficiary entity's ancestry through the
// org-entity service (CAP-017/018/019). A coverage gap is non-fatal: the clock
// still escalates and the notification is queued to the fallback recipient.
func (s *SLAService) resolveEscalationRecipients(ctx context.Context, tenantID uuid.UUID, clock *model.SLAClock) *model.EscalationLadder {
	if s.escalation == nil || clock.BeneficiaryEntityID == nil || *clock.BeneficiaryEntityID == uuid.Nil {
		return nil
	}
	ladder, err := s.escalation.ResolveLadder(ctx, tenantID, *clock.BeneficiaryEntityID)
	if err != nil {
		s.logger.Warn().Err(err).Str("clock_id", clock.ID.String()).Msg("resolve sla escalation recipients")
		return nil
	}
	return ladder
}

// enqueueEscalationOutbox queues an idempotent escalation notification for the
// given rung. The dedup index makes a repeated enqueue a no-op.
func (s *SLAService) enqueueEscalationOutbox(ctx context.Context, q repository.Queryer, clock model.SLAClock, level int, ladder *model.EscalationLadder, userID uuid.UUID) ([]model.SLANotificationOutboxItem, error) {
	item := slaOutboxItem(clock, model.SLANotificationEscalation, level, ladder, userID, s.now().UTC())
	queued, _, err := s.outbox.Enqueue(ctx, q, []model.SLANotificationOutboxItem{item})
	if err != nil {
		return nil, internalError("enqueue sla escalation notification", err)
	}
	return queued, nil
}

// enqueueAckOutbox queues an idempotent ack-due notification (the monitor calls it
// when the ack rung lapses without acknowledgement).
func (s *SLAService) enqueueAckOutbox(ctx context.Context, q repository.Queryer, clock model.SLAClock, userID uuid.UUID) ([]model.SLANotificationOutboxItem, error) {
	item := slaOutboxItem(clock, model.SLANotificationAck, 0, nil, userID, s.now().UTC())
	queued, _, err := s.outbox.Enqueue(ctx, q, []model.SLANotificationOutboxItem{item})
	if err != nil {
		return nil, internalError("enqueue sla ack notification", err)
	}
	return queued, nil
}

// enqueueBreachOutbox queues an idempotent breach notification.
func (s *SLAService) enqueueBreachOutbox(ctx context.Context, q repository.Queryer, clock model.SLAClock, userID uuid.UUID) ([]model.SLANotificationOutboxItem, error) {
	item := slaOutboxItem(clock, model.SLANotificationBreach, 0, nil, userID, s.now().UTC())
	queued, _, err := s.outbox.Enqueue(ctx, q, []model.SLANotificationOutboxItem{item})
	if err != nil {
		return nil, internalError("enqueue sla breach notification", err)
	}
	return queued, nil
}

func slaOutboxItem(clock model.SLAClock, eventType model.SLANotificationType, level int, ladder *model.EscalationLadder, userID uuid.UUID, now time.Time) model.SLANotificationOutboxItem {
	item := model.SLANotificationOutboxItem{
		ID:               uuid.New(),
		TenantID:         clock.TenantID,
		SLAClockID:       clock.ID,
		LegalRequestID:   clock.LegalRequestID,
		EventID:          uuid.New(),
		EventType:        eventType,
		EscalationLevel:  level,
		Channel:          model.SLANotificationChannelEmail,
		ScheduledAt:      now,
		Status:           model.SLANotificationOutboxPending,
		ProviderMetadata: map[string]any{},
		CreatedBy:        userID,
	}
	if ladder != nil {
		for _, recipient := range ladder.Recipients {
			if recipient.Level == level {
				uid := recipient.UserID
				item.RecipientUserID = &uid
				item.RecipientName = recipient.Label.Localize("en")
				break
			}
		}
	}
	// Fallback recipient: ack/breach rungs have no escalation ladder, and an
	// escalation rung may have a coverage gap. Without a recipient the downstream
	// notification is dropped on a nil target. Resolve the requester (or current
	// assignee) carried on the clock metadata so every queued SLA notification has
	// a deliverable recipient.
	if item.RecipientUserID == nil {
		if uid, ok := slaFallbackRecipientFromClock(clock); ok {
			item.RecipientUserID = &uid
			if item.RecipientName == "" {
				item.RecipientName = slaFallbackRecipientName(clock)
			}
		}
	}
	return item
}

// slaFallbackRecipientFromClock resolves the deliverable fallback recipient for an
// SLA notification from the clock's metadata. StartClock stamps requester_user_id
// (and optionally assignee_user_id) onto the clock at materialisation so the
// monitor — which never imports the request spine — can still address ack/breach
// notifications. Precedence: explicit assignee, then requester.
func slaFallbackRecipientFromClock(clock model.SLAClock) (uuid.UUID, bool) {
	for _, key := range []string{"assignee_user_id", "requester_user_id"} {
		if uid, ok := uuidFromMetadata(clock.Metadata, key); ok {
			return uid, true
		}
	}
	return uuid.Nil, false
}

func slaFallbackRecipientName(clock model.SLAClock) string {
	for _, key := range []string{"assignee_name", "requester_name"} {
		if clock.Metadata != nil {
			if name, ok := clock.Metadata[key].(string); ok && strings.TrimSpace(name) != "" {
				return strings.TrimSpace(name)
			}
		}
	}
	return ""
}

// uuidFromMetadata reads a uuid stored as a string on a metadata map (the shape
// JSON round-trips a uuid through). Returns false on absent/blank/invalid values.
func uuidFromMetadata(metadata map[string]any, key string) (uuid.UUID, bool) {
	if metadata == nil {
		return uuid.Nil, false
	}
	raw, ok := metadata[key].(string)
	if !ok {
		return uuid.Nil, false
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil {
		return uuid.Nil, false
	}
	return id, true
}

// addSLARecipientToPayload attaches the resolved recipient (the one queued on the
// outbox item, else the clock fallback) to an ack_overdue/breached event payload so
// a consumer/notification never sees a nil recipient.
func addSLARecipientToPayload(payload map[string]any, item model.SLANotificationOutboxItem, clock *model.SLAClock) {
	if item.RecipientUserID != nil && *item.RecipientUserID != uuid.Nil {
		payload["recipient_user_id"] = item.RecipientUserID.String()
		if item.RecipientName != "" {
			payload["recipient_name"] = item.RecipientName
		}
		return
	}
	if clock != nil {
		if uid, ok := slaFallbackRecipientFromClock(*clock); ok {
			payload["recipient_user_id"] = uid.String()
			if name := slaFallbackRecipientName(*clock); name != "" {
				payload["recipient_name"] = name
			}
		}
	}
}

func slaEscalationEventPayload(clock model.SLAClock, level int, manual bool, note string, ladder *model.EscalationLadder) map[string]any {
	payload := map[string]any{
		"id":               clock.ID,
		"legal_request_id": clock.LegalRequestID,
		"escalation_level": level,
		"manual":           manual,
	}
	if note != "" {
		payload["note"] = note
	}
	if ladder != nil {
		for _, recipient := range ladder.Recipients {
			if recipient.Level != level {
				continue
			}
			payload["recipient_user_id"] = recipient.UserID.String()
			payload["recipient_name"] = recipient.Label.Localize("en")
			payload["recipient_role"] = string(recipient.RoleKey)
			break
		}
	}
	return payload
}

// --- validation & mapping ---------------------------------------------------

func validateSLATargetCreate(req dto.CreateSLATargetRequest) error {
	if req.ServiceCode == "" {
		return validationError("service_code is required", map[string]string{"service_code": "required"})
	}
	if !req.Priority.Valid() {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	if !req.AckWindowUnit.Valid() {
		return validationError("invalid ack_window_unit", map[string]string{"ack_window_unit": "invalid"})
	}
	if req.TurnaroundWorkingDays < 0 || req.TurnaroundWorkingDays > 3650 {
		return validationError("turnaround_working_days out of range", map[string]string{"turnaround_working_days": "out_of_range"})
	}
	if err := validateSLATurnaroundFrom(req.TurnaroundWorkingDaysFrom, req.TurnaroundWorkingDays); err != nil {
		return err
	}
	if err := validateSLAAckWindow(req.Priority, req.AckWindowValue, req.AckWindowUnit); err != nil {
		return err
	}
	return validateSLAEscalationOffsets(req.EscalationL1Days, req.EscalationL2Days, req.EscalationL3Days)
}

func validateSLATarget(target *model.SLATarget) error {
	if strings.TrimSpace(target.ServiceCode) == "" {
		return validationError("service_code is required", map[string]string{"service_code": "required"})
	}
	if !target.Priority.Valid() {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	if !target.AckWindowUnit.Valid() {
		return validationError("invalid ack_window_unit", map[string]string{"ack_window_unit": "invalid"})
	}
	if target.TurnaroundWorkingDays < 0 || target.TurnaroundWorkingDays > 3650 {
		return validationError("turnaround_working_days out of range", map[string]string{"turnaround_working_days": "out_of_range"})
	}
	if err := validateSLATurnaroundFrom(target.TurnaroundWorkingDaysFrom, target.TurnaroundWorkingDays); err != nil {
		return err
	}
	if err := validateSLAAckWindow(target.Priority, target.AckWindowValue, target.AckWindowUnit); err != nil {
		return err
	}
	return validateSLAEscalationOffsets(target.EscalationL1Days, target.EscalationL2Days, target.EscalationL3Days)
}

// validateSLATurnaroundFrom enforces the From–To window invariant: the lower bound
// is non-negative and never exceeds the upper-bound (enforced) deadline. from == to
// is valid (a single-figure window).
func validateSLATurnaroundFrom(from, to int) error {
	if from < 0 {
		return validationError("turnaround_working_days_from must be non-negative", map[string]string{"turnaround_working_days_from": "out_of_range"})
	}
	if from > to {
		return validationError("turnaround_working_days_from must not exceed turnaround_working_days", map[string]string{"turnaround_working_days_from": "greater_than_to"})
	}
	return nil
}

func validateSLAAckWindow(priority model.SLATargetPriority, value int, unit model.SLAAckUnit) error {
	switch priority {
	case model.SLATargetPriorityUrgent, model.SLATargetPriorityEmergency:
		// Emergency shares the urgent acknowledgement shape: working-hours, 0-4.
		if unit != model.SLAAckUnitWorkingHours {
			return validationError("urgent/emergency acknowledgement window must use working_hours", map[string]string{"ack_window_unit": "must_be_working_hours_for_urgent"})
		}
		if value < 0 || value > model.DefaultSLAAckUrgentWorkingHours {
			return validationError("urgent/emergency acknowledgement window must be 0-4 working hours", map[string]string{"ack_window_value": "out_of_range_for_urgent"})
		}
	case model.SLATargetPriorityNormal:
		if unit != model.SLAAckUnitWorkingDays {
			return validationError("normal acknowledgement window must use working_days", map[string]string{"ack_window_unit": "must_be_working_days_for_normal"})
		}
		if value < 0 || value > model.DefaultSLAAckNormalWorkingDays {
			return validationError("normal acknowledgement window must be 0-1 working day", map[string]string{"ack_window_value": "out_of_range_for_normal"})
		}
	default:
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	return nil
}

func validateSLAEscalationOffsets(l1, l2, l3 int) error {
	if l1 < 0 || l2 < 0 || l3 < 0 {
		return validationError("escalation offsets must be non-negative", map[string]string{"escalation_l1_days": "out_of_range"})
	}
	if l1 != model.DefaultSLAEscalationL1WorkingDaysAfterBreach ||
		l2 != model.DefaultSLAEscalationL2WorkingDaysAfterBreach ||
		l3 != model.DefaultSLAEscalationL3WorkingDaysAfterBreach {
		return validationError("escalation offsets must be +2/+4/+6 working days after breach", map[string]string{"escalation_l1_days": "fixed_2_4_6_after_breach"})
	}
	if l2 < l1 || l3 < l2 {
		return validationError("escalation offsets must be non-decreasing (L1 <= L2 <= L3)", map[string]string{"escalation_l2_days": "order"})
	}
	return nil
}

func applySLATargetUpdate(target *model.SLATarget, req dto.UpdateSLATargetRequest) {
	if req.TurnaroundWorkingDaysFrom != nil {
		target.TurnaroundWorkingDaysFrom = *req.TurnaroundWorkingDaysFrom
	}
	if req.TurnaroundWorkingDays != nil {
		target.TurnaroundWorkingDays = *req.TurnaroundWorkingDays
	}
	if req.AckWindowValue != nil {
		target.AckWindowValue = *req.AckWindowValue
	}
	if req.AckWindowUnit != nil {
		target.AckWindowUnit = *req.AckWindowUnit
	}
	if req.EscalationL1Days != nil {
		target.EscalationL1Days = *req.EscalationL1Days
	}
	if req.EscalationL2Days != nil {
		target.EscalationL2Days = *req.EscalationL2Days
	}
	if req.EscalationL3Days != nil {
		target.EscalationL3Days = *req.EscalationL3Days
	}
	if req.Active != nil {
		target.Active = *req.Active
	}
	if req.Metadata != nil {
		target.Metadata = req.Metadata
	}
}

func normalizeSLADispatchProvider(provider string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		return defaultSLADispatchProvider
	}
	return provider
}

func normalizeSLADispatchLimit(limit *int) (int, error) {
	if limit == nil {
		return defaultSLADispatchLimit, nil
	}
	if *limit <= 0 {
		return 0, validationError("limit must be greater than zero", map[string]string{"limit": "out_of_range"})
	}
	if *limit > maxSLADispatchLimit {
		return maxSLADispatchLimit, nil
	}
	return *limit, nil
}

func slaDispatchSkipReason(status model.SLANotificationOutboxStatus, retry bool) string {
	switch status {
	case model.SLANotificationOutboxSent:
		return "already_sent"
	case model.SLANotificationOutboxFailed:
		if !retry {
			return "failed_without_retry"
		}
		return ""
	default:
		return ""
	}
}
