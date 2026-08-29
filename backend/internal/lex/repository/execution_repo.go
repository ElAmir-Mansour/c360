package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ExecutionRepository persists the Execution-Rules aggregate (CAP-022..029):
// the per-request execution-state singleton, its requirement-item checklist,
// review rounds, delivery confirmations, the delivery-confirmation notification
// outbox and the append-only execution audit log. Every query filters by
// tenant_id (primary predicate) with table RLS as a backstop, mirroring the
// other lex repositories. Writes that participate in a transaction accept a
// Queryer so the state row + side-effects commit atomically.
type ExecutionRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewExecutionRepository(db *pgxpool.Pool, logger zerolog.Logger) *ExecutionRepository {
	return &ExecutionRepository{db: db, logger: logger}
}

// --- execution state -------------------------------------------------------

func (r *ExecutionRepository) CreateState(ctx context.Context, q Queryer, state *model.ExecutionState) error {
	metaJSON, err := json.Marshal(orEmptyMap(state.Metadata))
	if err != nil {
		return fmt.Errorf("marshal execution state metadata: %w", err)
	}
	query := `
		INSERT INTO legal_request_execution_state (
			id, tenant_id, legal_request_id, status, clock_started_at,
			completeness_confirmed_at, sla_target_seconds, working_calendar_id,
			review_round_count, max_review_rounds, cloned_from_request_id,
			clone_request_id, delivered_at, closed_at, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,
			$6,$7,$8,
			$9,$10,$11,
			$12,$13,$14,$15::jsonb,$16
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		state.ID, state.TenantID, state.LegalRequestID, state.Status, state.ClockStartedAt,
		state.CompletenessConfirmed, state.SLATargetSeconds, state.WorkingCalendarID,
		state.ReviewRoundCount, state.MaxReviewRounds, state.ClonedFromRequestID,
		state.CloneRequestID, state.DeliveredAt, state.ClosedAt, metaJSON, state.CreatedBy,
	).Scan(&state.CreatedAt, &state.UpdatedAt)
}

func (r *ExecutionRepository) GetStateByRequest(ctx context.Context, tenantID, legalRequestID uuid.UUID) (*model.ExecutionState, error) {
	query := executionStateJSONSelect(`es.tenant_id = $1 AND es.legal_request_id = $2`)
	return queryRowJSON[model.ExecutionState](ctx, r.db, query, tenantID, legalRequestID)
}

// GetStateByRequestForUpdate loads the singleton state row inside a transaction
// with FOR UPDATE so a clock-start / review-round / auto-close mutation is
// serialized against concurrent execution actions on the same request.
func (r *ExecutionRepository) GetStateByRequestForUpdate(ctx context.Context, q Queryer, tenantID, legalRequestID uuid.UUID) (*model.ExecutionState, error) {
	var id uuid.UUID
	if err := q.QueryRow(ctx,
		`SELECT id FROM legal_request_execution_state WHERE tenant_id = $1 AND legal_request_id = $2 FOR UPDATE`,
		tenantID, legalRequestID,
	).Scan(&id); err != nil {
		return nil, err
	}
	query := executionStateJSONSelect(`es.tenant_id = $1 AND es.legal_request_id = $2`)
	return queryRowJSON[model.ExecutionState](ctx, q, query, tenantID, legalRequestID)
}

func (r *ExecutionRepository) UpdateState(ctx context.Context, q Queryer, state *model.ExecutionState) error {
	metaJSON, err := json.Marshal(orEmptyMap(state.Metadata))
	if err != nil {
		return fmt.Errorf("marshal execution state metadata: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_request_execution_state
		SET status = $3,
		    clock_started_at = $4,
		    completeness_confirmed_at = $5,
		    sla_target_seconds = $6,
		    working_calendar_id = $7,
		    review_round_count = $8,
		    max_review_rounds = $9,
		    cloned_from_request_id = $10,
		    clone_request_id = $11,
		    delivered_at = $12,
		    closed_at = $13,
		    metadata = $14::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND legal_request_id = $2`,
		state.TenantID, state.LegalRequestID, state.Status, state.ClockStartedAt,
		state.CompletenessConfirmed, state.SLATargetSeconds, state.WorkingCalendarID,
		state.ReviewRoundCount, state.MaxReviewRounds, state.ClonedFromRequestID,
		state.CloneRequestID, state.DeliveredAt, state.ClosedAt, metaJSON,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func executionStateJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT es.id, es.tenant_id, es.legal_request_id, es.status,
			       es.clock_started_at, es.completeness_confirmed_at, es.sla_target_seconds,
			       es.working_calendar_id, es.review_round_count, es.max_review_rounds,
			       es.cloned_from_request_id, es.clone_request_id, es.delivered_at, es.closed_at,
			       COALESCE(es.metadata, '{}'::jsonb) AS metadata,
			       es.created_by, es.created_at, es.updated_at
			FROM legal_request_execution_state es
			WHERE ` + where + `
		) t`
}

// --- requirement items -----------------------------------------------------

func (r *ExecutionRepository) CreateRequirement(ctx context.Context, q Queryer, item *model.RequirementItem) error {
	labelJSON, err := json.Marshal(item.Label)
	if err != nil {
		return fmt.Errorf("marshal requirement label: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(item.Metadata))
	if err != nil {
		return fmt.Errorf("marshal requirement metadata: %w", err)
	}
	query := `
		INSERT INTO legal_request_requirement_item (
			id, tenant_id, legal_request_id, code, label, kind, required, satisfied,
			file_id, data_value, satisfied_by, satisfied_at, sort_order, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5::jsonb,$6,$7,$8,
			$9,$10,$11,$12,$13,$14::jsonb,$15
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		item.ID, item.TenantID, item.LegalRequestID, item.Code, labelJSON, item.Kind, item.Required, item.Satisfied,
		item.FileID, item.DataValue, item.SatisfiedBy, item.SatisfiedAt, item.SortOrder, metaJSON, item.CreatedBy,
	).Scan(&item.CreatedAt, &item.UpdatedAt)
}

func (r *ExecutionRepository) GetRequirement(ctx context.Context, tenantID, id uuid.UUID) (*model.RequirementItem, error) {
	query := requirementJSONSelect(`ri.tenant_id = $1 AND ri.id = $2`)
	return queryRowJSON[model.RequirementItem](ctx, r.db, query, tenantID, id)
}

func (r *ExecutionRepository) ListRequirements(ctx context.Context, tenantID, legalRequestID uuid.UUID) ([]model.RequirementItem, error) {
	query := requirementJSONSelect(`ri.tenant_id = $1 AND ri.legal_request_id = $2`) +
		` ORDER BY t.sort_order ASC, t.created_at ASC`
	return queryListJSON[model.RequirementItem](ctx, r.db, query, tenantID, legalRequestID)
}

// ListRequirementsForRequest is the transactional variant used while holding the
// execution-state lock so completeness is evaluated against a consistent set.
func (r *ExecutionRepository) ListRequirementsForRequest(ctx context.Context, q Queryer, tenantID, legalRequestID uuid.UUID) ([]model.RequirementItem, error) {
	query := requirementJSONSelect(`ri.tenant_id = $1 AND ri.legal_request_id = $2`) +
		` ORDER BY t.sort_order ASC, t.created_at ASC`
	return queryListJSON[model.RequirementItem](ctx, q, query, tenantID, legalRequestID)
}

func (r *ExecutionRepository) UpdateRequirement(ctx context.Context, q Queryer, item *model.RequirementItem) error {
	labelJSON, err := json.Marshal(item.Label)
	if err != nil {
		return fmt.Errorf("marshal requirement label: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(item.Metadata))
	if err != nil {
		return fmt.Errorf("marshal requirement metadata: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_request_requirement_item
		SET code = $3,
		    label = $4::jsonb,
		    kind = $5,
		    required = $6,
		    satisfied = $7,
		    file_id = $8,
		    data_value = $9,
		    satisfied_by = $10,
		    satisfied_at = $11,
		    sort_order = $12,
		    metadata = $13::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2`,
		item.TenantID, item.ID, item.Code, labelJSON, item.Kind, item.Required, item.Satisfied,
		item.FileID, item.DataValue, item.SatisfiedBy, item.SatisfiedAt, item.SortOrder, metaJSON,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ExecutionRepository) DeleteRequirement(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `DELETE FROM legal_request_requirement_item WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func requirementJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT ri.id, ri.tenant_id, ri.legal_request_id, ri.code, ri.label, ri.kind,
			       ri.required, ri.satisfied, ri.file_id, ri.data_value, ri.satisfied_by,
			       ri.satisfied_at, ri.sort_order, COALESCE(ri.metadata, '{}'::jsonb) AS metadata,
			       ri.created_by, ri.created_at, ri.updated_at
			FROM legal_request_requirement_item ri
			WHERE ` + where + `
		) t`
}

// --- review rounds ---------------------------------------------------------

func (r *ExecutionRepository) CreateReviewRound(ctx context.Context, q Queryer, round *model.ReviewRound) error {
	metaJSON, err := json.Marshal(orEmptyMap(round.Metadata))
	if err != nil {
		return fmt.Errorf("marshal review round metadata: %w", err)
	}
	query := `
		INSERT INTO legal_request_review_round (
			id, tenant_id, legal_request_id, round_no, reason, outcome,
			opened_by, opened_at, closed_by, closed_at, metadata
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11::jsonb
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		round.ID, round.TenantID, round.LegalRequestID, round.RoundNo, round.Reason, round.Outcome,
		round.OpenedBy, round.OpenedAt, round.ClosedBy, round.ClosedAt, metaJSON,
	).Scan(&round.CreatedAt, &round.UpdatedAt)
}

func (r *ExecutionRepository) CloseReviewRound(ctx context.Context, q Queryer, tenantID, id uuid.UUID, outcome model.ReviewRoundOutcome, closedBy uuid.UUID, closedAt time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_request_review_round
		SET outcome = $3,
		    closed_by = $4,
		    closed_at = $5,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND closed_at IS NULL`,
		tenantID, id, outcome, closedBy, closedAt,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ExecutionRepository) ListReviewRounds(ctx context.Context, tenantID, legalRequestID uuid.UUID) ([]model.ReviewRound, error) {
	query := reviewRoundJSONSelect(`rr.tenant_id = $1 AND rr.legal_request_id = $2`) +
		` ORDER BY t.round_no ASC`
	return queryListJSON[model.ReviewRound](ctx, r.db, query, tenantID, legalRequestID)
}

func reviewRoundJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT rr.id, rr.tenant_id, rr.legal_request_id, rr.round_no, rr.reason, rr.outcome,
			       rr.opened_by, rr.opened_at, rr.closed_by, rr.closed_at,
			       COALESCE(rr.metadata, '{}'::jsonb) AS metadata,
			       rr.created_at, rr.updated_at
			FROM legal_request_review_round rr
			WHERE ` + where + `
		) t`
}

// --- delivery confirmations ------------------------------------------------

func (r *ExecutionRepository) CreateDeliveryConfirmation(ctx context.Context, q Queryer, dc *model.DeliveryConfirmation) error {
	metaJSON, err := json.Marshal(orEmptyMap(dc.Metadata))
	if err != nil {
		return fmt.Errorf("marshal delivery confirmation metadata: %w", err)
	}
	query := `
		INSERT INTO legal_request_delivery_confirmation (
			id, tenant_id, legal_request_id, status, requested_by, recipient_user_id,
			requested_at, auto_close_at, responded_by, responded_at, response_note,
			late_justification, late_justification_submitted_by,
			late_justification_submitted_at, late_justification_manager_role,
			metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		dc.ID, dc.TenantID, dc.LegalRequestID, dc.Status, dc.RequestedBy, dc.RecipientUserID,
		dc.RequestedAt, dc.AutoCloseAt, dc.RespondedBy, dc.RespondedAt, dc.ResponseNote,
		dc.LateJustification, dc.LateJustificationSubmittedBy, dc.LateJustificationSubmittedAt,
		dc.LateJustificationManagerRole, metaJSON, dc.CreatedBy,
	).Scan(&dc.CreatedAt, &dc.UpdatedAt)
}

func (r *ExecutionRepository) GetDeliveryConfirmation(ctx context.Context, tenantID, id uuid.UUID) (*model.DeliveryConfirmation, error) {
	query := deliveryConfirmationJSONSelect(`dc.tenant_id = $1 AND dc.id = $2`)
	return queryRowJSON[model.DeliveryConfirmation](ctx, r.db, query, tenantID, id)
}

func (r *ExecutionRepository) GetOpenDeliveryConfirmationForUpdate(ctx context.Context, q Queryer, tenantID, id uuid.UUID) (*model.DeliveryConfirmation, error) {
	var foundID uuid.UUID
	if err := q.QueryRow(ctx,
		`SELECT id FROM legal_request_delivery_confirmation WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
		tenantID, id,
	).Scan(&foundID); err != nil {
		return nil, err
	}
	query := deliveryConfirmationJSONSelect(`dc.tenant_id = $1 AND dc.id = $2`)
	return queryRowJSON[model.DeliveryConfirmation](ctx, q, query, tenantID, id)
}

func (r *ExecutionRepository) RespondDeliveryConfirmation(ctx context.Context, q Queryer, tenantID, id uuid.UUID, expectedStatus, status model.DeliveryConfirmationStatus, respondedBy uuid.UUID, respondedAt time.Time, note *string) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_request_delivery_confirmation
		SET status = $3,
		    responded_by = $4,
		    responded_at = $5,
		    response_note = $6,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND status = $7`,
		tenantID, id, status, respondedBy, respondedAt, note, expectedStatus,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// AchieveDeliveryConfirmation performs the contracts-associate half of the
// contract completion handshake. The associate is captured by the execution
// audit; requester identity and final notes are recorded by the later response.
func (r *ExecutionRepository) AchieveDeliveryConfirmation(ctx context.Context, q Queryer, tenantID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_request_delivery_confirmation
		SET status = 'achieved', updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND status = 'requested'`,
		tenantID, id,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ExecutionRepository) ListDeliveryConfirmations(ctx context.Context, tenantID, legalRequestID uuid.UUID) ([]model.DeliveryConfirmation, error) {
	query := deliveryConfirmationJSONSelect(`dc.tenant_id = $1 AND dc.legal_request_id = $2`) +
		` ORDER BY t.requested_at DESC`
	return queryListJSON[model.DeliveryConfirmation](ctx, r.db, query, tenantID, legalRequestID)
}

// ListExpiredDeliveryConfirmations returns confirmations still in 'requested'
// whose auto_close_at deadline has passed, for the auto-close sweeper. It is a
// cross-tenant scan (the sweeper fans out per tenant) limited to a batch.
func (r *ExecutionRepository) ListExpiredDeliveryConfirmations(ctx context.Context, tenantID uuid.UUID, now time.Time, limit int) ([]model.DeliveryConfirmation, error) {
	if limit <= 0 {
		limit = 200
	}
	query := deliveryConfirmationJSONSelect(`dc.tenant_id = $1 AND dc.status = 'requested' AND dc.auto_close_at IS NOT NULL AND dc.auto_close_at <= $2`) +
		fmt.Sprintf(` ORDER BY t.auto_close_at ASC LIMIT %d`, limit)
	return queryListJSON[model.DeliveryConfirmation](ctx, r.db, query, tenantID, now)
}

func deliveryConfirmationJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT dc.id, dc.tenant_id, dc.legal_request_id, dc.status, dc.requested_by,
			       dc.recipient_user_id, dc.requested_at, dc.auto_close_at, dc.responded_by, dc.responded_at,
			       dc.response_note, dc.late_justification, dc.late_justification_submitted_by,
			       dc.late_justification_submitted_at, dc.late_justification_manager_role,
			       COALESCE(dc.metadata, '{}'::jsonb) AS metadata,
			       dc.created_by, dc.created_at, dc.updated_at
			FROM legal_request_delivery_confirmation dc
			WHERE ` + where + `
		) t`
}

// --- delivery-confirmation notification outbox -----------------------------

// EnqueueDeliveryConfirmationNotification inserts a notification outbox row,
// honoring the partial-unique dedup (tenant, confirmation, channel,
// scheduled_date) on status IN (pending,sent). Returns false when a duplicate is
// suppressed (mirrors the obligation outbox 000007 pattern).
func (r *ExecutionRepository) EnqueueDeliveryConfirmationNotification(ctx context.Context, q Queryer, item *model.DeliveryConfirmationOutboxItem) (bool, error) {
	metaJSON, err := json.Marshal(orEmptyMap(item.ProviderMetadata))
	if err != nil {
		return false, fmt.Errorf("marshal delivery confirmation outbox metadata: %w", err)
	}
	query := `
		INSERT INTO legal_request_delivery_confirmation_outbox (
			id, tenant_id, legal_request_id, confirmation_id, event_id, event_type, channel,
			recipient_user_id, recipient_name, recipient_contact, scheduled_at, scheduled_date,
			status, provider, provider_metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12,
			$13,$14,$15::jsonb,$16
		)
		ON CONFLICT DO NOTHING
		RETURNING created_at, updated_at`
	err = q.QueryRow(ctx, query,
		item.ID, item.TenantID, item.LegalRequestID, item.ConfirmationID, item.EventID, item.EventType, item.Channel,
		item.RecipientUserID, item.RecipientName, item.RecipientContact, item.ScheduledAt, item.ScheduledDate,
		item.Status, item.Provider, metaJSON, item.CreatedBy,
	).Scan(&item.CreatedAt, &item.UpdatedAt)
	if err == pgx.ErrNoRows {
		// Dedup suppressed the insert.
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// --- execution audit log (append-only) -------------------------------------

func (r *ExecutionRepository) AppendAudit(ctx context.Context, q Queryer, entry *model.ExecutionAuditEntry) error {
	detailJSON, err := json.Marshal(orEmptyMap(entry.Detail))
	if err != nil {
		return fmt.Errorf("marshal execution audit detail: %w", err)
	}
	query := `
		INSERT INTO legal_request_execution_audit_log (
			id, tenant_id, legal_request_id, action, from_status, to_status, detail, actor_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.LegalRequestID, entry.Action, entry.FromStatus, entry.ToStatus, detailJSON, entry.ActorUserID,
	).Scan(&entry.CreatedAt)
}

func (r *ExecutionRepository) ListAudit(ctx context.Context, tenantID, legalRequestID uuid.UUID) ([]model.ExecutionAuditEntry, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT al.id, al.tenant_id, al.legal_request_id, al.action, al.from_status,
			       al.to_status, COALESCE(al.detail, '{}'::jsonb) AS detail,
			       al.actor_user_id, al.created_at
			FROM legal_request_execution_audit_log al
			WHERE al.tenant_id = $1 AND al.legal_request_id = $2
			ORDER BY al.created_at ASC
		) t`
	return queryListJSON[model.ExecutionAuditEntry](ctx, r.db, query, tenantID, legalRequestID)
}

// ListTenantIDs enumerates tenants with at least one execution-state row, for
// the cross-tenant auto-close sweeper fan-out (mirrors ComplianceMonitor).
func (r *ExecutionRepository) ListTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `SELECT DISTINCT tenant_id FROM legal_request_delivery_confirmation WHERE status = 'requested'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var tenantID uuid.UUID
		if err := rows.Scan(&tenantID); err != nil {
			return nil, err
		}
		out = append(out, tenantID)
	}
	return out, rows.Err()
}
