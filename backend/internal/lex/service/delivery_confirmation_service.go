package service

import (
	"context"
	"errors"
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

// systemActorUserID is the deterministic actor stamped on Execution actions
// performed by background jobs (the auto-close sweeper) that have no
// authenticated user.
var systemActorUserID = uuid.MustParse("00000000-0000-0000-0000-000000000001")

// deliveryConfirmationAutoCloseHours is the CAP-028 working-hour window the
// requester has to confirm/deny a delivery before the auto-close sweeper closes
// the request. Computed via the working calendar (CAP-029), not naive +24h.
const deliveryConfirmationAutoCloseHours = 24

// deliveryConfirmationChannel is the single logical delivery channel; actual
// delivery is reused via the obligation-reminder dispatcher seam, so this domain
// records only the intent + dedup key in its own outbox.
const deliveryConfirmationChannel = "in_app"

// DeliveryConfirmationService owns the post-delivery confirmation handshake
// (CAP-027) and the 24-working-hour auto-close (CAP-028). On request it computes
// the auto_close deadline via the working calendar and enqueues a notification in
// the delivery-confirmation outbox (delivery is reused via the obligation
// dispatcher seam — no new channel layer). On response it confirms/denies and
// closes/reopens the spine accordingly.
// SLAResolver is the narrow seam Execution's delivery path uses to close the SLA
// clock with its terminal on_time/breached verdict the instant a request is
// delivered/closed. It is satisfied by *SLAService.ResolveClockForRequest, which is
// idempotent (Resolve guards on resolved_at IS NULL). Without it the clock never
// leaves 'pending' and the >=90% quarterly SLA KPI is structurally 0%.
type SLAResolver interface {
	ResolveClockForRequest(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID, deliveredAt time.Time) (*model.SLAClock, error)
}

type DeliveryConfirmationService struct {
	db        *pgxpool.Pool
	repo      *repository.ExecutionRepository
	requests  *LegalRequestService
	calendars CalculatorProvider
	publisher Publisher
	metrics   *metrics.Metrics
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
	sla       SLAResolver
}

func NewDeliveryConfirmationService(
	db *pgxpool.Pool,
	repo *repository.ExecutionRepository,
	requests *LegalRequestService,
	calendars CalculatorProvider,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *DeliveryConfirmationService {
	return &DeliveryConfirmationService{
		db:        db,
		repo:      repo,
		requests:  requests,
		calendars: calendars,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-delivery-confirmation").Logger(),
		now:       time.Now,
	}
}

// SetSLAService installs the in-process SLA clock-resolution bridge. Once set, the
// confirm and auto-close paths resolve the request's SLA clock (on_time/breached)
// the instant the request closes, so the SLA KPI is populated even when the Kafka
// event bus is off. A nil resolver is ignored so the constructor default (no
// bridge) is never clobbered; the terminal CloudEvent is still emitted for an
// out-of-process consumer.
func (s *DeliveryConfirmationService) SetSLAService(sla SLAResolver) {
	if sla != nil {
		s.sla = sla
	}
}

// resolveSLAClock drives the in-process SLA resolution bridge. The delivered
// instant is the execution state's delivered_at (when the work was delivered),
// falling back to the resolution time. All failures are non-fatal — the spine
// close already committed.
func (s *DeliveryConfirmationService) resolveSLAClock(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID, deliveredAt time.Time) {
	if s.sla == nil {
		return
	}
	if _, err := s.sla.ResolveClockForRequest(ctx, tenantID, userID, legalRequestID, deliveredAt); err != nil {
		s.logger.Warn().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("sla clock resolution skipped")
	}
}

// Request opens the delivery-confirmation handshake after a request has been
// delivered (CAP-027). It computes the CAP-028 auto-close deadline via the
// working calendar (CAP-029), persists the confirmation, enqueues a
// notification (dedup-guarded), and emits the requested event in one transaction.
func (s *DeliveryConfirmationService) Request(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID, req dto.RequestDeliveryConfirmationRequest) (*model.DeliveryConfirmation, error) {
	req.Normalize()
	request, err := s.requests.Get(ctx, tenantID, legalRequestID)
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()
	contractFlow := isContractDeliveryRequest(request)
	var autoCloseAt *time.Time
	if !contractFlow {
		calc, _, calcErr := s.resolveCalculator(ctx, tenantID, legalRequestID)
		if calcErr != nil {
			return nil, calcErr
		}
		deadline := deliveryConfirmationAutoCloseAt(calc, now)
		autoCloseAt = &deadline
	}

	recipientName := req.RecipientName
	if recipientName == "" {
		recipientName = request.RequesterName
	}
	recipientUserID := request.RequesterUserID
	if req.RecipientUserID != nil && *req.RecipientUserID != uuid.Nil {
		recipientUserID = *req.RecipientUserID
	}

	dc := &model.DeliveryConfirmation{
		ID:              uuid.New(),
		TenantID:        tenantID,
		LegalRequestID:  legalRequestID,
		Status:          model.DeliveryConfirmationStatusRequested,
		RequestedBy:     userID,
		RecipientUserID: recipientUserID,
		RequestedAt:     now,
		AutoCloseAt:     autoCloseAt,
		Metadata: map[string]any{
			"notes":                       req.Notes,
			"manual_achievement_required": contractFlow,
		},
		CreatedBy: userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start delivery-confirmation transaction", err)
	}
	defer tx.Rollback(ctx)

	state, err := s.repo.GetStateByRequestForUpdate(ctx, tx, tenantID, legalRequestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, conflictError("execution state is required before delivery confirmation")
		}
		return nil, internalError("lock execution state", err)
	}
	if state.Status == model.ExecutionStatusAutoClosed || state.Status == model.ExecutionStatusClosed {
		return nil, conflictError("execution is already closed")
	}
	if state.ClockStartedAt == nil && state.Status != model.ExecutionStatusDelivered {
		return nil, conflictError("execution clock has not started")
	}

	// The active clock is locked into this delivery transaction. Delivery is the
	// SLA terminal instant, so a late provider must explain the breach before the
	// record can move to delivered.
	var turnaroundDueAt *time.Time
	var serviceCode string
	err = tx.QueryRow(ctx, `
		SELECT turnaround_due_at, service_code
		FROM legal_sla_clocks
		WHERE tenant_id = $1 AND legal_request_id = $2 AND outcome = 'pending'
		ORDER BY cycle DESC
		LIMIT 1
		FOR SHARE`, tenantID, legalRequestID).Scan(&turnaroundDueAt, &serviceCode)
	if err != nil && err != pgx.ErrNoRows {
		return nil, internalError("load active SLA deadline", err)
	}
	lateJustification, err := validateLateJustification(turnaroundDueAt, now, req.LateJustification)
	if err != nil {
		return nil, err
	}
	if lateJustification != nil {
		subjectType := ""
		if request.SubjectType != nil {
			subjectType = *request.SubjectType
		}
		managerRole := lateJustificationManagerRole(subjectType, serviceCode)
		dc.LateJustification = lateJustification
		dc.LateJustificationSubmittedBy = &userID
		dc.LateJustificationSubmittedAt = &now
		dc.LateJustificationManagerRole = &managerRole
	}

	if err := s.repo.CreateDeliveryConfirmation(ctx, tx, dc); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("an open delivery confirmation already exists for this request")
		}
		return nil, internalError("create delivery confirmation", err)
	}

	prevStatus := state.Status
	state.Status = model.ExecutionStatusDelivered
	state.DeliveredAt = &now
	state.ClosedAt = nil
	if err := s.repo.UpdateState(ctx, tx, state); err != nil {
		return nil, internalError("mark execution delivered", err)
	}
	if err := s.appendAuditTx(ctx, tx, tenantID, legalRequestID, userID, "execution.delivered",
		ptrString(string(prevStatus)), ptrString(string(model.ExecutionStatusDelivered)),
		map[string]any{
			"confirmation_id":             dc.ID,
			"auto_close_at":               autoCloseAt,
			"manual_achievement_required": contractFlow,
			"late_justification_recorded": lateJustification != nil,
		},
	); err != nil {
		return nil, internalError("record execution audit", err)
	}

	eventID := uuid.New()
	outbox := &model.DeliveryConfirmationOutboxItem{
		ID:               uuid.New(),
		TenantID:         tenantID,
		LegalRequestID:   legalRequestID,
		ConfirmationID:   dc.ID,
		EventID:          eventID,
		EventType:        "delivery_confirmation_requested",
		Channel:          deliveryConfirmationChannel,
		RecipientUserID:  &recipientUserID,
		RecipientName:    recipientName,
		RecipientContact: req.RecipientContact,
		ScheduledAt:      now,
		ScheduledDate:    normalizeDate(now),
		Status:           model.DeliveryConfirmationOutboxStatusPending,
		ProviderMetadata: map[string]any{},
		CreatedBy:        userID,
	}
	if _, err := s.repo.EnqueueDeliveryConfirmationNotification(ctx, tx, outbox); err != nil {
		return nil, internalError("enqueue delivery-confirmation notification", err)
	}
	if err := s.appendAuditTx(ctx, tx, tenantID, legalRequestID, userID, "execution.delivery_confirmation_requested", nil, nil, map[string]any{
		"confirmation_id":             dc.ID,
		"auto_close_at":               autoCloseAt,
		"recipient_name":              recipientName,
		"manual_achievement_required": contractFlow,
	}); err != nil {
		return nil, internalError("record delivery-confirmation audit", err)
	}
	if contractFlow {
		if request.Status != model.RequestStatusInExecution {
			return nil, conflictError("contract request must be in execution before delivery")
		}
		if err := s.requests.requests.UpdateStatusGuarded(
			ctx,
			tx,
			tenantID,
			legalRequestID,
			model.RequestStatusInExecution,
			model.RequestStatusDelivered,
			nil,
			nil,
		); err != nil {
			if errors.Is(err, repository.ErrStatusConflict) {
				return nil, conflictError("contract request was concurrently modified before delivery")
			}
			return nil, internalError("mark contract request delivered", err)
		}
		if err := s.requests.requests.AppendAudit(ctx, tx, newSpineAuditEntry(
			tenantID,
			legalRequestID,
			actorPtr(userID),
			"status_changed",
			string(model.RequestStatusInExecution),
			string(model.RequestStatusDelivered),
			"",
			map[string]any{"request_number": request.RequestNumber},
		)); err != nil {
			return nil, internalError("record contract delivery request transition", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit delivery confirmation", err)
	}

	if contractFlow {
		s.emitRequestStatusTransition(ctx, request, userID, model.RequestStatusDelivered)
	} else if _, err := s.requests.Transition(ctx, tenantID, userID, legalRequestID, model.RequestStatusDelivered); err != nil {
		s.logger.Warn().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("spine transition to delivered skipped")
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.delivered", tenantID, &userID, map[string]any{
		"id":                          state.ID,
		"legal_request_id":            legalRequestID,
		"confirmation_id":             dc.ID,
		"delivered_at":                now,
		"manual_achievement_required": contractFlow,
	}, s.logger)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.delivery_confirmation_requested", tenantID, &userID, map[string]any{
		"id":                          dc.ID,
		"legal_request_id":            legalRequestID,
		"auto_close_at":               autoCloseAt,
		"recipient_name":              recipientName,
		"manual_achievement_required": contractFlow,
	}, s.logger)
	return dc, nil
}

// Respond records the requester's confirm/deny decision (CAP-027). A confirm
// closes the spine (delivered → closed); a deny reopens it as returned so the
// provider can act. For contract requests, the contracts associate must first
// mark the legal work achieved and a confirming requester must provide final
// delivery notes. Non-contract confirmations retain their existing behavior.
func (s *DeliveryConfirmationService) Respond(ctx context.Context, tenantID, userID, legalRequestID, confirmationID uuid.UUID, req dto.RespondDeliveryConfirmationRequest) (*model.DeliveryConfirmation, error) {
	req.Normalize()
	request, err := s.requests.Get(ctx, tenantID, legalRequestID)
	if err != nil {
		return nil, err
	}
	contractFlow := isContractDeliveryRequest(request)
	if contractFlow && req.Confirm && req.Note == nil {
		return nil, validationError("final delivery notes are required for contract requests", map[string]string{
			"note": "required",
		})
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start respond transaction", err)
	}
	defer tx.Rollback(ctx)

	dc, err := s.repo.GetOpenDeliveryConfirmationForUpdate(ctx, tx, tenantID, confirmationID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("delivery confirmation not found")
		}
		return nil, internalError("lock delivery confirmation", err)
	}
	if dc.LegalRequestID != legalRequestID {
		return nil, notFoundError("delivery confirmation not found")
	}
	// The response closes or reopens the canonical request spine, so permission
	// alone is insufficient: only the recipient selected when delivery was
	// requested may decide it. Check ownership before status to avoid exposing a
	// confirmation's resolution state to another request editor.
	if dc.RecipientUserID != userID {
		return nil, forbiddenError("only the intended delivery recipient can respond to this confirmation")
	}
	expectedStatus := model.DeliveryConfirmationStatusRequested
	if contractFlow {
		expectedStatus = model.DeliveryConfirmationStatusAchieved
	}
	if dc.Status != expectedStatus {
		if contractFlow && dc.Status == model.DeliveryConfirmationStatusRequested {
			return nil, conflictError("the contracts associate must mark the legal work achieved before the requester can close it")
		}
		return nil, conflictError("delivery confirmation already resolved")
	}
	state, err := s.repo.GetStateByRequestForUpdate(ctx, tx, tenantID, legalRequestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, conflictError("execution state is required before delivery response")
		}
		return nil, internalError("lock execution state", err)
	}

	now := s.now().UTC()
	status := model.DeliveryConfirmationStatusConfirmed
	action := "execution.delivery_confirmed"
	if contractFlow && req.Confirm {
		action = "execution.contract_final_delivery_closed"
	} else if !req.Confirm {
		status = model.DeliveryConfirmationStatusDenied
		action = "execution.delivery_denied"
	}
	if err := s.repo.RespondDeliveryConfirmation(ctx, tx, tenantID, confirmationID, expectedStatus, status, userID, now, req.Note); err != nil {
		if err == pgx.ErrNoRows {
			return nil, conflictError("delivery confirmation already resolved")
		}
		return nil, internalError("respond delivery confirmation", err)
	}
	prevStatus := state.Status
	applyDeliveryConfirmationResolution(state, status, now)
	if err := s.repo.UpdateState(ctx, tx, state); err != nil {
		return nil, internalError("update execution state for delivery response", err)
	}
	if err := s.appendAuditTx(ctx, tx, tenantID, legalRequestID, userID, action,
		ptrString(string(prevStatus)), ptrString(string(state.Status)), map[string]any{
			"confirmation_id": confirmationID,
			"confirmed":       req.Confirm,
		}); err != nil {
		return nil, internalError("record execution audit", err)
	}
	target := model.RequestStatusClosed
	if !req.Confirm {
		target = model.RequestStatusReturned
	}
	if contractFlow {
		if request.Status != model.RequestStatusDelivered {
			return nil, conflictError("contract request must remain delivered until the requester closes it")
		}
		if err := s.requests.requests.UpdateStatusGuarded(
			ctx,
			tx,
			tenantID,
			legalRequestID,
			model.RequestStatusDelivered,
			target,
			nil,
			nil,
		); err != nil {
			if errors.Is(err, repository.ErrStatusConflict) {
				return nil, conflictError("contract request was concurrently modified before the requester response")
			}
			return nil, internalError("transition contract request after requester response", err)
		}
		if err := s.requests.requests.AppendAudit(ctx, tx, newSpineAuditEntry(
			tenantID,
			legalRequestID,
			actorPtr(userID),
			"status_changed",
			string(model.RequestStatusDelivered),
			string(target),
			"",
			map[string]any{"request_number": request.RequestNumber},
		)); err != nil {
			return nil, internalError("record contract requester close transition", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit respond", err)
	}

	dc.Status = status
	dc.RespondedBy = &userID
	dc.RespondedAt = &now
	dc.ResponseNote = req.Note

	eventType := "com.clario360.lex.execution.delivery_confirmed"
	if contractFlow && req.Confirm {
		eventType = "com.clario360.lex.execution.contract_final_delivery_closed"
	} else if !req.Confirm {
		eventType = "com.clario360.lex.execution.delivery_denied"
	}
	if contractFlow {
		s.emitRequestStatusTransition(ctx, request, userID, target)
	} else if _, err := s.requests.Transition(ctx, tenantID, userID, legalRequestID, target); err != nil {
		s.logger.Warn().Err(err).Str("legal_request_id", legalRequestID.String()).Msg("spine transition on delivery response skipped")
	}
	// A confirmed delivery closes the request: resolve the SLA clock to its terminal
	// on_time/breached verdict against the delivered instant. A deny reopens the
	// request, so the clock stays open (it will resolve on a later delivery).
	if req.Confirm {
		s.resolveSLAClock(ctx, tenantID, userID, legalRequestID, deliveredAtForResolution(state, now))
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, eventType, tenantID, &userID, map[string]any{
		"id":               confirmationID,
		"legal_request_id": legalRequestID,
		"confirmed":        req.Confirm,
	}, s.logger)
	return dc, nil
}

// Achieve records that the contracts associate completed the legal work. It
// deliberately does not close the execution or request: the business requester
// still owns the final delivery note and closing action. The route is
// contract-edit gated; this service additionally prevents requester
// self-achievement even when that requester holds another broad permission.
func (s *DeliveryConfirmationService) Achieve(ctx context.Context, tenantID, userID, legalRequestID, confirmationID uuid.UUID) (*model.DeliveryConfirmation, error) {
	request, err := s.requests.Get(ctx, tenantID, legalRequestID)
	if err != nil {
		return nil, err
	}
	if !isContractDeliveryRequest(request) {
		return nil, conflictError("manual achievement is only available for contract requests")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start contract achievement transaction", err)
	}
	defer tx.Rollback(ctx)

	dc, err := s.repo.GetOpenDeliveryConfirmationForUpdate(ctx, tx, tenantID, confirmationID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("delivery confirmation not found")
		}
		return nil, internalError("lock delivery confirmation for achievement", err)
	}
	if dc.LegalRequestID != legalRequestID {
		return nil, notFoundError("delivery confirmation not found")
	}
	if dc.RecipientUserID == userID || request.RequesterUserID == userID {
		return nil, forbiddenError("the contract requester cannot achieve their own request")
	}
	if dc.Status != model.DeliveryConfirmationStatusRequested {
		return nil, conflictError("contract delivery is not awaiting associate achievement")
	}

	state, err := s.repo.GetStateByRequestForUpdate(ctx, tx, tenantID, legalRequestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, conflictError("execution state is required before contract achievement")
		}
		return nil, internalError("lock execution state for contract achievement", err)
	}
	if state.Status != model.ExecutionStatusDelivered {
		return nil, conflictError("contract request must be delivered before achievement")
	}

	now := s.now().UTC()
	if err := s.repo.AchieveDeliveryConfirmation(ctx, tx, tenantID, confirmationID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, conflictError("contract delivery is not awaiting achievement")
		}
		return nil, internalError("achieve contract delivery", err)
	}
	prevStatus := state.Status
	if err := s.appendAuditTx(ctx, tx, tenantID, legalRequestID, userID, "execution.contract_achieved",
		ptrString(string(prevStatus)), ptrString(string(state.Status)), map[string]any{
			"confirmation_id":      confirmationID,
			"requester_user_id":    request.RequesterUserID,
			"request_remains_open": true,
		}); err != nil {
		return nil, internalError("record contract achievement audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit contract achievement", err)
	}

	dc.Status = model.DeliveryConfirmationStatusAchieved
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.contract_achieved", tenantID, &userID, map[string]any{
		"id":                   confirmationID,
		"legal_request_id":     legalRequestID,
		"achieved_at":          now,
		"request_remains_open": true,
	}, s.logger)
	return dc, nil
}

// deliveredAtForResolution picks the instant the SLA clock is measured against: the
// execution state's delivered_at (when the work was delivered), falling back to the
// resolution time when it is unset.
func deliveredAtForResolution(state *model.ExecutionState, fallback time.Time) time.Time {
	if state != nil && state.DeliveredAt != nil && !state.DeliveredAt.IsZero() {
		return state.DeliveredAt.UTC()
	}
	return fallback.UTC()
}

// AutoClose is the sweeper action (CAP-028): an unanswered confirmation past its
// working-calendar deadline is marked expired and the spine is closed. It is
// invoked by delivery_autoclose_monitor for each expired row.
func (s *DeliveryConfirmationService) AutoClose(ctx context.Context, dc *model.DeliveryConfirmation) error {
	now := s.now().UTC()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	locked, err := s.repo.GetOpenDeliveryConfirmationForUpdate(ctx, tx, dc.TenantID, dc.ID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return err
	}
	if locked.Status != model.DeliveryConfirmationStatusRequested {
		return nil
	}
	if locked.AutoCloseAt == nil || locked.AutoCloseAt.After(now) {
		return nil
	}
	state, err := s.repo.GetStateByRequestForUpdate(ctx, tx, dc.TenantID, locked.LegalRequestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return err
	}
	if err := s.repo.RespondDeliveryConfirmation(ctx, tx, dc.TenantID, dc.ID, model.DeliveryConfirmationStatusRequested, model.DeliveryConfirmationStatusExpired, systemActorUserID, now, nil); err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return err
	}
	prevStatus := state.Status
	applyDeliveryConfirmationResolution(state, model.DeliveryConfirmationStatusExpired, now)
	if err := s.repo.UpdateState(ctx, tx, state); err != nil {
		return err
	}
	if err := s.appendAuditTx(ctx, tx, dc.TenantID, locked.LegalRequestID, systemActorUserID, "execution.delivery_auto_closed",
		ptrString(string(prevStatus)), ptrString(string(state.Status)), map[string]any{
			"confirmation_id": dc.ID,
			"auto_close_at":   locked.AutoCloseAt,
		}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	committed = true

	if _, err := s.requests.Transition(ctx, dc.TenantID, systemActorUserID, locked.LegalRequestID, model.RequestStatusClosed); err != nil {
		s.logger.Warn().Err(err).Str("legal_request_id", locked.LegalRequestID.String()).Msg("spine close on auto-close skipped")
	}
	// The auto-close sweeper closes the request: resolve the SLA clock to its
	// terminal verdict against the delivered instant (the requester never responded
	// within the working-calendar window, so the delivery stands).
	s.resolveSLAClock(ctx, dc.TenantID, systemActorUserID, locked.LegalRequestID, deliveredAtForResolution(state, now))
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.execution.delivery_auto_closed", dc.TenantID, nil, map[string]any{
		"id":               dc.ID,
		"legal_request_id": locked.LegalRequestID,
		"auto_close_at":    locked.AutoCloseAt,
	}, s.logger)
	return nil
}

// ListExpired returns confirmations past their auto-close deadline for a tenant,
// used by the sweeper fan-out.
func (s *DeliveryConfirmationService) ListExpired(ctx context.Context, tenantID uuid.UUID, limit int) ([]model.DeliveryConfirmation, error) {
	return s.repo.ListExpiredDeliveryConfirmations(ctx, tenantID, s.now().UTC(), limit)
}

// ListTenantIDs enumerates tenants with open confirmations, for the sweeper.
func (s *DeliveryConfirmationService) ListTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	return s.repo.ListTenantIDs(ctx)
}

func (s *DeliveryConfirmationService) resolveCalculator(ctx context.Context, tenantID, legalRequestID uuid.UUID) (calendar.Calculator, *uuid.UUID, error) {
	// The execution state, when present, pins the calendar used to start the
	// clock so the confirmation window uses the SAME calendar (CAP-029).
	if state, err := s.repo.GetStateByRequest(ctx, tenantID, legalRequestID); err == nil && state.WorkingCalendarID != nil {
		calc, cerr := s.calendars.CalculatorFor(ctx, tenantID, *state.WorkingCalendarID)
		if cerr != nil {
			return nil, nil, cerr
		}
		return calc, state.WorkingCalendarID, nil
	}
	calc, err := s.calendars.DefaultCalculator(ctx, tenantID)
	if err != nil {
		return nil, nil, err
	}
	return calc, nil, nil
}

func (s *DeliveryConfirmationService) appendAuditTx(ctx context.Context, q repository.Queryer, tenantID, legalRequestID, actorID uuid.UUID, action string, from, to *string, detail map[string]any) error {
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

func deliveryConfirmationAutoCloseAt(calc calendar.Calculator, requestedAt time.Time) time.Time {
	return calc.AddWorkingHours(requestedAt, deliveryConfirmationAutoCloseHours*time.Hour).UTC()
}

func applyDeliveryConfirmationResolution(state *model.ExecutionState, status model.DeliveryConfirmationStatus, now time.Time) {
	switch status {
	case model.DeliveryConfirmationStatusConfirmed, model.DeliveryConfirmationStatusExpired:
		state.Status = model.ExecutionStatusClosed
		state.ClosedAt = &now
	case model.DeliveryConfirmationStatusDenied:
		state.Status = model.ExecutionStatusReturned
		state.ClockStartedAt = nil
		state.CompletenessConfirmed = nil
		state.DeliveredAt = nil
		state.ClosedAt = nil
	}
}

func isContractDeliveryRequest(request *model.LegalRequest) bool {
	if request == nil {
		return false
	}
	if request.SubjectType != nil && strings.EqualFold(strings.TrimSpace(*request.SubjectType), string(routeSubjectContract)) {
		return true
	}
	return classifyRouteSubject(request.RequestType) == routeSubjectContract
}

func (s *DeliveryConfirmationService) emitRequestStatusTransition(
	ctx context.Context,
	request *model.LegalRequest,
	userID uuid.UUID,
	target model.RequestStatus,
) {
	if request == nil {
		return
	}
	from := request.Status
	payload := legalRequestEventPayload(request)
	payload["previous_status"] = from
	payload["status"] = target
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.request.status_changed", request.TenantID, &userID, payload, s.logger)
	s.requests.emitSpineAudit(ctx, request.TenantID, actorPtr(userID), request.ID, "status_changed", string(from), string(target), "")
}
