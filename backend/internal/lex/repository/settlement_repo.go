package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// SettlementRepository owns the Settlements / ADR persistence (CAP-089..093):
// legal_settlement CRUD + FSM, legal_settlement_negotiation_rounds, and the
// append-only legal_settlement_audit_log. It mirrors MatterRepository /
// LegalCaseRepository conventions (tenant_id FIRST, JSON row projection,
// queryRowJSON/queryListJSON, soft-delete, sort allowlist). Counterparty PII is
// already field-encrypted by the service before it reaches Create/Update, so the
// repository stores opaque ciphertext.
type SettlementRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewSettlementRepository(db *pgxpool.Pool, logger zerolog.Logger) *SettlementRepository {
	return &SettlementRepository{db: db, logger: logger}
}

func (r *SettlementRepository) Create(ctx context.Context, q Queryer, s *model.Settlement) error {
	query := `
		INSERT INTO legal_settlement (
			id, tenant_id, matter_id, reference, status, method, title, terms, value, currency,
			counterparty_name, counterparty_contact, counterparty_id_number,
			workflow_instance_id, approved_by, approved_at, executed_at, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
			$11,$12,$13,
			$14,$15,$16,$17,$18,$19
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		s.ID, s.TenantID, s.MatterID, s.Reference, s.Status, s.Method, s.Title, s.Terms, s.Value, s.Currency,
		s.CounterpartyName, s.CounterpartyContact, s.CounterpartyIDNumber,
		s.WorkflowInstanceID, s.ApprovedBy, s.ApprovedAt, s.ExecutedAt, s.Metadata, s.CreatedBy,
	).Scan(&s.CreatedAt, &s.UpdatedAt)
}

func (r *SettlementRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.Settlement, error) {
	query := settlementJSONSelect(`s.tenant_id = $1 AND s.id = $2 AND s.deleted_at IS NULL`)
	return queryRowJSON[model.Settlement](ctx, r.db, query, tenantID, id)
}

// LockStatus row-locks the settlement FOR UPDATE inside tx and returns its current
// FSM status. It is the ApprovalSubjectSpec.LockSubject hook for the shared
// orchestrator. pgx.ErrNoRows when the settlement is missing/soft-deleted.
func (r *SettlementRepository) LockStatus(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (string, error) {
	var status string
	err := tx.QueryRow(ctx, `
		SELECT status
		FROM legal_settlement
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, id,
	).Scan(&status)
	return status, err
}

// MatterCloseSnapshot is the minimal matter projection CloseByReconciliation needs
// after it has locked + transitioned the owning matter: the open-window bounds for
// the case-resolution duration fact and the type/department dimensions for the
// case.closed event and fact bucketing.
type MatterCloseSnapshot struct {
	Type       string
	Department *string
	OpenedAt   time.Time
}

// LockMatterForClose row-locks the owning legal_matter FOR UPDATE inside tx and
// returns its current status plus the open-window/dimension snapshot. It is the
// read half of the compare-and-swap CloseByReconciliation performs: the lock is
// held until commit so a concurrent close blocks here, then re-reads a status that
// CloseMatterByReconciliation's guard rejects. pgx.ErrNoRows when the matter is
// missing/soft-deleted.
func (r *SettlementRepository) LockMatterForClose(ctx context.Context, tx pgx.Tx, tenantID, matterID uuid.UUID) (model.MatterStatus, MatterCloseSnapshot, error) {
	var (
		status string
		snap   MatterCloseSnapshot
	)
	err := tx.QueryRow(ctx, `
		SELECT status, type, department, opened_at
		FROM legal_matters
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, matterID,
	).Scan(&status, &snap.Type, &snap.Department, &snap.OpenedAt)
	if err != nil {
		return "", MatterCloseSnapshot{}, err
	}
	return model.MatterStatus(status), snap, nil
}

// CloseMatterByReconciliation transitions the owning matter to closed and stamps
// closure_reason='reconciliation' + closed_at in a single guarded UPDATE that only
// fires while the matter is NOT already terminal (closed/cancelled). This is the
// write half of the CAS: a second concurrent close — which blocked on
// LockMatterForClose and now sees status=closed — affects zero rows and gets
// pgx.ErrNoRows, so the matter can never be double-closed. q is the same tx that
// locked the row.
func (r *SettlementRepository) CloseMatterByReconciliation(ctx context.Context, q Queryer, tenantID, matterID uuid.UUID, closedAt time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_matters
		SET status = $3,
		    closed_at = $4,
		    closure_reason = 'reconciliation',
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2
		  AND deleted_at IS NULL
		  AND status NOT IN ('closed', 'cancelled')`,
		tenantID, matterID, model.MatterStatusClosed, closedAt,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *SettlementRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.SettlementListFilters) ([]model.Settlement, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"s.tenant_id = $1", "s.deleted_at IS NULL"}
	if filters.MatterID != nil {
		conditions = append(conditions, fmt.Sprintf("s.matter_id = $%d", arg))
		args = append(args, *filters.MatterID)
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("s.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if filters.Method != nil {
		conditions = append(conditions, fmt.Sprintf("s.method = $%d", arg))
		args = append(args, *filters.Method)
		arg++
	}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(s.title ILIKE '%%' || $%d || '%%' OR s.reference ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	where := strings.Join(conditions, " AND ")

	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_settlement s WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.Settlement{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	orderCol := "t.updated_at"
	if mapped, ok := settlementSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if strings.EqualFold(filters.SortDir, "asc") {
		orderDir = "ASC"
	}
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	query := settlementJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.Settlement](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// Report aggregates the Settlements / ADR vertical for the analytics report
// (FEATURES 1 + 3). It is tenant-scoped and honours the SAME filter params the
// List endpoint accepts (matter_id, status, method, search). It returns the
// matching PII-free line items plus the value/cycle-time facts computed in a
// single round-trip: counts + total value by status, the overall valued count,
// total value, and the create->execute cycle-time stats over executed rows. Page
// fields on the filters are ignored — the report is over the full filtered set.
func (r *SettlementRepository) Report(ctx context.Context, tenantID uuid.UUID, filters model.SettlementListFilters) (*model.SettlementReport, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"s.tenant_id = $1", "s.deleted_at IS NULL"}
	if filters.MatterID != nil {
		conditions = append(conditions, fmt.Sprintf("s.matter_id = $%d", arg))
		args = append(args, *filters.MatterID)
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("s.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if filters.Method != nil {
		conditions = append(conditions, fmt.Sprintf("s.method = $%d", arg))
		args = append(args, *filters.Method)
		arg++
	}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(s.title ILIKE '%%' || $%d || '%%' OR s.reference ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	where := strings.Join(conditions, " AND ")

	report := &model.SettlementReport{
		Settlements:   make([]model.SettlementSummary, 0),
		ByStatus:      map[string]int{},
		ByMethod:      map[string]int{},
		ValueByStatus: map[string]float64{},
	}

	// Line items (PII-free projection), ordered newest-first like the list default.
	rows, err := r.db.Query(ctx, `
		SELECT s.id, s.reference, s.matter_id, s.title, s.status, s.method,
		       s.value, s.currency, s.approved_at, s.executed_at, s.created_at
		FROM legal_settlement s
		WHERE `+where+`
		ORDER BY s.created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item model.SettlementSummary
		if err := rows.Scan(
			&item.ID, &item.Reference, &item.MatterID, &item.Title, &item.Status, &item.Method,
			&item.Value, &item.Currency, &item.ApprovedAt, &item.ExecutedAt, &item.CreatedAt,
		); err != nil {
			return nil, err
		}
		report.Settlements = append(report.Settlements, item)
		report.ByStatus[string(item.Status)]++
		report.ByMethod[string(item.Method)]++
		if item.Value != nil {
			report.ValueByStatus[string(item.Status)] += *item.Value
			report.TotalValue += *item.Value
			report.ValuedCount++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	report.Total = len(report.Settlements)
	report.SettledValue = report.ValueByStatus[string(model.SettlementStatusExecuted)]
	report.ValueAtRisk = report.ValueByStatus[string(model.SettlementStatusPendingApproval)]
	if report.ValuedCount > 0 {
		report.AverageValue = report.TotalValue / float64(report.ValuedCount)
	}

	// Cycle-time stats: create->execute turnaround in whole days over executed rows.
	var (
		execCount      int
		avg, min, maxD *float64
	)
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*),
		       AVG(EXTRACT(EPOCH FROM (s.executed_at - s.created_at)) / 86400.0),
		       MIN(EXTRACT(EPOCH FROM (s.executed_at - s.created_at)) / 86400.0),
		       MAX(EXTRACT(EPOCH FROM (s.executed_at - s.created_at)) / 86400.0)
		FROM legal_settlement s
		WHERE `+where+` AND s.executed_at IS NOT NULL`, args...,
	).Scan(&execCount, &avg, &min, &maxD); err != nil {
		return nil, err
	}
	report.CycleTime.ExecutedCount = execCount
	if avg != nil {
		report.CycleTime.AvgDays = *avg
	}
	if min != nil {
		report.CycleTime.MinDays = *min
	}
	if maxD != nil {
		report.CycleTime.MaxDays = *maxD
	}
	return report, nil
}

// Update writes the editable settlement fields (terms/value/method/counterparty
// PII/metadata). q may be a tx.
func (r *SettlementRepository) Update(ctx context.Context, q Queryer, s *model.Settlement) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_settlement
		SET reference = $3,
		    method = $4,
		    title = $5,
		    terms = $6,
		    value = $7,
		    currency = $8,
		    counterparty_name = $9,
		    counterparty_contact = $10,
		    counterparty_id_number = $11,
		    metadata = $12,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		s.TenantID, s.ID, s.Reference, s.Method, s.Title, s.Terms, s.Value, s.Currency,
		s.CounterpartyName, s.CounterpartyContact, s.CounterpartyIDNumber, s.Metadata,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// UpdateStatus drives the settlement FSM inside tx, optionally linking/clearing the
// approval workflow and stamping approval/execution timestamps.
func (r *SettlementRepository) UpdateStatus(ctx context.Context, q Queryer, tenantID, id uuid.UUID, status model.SettlementStatus, workflowInstanceID *uuid.UUID, clearWorkflow bool, approvedBy *uuid.UUID, approvedAt, executedAt *time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_settlement
		SET status = $3,
		    workflow_instance_id = CASE WHEN $5 THEN NULL ELSE COALESCE($4, workflow_instance_id) END,
		    approved_by = COALESCE($6, approved_by),
		    approved_at = COALESCE($7, approved_at),
		    executed_at = COALESCE($8, executed_at),
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, status, workflowInstanceID, clearWorkflow, approvedBy, approvedAt, executedAt,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// UpdateStatusGuarded drives the settlement FSM inside tx ONLY when the row is
// currently in expectedFrom, otherwise it leaves the row untouched and returns
// pgx.ErrNoRows. Combined with LockStatus / FOR UPDATE callers this makes every
// FSM transition compare-and-swap, so a concurrent double-transition (e.g. two
// in-flight CloseByReconciliation calls both reading status=approved) is rejected
// rather than silently applied twice. The optional approval/execution stamps and
// workflow-link mutation mirror UpdateStatus.
func (r *SettlementRepository) UpdateStatusGuarded(ctx context.Context, q Queryer, tenantID, id uuid.UUID, expectedFrom, status model.SettlementStatus, workflowInstanceID *uuid.UUID, clearWorkflow bool, approvedBy *uuid.UUID, approvedAt, executedAt *time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_settlement
		SET status = $4,
		    workflow_instance_id = CASE WHEN $6 THEN NULL ELSE COALESCE($5, workflow_instance_id) END,
		    approved_by = COALESCE($7, approved_by),
		    approved_at = COALESCE($8, approved_at),
		    executed_at = COALESCE($9, executed_at),
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND status = $3 AND deleted_at IS NULL`,
		tenantID, id, expectedFrom, status, workflowInstanceID, clearWorkflow, approvedBy, approvedAt, executedAt,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *SettlementRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_settlement SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- negotiation rounds (CAP-091) -------------------------------------------

// NextRoundNumber returns the next sequential round number for a settlement.
func (r *SettlementRepository) NextRoundNumber(ctx context.Context, q Queryer, tenantID, settlementID uuid.UUID) (int, error) {
	var next int
	err := q.QueryRow(ctx, `
		SELECT COALESCE(MAX(round_number), 0) + 1
		FROM legal_settlement_negotiation_rounds
		WHERE tenant_id = $1 AND settlement_id = $2`,
		tenantID, settlementID,
	).Scan(&next)
	return next, err
}

func (r *SettlementRepository) CreateRound(ctx context.Context, q Queryer, round *model.SettlementNegotiationRound) error {
	query := `
		INSERT INTO legal_settlement_negotiation_rounds (
			id, tenant_id, settlement_id, round_number, proposed_by, proposed_value, currency, terms, outcome, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		round.ID, round.TenantID, round.SettlementID, round.RoundNumber, round.ProposedBy,
		round.ProposedValue, round.Currency, round.Terms, round.Outcome, round.Metadata, round.CreatedBy,
	).Scan(&round.CreatedAt)
}

func (r *SettlementRepository) ListRounds(ctx context.Context, tenantID, settlementID uuid.UUID) ([]model.SettlementNegotiationRound, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT n.id, n.tenant_id, n.settlement_id, n.round_number, n.proposed_by,
			       n.proposed_value, n.currency, n.terms, n.outcome,
			       COALESCE(n.metadata, '{}'::jsonb) AS metadata, n.created_by, n.created_at
			FROM legal_settlement_negotiation_rounds n
			WHERE n.tenant_id = $1 AND n.settlement_id = $2
			ORDER BY n.round_number ASC
		) t`
	return queryListJSON[model.SettlementNegotiationRound](ctx, r.db, query, tenantID, settlementID)
}

// --- append-only audit log --------------------------------------------------

// AppendAudit inserts an immutable settlement governance audit row inside tx.
func (r *SettlementRepository) AppendAudit(ctx context.Context, q Queryer, entry *model.SettlementAuditEntry) error {
	query := `
		INSERT INTO legal_settlement_audit_log (
			id, tenant_id, settlement_id, action, from_status, to_status, detail, actor_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.SettlementID, entry.Action, entry.FromStatus, entry.ToStatus, entry.Detail, entry.ActorUserID,
	).Scan(&entry.CreatedAt)
}

func (r *SettlementRepository) ListAudit(ctx context.Context, tenantID, settlementID uuid.UUID) ([]model.SettlementAuditEntry, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT a.id, a.tenant_id, a.settlement_id, a.action, a.from_status, a.to_status,
			       COALESCE(a.detail, '{}'::jsonb) AS detail, a.actor_user_id, a.created_at
			FROM legal_settlement_audit_log a
			WHERE a.tenant_id = $1 AND a.settlement_id = $2
			ORDER BY a.created_at ASC
		) t`
	return queryListJSON[model.SettlementAuditEntry](ctx, r.db, query, tenantID, settlementID)
}

func settlementJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT s.id, s.tenant_id, s.matter_id, s.reference, s.status, s.method, s.title, s.terms,
			       s.value, s.currency, s.counterparty_name, s.counterparty_contact, s.counterparty_id_number,
			       s.workflow_instance_id, s.approved_by, s.approved_at, s.executed_at,
			       COALESCE(s.metadata, '{}'::jsonb) AS metadata,
			       s.created_by, s.created_at, s.updated_at, s.deleted_at
			FROM legal_settlement s
			WHERE ` + where + `
		) t`
}

func settlementSortColumn(column string) (string, bool) {
	switch column {
	case "reference":
		return "t.reference", true
	case "status":
		return "t.status", true
	case "method":
		return "t.method", true
	case "value":
		return "t.value", true
	case "updated_at":
		return "t.updated_at", true
	case "created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
