package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/model"
)

// InvestigationRepository persists the first-class legal-investigation aggregate
// (CAP-077..083) plus its parties, statements, evidence references and an
// append-only governance audit log. Queries filter by tenant_id (primary
// predicate) with table RLS as a backstop, mirroring legal_case_repo; reads
// project rows through row_to_json. Sensitive PII columns (subject,
// lead_investigator, findings, recommendations on the root; identifier/contact on
// parties; statement bodies) are transparently field-encrypted at rest via the
// shared FieldCrypto envelope when configured — the same seam contract_repo uses.
type InvestigationRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
	crypto *lexcrypto.FieldCrypto
}

func NewInvestigationRepository(db *pgxpool.Pool, logger zerolog.Logger) *InvestigationRepository {
	return &InvestigationRepository{db: db, logger: logger}
}

// WithFieldCrypto enables transparent field-level encryption at rest for the
// sensitive investigation PII columns. Returns the receiver for chaining.
func (r *InvestigationRepository) WithFieldCrypto(fc *lexcrypto.FieldCrypto) *InvestigationRepository {
	r.crypto = fc
	return r
}

// --- root: legal_investigations ---------------------------------------------

func (r *InvestigationRepository) Create(ctx context.Context, q Queryer, inv *model.LegalInvestigation) error {
	subject, lead, findings, recs, err := r.encryptRoot(inv.Subject, inv.LeadInvestigator, inv.Findings, inv.Recommendations)
	if err != nil {
		return err
	}
	metaJSON, err := json.Marshal(orEmptyMap(inv.Metadata))
	if err != nil {
		return fmt.Errorf("marshal investigation metadata: %w", err)
	}
	query := `
		INSERT INTO legal_investigations (
			id, tenant_id, investigation_number, subject, lead_investigator, status, priority,
			case_id, findings, recommendations, ai_drafted, department,
			workflow_instance_id, reminder_obligation_id, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12,
			$13,$14,$15::jsonb,$16
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		inv.ID, inv.TenantID, inv.InvestigationNumber, subject, lead, inv.Status, inv.Priority,
		inv.CaseID, findings, recs, inv.AIDrafted, inv.Department,
		inv.WorkflowInstanceID, inv.ReminderObligationID, metaJSON, inv.CreatedBy,
	).Scan(&inv.CreatedAt, &inv.UpdatedAt)
}

func (r *InvestigationRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalInvestigation, error) {
	query := investigationJSONSelect(`li.tenant_id = $1 AND li.id = $2 AND li.deleted_at IS NULL`)
	inv, err := queryRowJSON[model.LegalInvestigation](ctx, r.db, query, tenantID, id)
	if err != nil {
		return nil, err
	}
	if err := r.decryptRoot(inv); err != nil {
		return nil, err
	}
	return inv, nil
}

func (r *InvestigationRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.InvestigationListFilters) ([]model.LegalInvestigation, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"li.tenant_id = $1", "li.deleted_at IS NULL"}
	if filters.Search != "" {
		// subject/lead_investigator may be ciphertext at rest; search matches the
		// non-sensitive investigation_number only.
		conditions = append(conditions, fmt.Sprintf("li.investigation_number ILIKE '%%' || $%d || '%%'", arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("li.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if len(filters.Statuses) > 0 {
		statuses := make([]string, 0, len(filters.Statuses))
		for _, status := range filters.Statuses {
			statuses = append(statuses, string(status))
		}
		conditions = append(conditions, fmt.Sprintf("li.status = ANY($%d)", arg))
		args = append(args, statuses)
		arg++
	}
	if filters.Priority != nil {
		conditions = append(conditions, fmt.Sprintf("li.priority = $%d", arg))
		args = append(args, *filters.Priority)
		arg++
	}
	if filters.CaseID != nil {
		conditions = append(conditions, fmt.Sprintf("li.case_id = $%d", arg))
		args = append(args, *filters.CaseID)
		arg++
	}
	if filters.Department != "" {
		conditions = append(conditions, fmt.Sprintf("li.department = $%d", arg))
		args = append(args, filters.Department)
		arg++
	}
	if filters.CaseType != "" {
		conditions = append(conditions, fmt.Sprintf(
			"EXISTS (SELECT 1 FROM legal_cases lc WHERE lc.id = li.case_id AND lc.tenant_id = li.tenant_id AND lc.deleted_at IS NULL AND lc.case_type = $%d)",
			arg,
		))
		args = append(args, filters.CaseType)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_investigations li WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.LegalInvestigation{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := investigationSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := investigationJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.LegalInvestigation](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		if err := r.decryptRoot(&items[i]); err != nil {
			return nil, 0, err
		}
	}
	return items, total, nil
}

// ListOngoing returns the newest non-terminal investigations without first
// materialising an arbitrary list page. The root decrypt path is intentionally
// reused because subject/lead/findings/recommendations are encrypted at rest.
// Portfolio counts are computed separately by ReportingRepository and never
// inferred from the length of this presentation slice.
func (r *InvestigationRepository) ListOngoing(ctx context.Context, tenantID uuid.UUID, limit int) ([]model.LegalInvestigation, error) {
	if limit <= 0 {
		return []model.LegalInvestigation{}, nil
	}
	if limit > 20 {
		limit = 20
	}
	query := investigationJSONSelect(`
		li.tenant_id = $1
		AND li.deleted_at IS NULL
		AND li.status IN ('registered', 'in_progress', 'results_recorded', 'pending_approval', 'rejected')
	`) + " ORDER BY t.updated_at DESC, t.id ASC LIMIT $2"
	items, err := queryListJSON[model.LegalInvestigation](ctx, r.db, query, tenantID, limit)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if err := r.decryptRoot(&items[i]); err != nil {
			return nil, err
		}
	}
	return items, nil
}

func (r *InvestigationRepository) Update(ctx context.Context, q Queryer, inv *model.LegalInvestigation) error {
	subject, lead, _, _, err := r.encryptRoot(inv.Subject, inv.LeadInvestigator, "", "")
	if err != nil {
		return err
	}
	metaJSON, err := json.Marshal(orEmptyMap(inv.Metadata))
	if err != nil {
		return fmt.Errorf("marshal investigation metadata: %w", err)
	}
	query := `
		UPDATE legal_investigations
		SET subject = $3,
		    lead_investigator = $4,
		    priority = $5,
		    case_id = $6,
		    department = $7,
		    metadata = $8::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		inv.TenantID, inv.ID, subject, lead, inv.Priority, inv.CaseID, inv.Department, metaJSON,
	).Scan(&inv.UpdatedAt)
}

// LockStatus loads + row-locks the investigation (FOR UPDATE) inside tx and
// returns its current FSM status. Used by the investigation approval orchestrator
// subject hook.
func (r *InvestigationRepository) LockStatus(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (string, error) {
	var status string
	err := tx.QueryRow(ctx, `
		SELECT status
		FROM legal_investigations
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, id,
	).Scan(&status)
	return status, err
}

// LockForUpdate row-locks the investigation (FOR UPDATE) inside tx and projects
// the full decrypted aggregate root (no child collections). It is the
// concurrency-safe reload used by the results-approval path so a double-approve
// races on the row lock instead of the application read. Returns pgx.ErrNoRows
// when the investigation is missing/soft-deleted.
func (r *InvestigationRepository) LockForUpdate(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (*model.LegalInvestigation, error) {
	// Acquire the row lock first (row_to_json over a CTE cannot carry FOR UPDATE).
	var locked uuid.UUID
	if err := tx.QueryRow(ctx, `
		SELECT id
		FROM legal_investigations
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, id,
	).Scan(&locked); err != nil {
		return nil, err
	}
	query := investigationJSONSelect(`li.tenant_id = $1 AND li.id = $2 AND li.deleted_at IS NULL`)
	inv, err := queryRowJSON[model.LegalInvestigation](ctx, tx, query, tenantID, id)
	if err != nil {
		return nil, err
	}
	if err := r.decryptRoot(inv); err != nil {
		return nil, err
	}
	return inv, nil
}

// UpdateStatusTx advances the investigation FSM inside a transaction, optionally
// linking a workflow instance (COALESCE leaves it unchanged when nil).
func (r *InvestigationRepository) UpdateStatusTx(ctx context.Context, q Queryer, tenantID, id uuid.UUID, status model.InvestigationStatus, workflowInstanceID *uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_investigations
		SET status = $3,
		    workflow_instance_id = COALESCE($4, workflow_instance_id),
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, status, workflowInstanceID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// UpdateTerminalStatusTx records a close/cancel transition and its actor/reason
// atomically. Keeping the attribution on the root lets every representation show
// an explicit terminal state without reconstructing it from the audit stream.
func (r *InvestigationRepository) UpdateTerminalStatusTx(ctx context.Context, q Queryer, tenantID, id, actorID uuid.UUID, status model.InvestigationStatus, reason string, closedAt time.Time) error {
	return r.UpdateTerminalStatusWithLateJustificationTx(ctx, q, tenantID, id, actorID, status, reason, closedAt, nil, nil)
}

func (r *InvestigationRepository) UpdateTerminalStatusWithLateJustificationTx(
	ctx context.Context,
	q Queryer,
	tenantID, id, actorID uuid.UUID,
	status model.InvestigationStatus,
	reason string,
	closedAt time.Time,
	lateJustification *string,
	managerRole *string,
) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_investigations
		SET status = $3,
		    closed_by = $4,
		    closed_at = $5,
		    closure_reason = $6,
		    late_justification = $7,
		    late_justification_submitted_by = CASE WHEN $7::text IS NULL THEN NULL ELSE $4 END,
		    late_justification_submitted_at = CASE WHEN $7::text IS NULL THEN NULL ELSE $5 END,
		    late_justification_manager_role = $8,
		    updated_at = $5
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, status, actorID, closedAt, strings.TrimSpace(reason), lateJustification, managerRole,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ClearWorkflowStatusTx advances the FSM and nulls the workflow link in one
// statement (used by the approval-orchestrator advance hook on resolve).
func (r *InvestigationRepository) ClearWorkflowStatusTx(ctx context.Context, q Queryer, tenantID, id uuid.UUID, status model.InvestigationStatus) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_investigations
		SET status = $3, workflow_instance_id = NULL, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, status,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// UpdateFindings records the (optionally AI-drafted) findings body (CAP-081).
func (r *InvestigationRepository) UpdateFindings(ctx context.Context, q Queryer, tenantID, id uuid.UUID, findings string, aiDrafted bool, status model.InvestigationStatus) error {
	enc, err := r.encryptOne(findings)
	if err != nil {
		return err
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_investigations
		SET findings = $3, ai_drafted = $4, status = $5, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, enc, aiDrafted, status,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// UpdateRecommendations records the final recommendation body (CAP-082).
func (r *InvestigationRepository) UpdateRecommendations(ctx context.Context, q Queryer, tenantID, id uuid.UUID, recommendations string, aiDrafted bool) error {
	enc, err := r.encryptOne(recommendations)
	if err != nil {
		return err
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_investigations
		SET recommendations = $3, ai_drafted = $4, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, enc, aiDrafted,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// SetReminderObligation links the auto-created reminder obligation onto the
// investigation (objection/hearing-deadline reminder, CAP-077).
func (r *InvestigationRepository) SetReminderObligation(ctx context.Context, q Queryer, tenantID, id, obligationID uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_investigations
		SET reminder_obligation_id = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, obligationID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *InvestigationRepository) SoftDelete(ctx context.Context, q Queryer, tenantID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `UPDATE legal_investigations SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- parties: legal_investigation_parties -----------------------------------

func (r *InvestigationRepository) CreateParty(ctx context.Context, q Queryer, p *model.InvestigationParty) error {
	identifier, contact, err := r.encryptPartyPII(p.Identifier, p.Contact)
	if err != nil {
		return err
	}
	metaJSON, err := json.Marshal(orEmptyMap(p.Metadata))
	if err != nil {
		return fmt.Errorf("marshal investigation party metadata: %w", err)
	}
	query := `
		INSERT INTO legal_investigation_parties (
			id, tenant_id, investigation_id, role, name, identifier, contact, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		p.ID, p.TenantID, p.InvestigationID, p.Role, p.Name, identifier, contact, metaJSON, p.CreatedBy,
	).Scan(&p.CreatedAt, &p.UpdatedAt)
}

func (r *InvestigationRepository) GetParty(ctx context.Context, tenantID, investigationID, id uuid.UUID) (*model.InvestigationParty, error) {
	query := investigationPartyJSONSelect(`ip.tenant_id = $1 AND ip.investigation_id = $2 AND ip.id = $3 AND ip.deleted_at IS NULL`)
	p, err := queryRowJSON[model.InvestigationParty](ctx, r.db, query, tenantID, investigationID, id)
	if err != nil {
		return nil, err
	}
	if err := r.decryptParty(p); err != nil {
		return nil, err
	}
	return p, nil
}

func (r *InvestigationRepository) ListParties(ctx context.Context, tenantID, investigationID uuid.UUID) ([]model.InvestigationParty, error) {
	query := investigationPartyJSONSelect(`ip.tenant_id = $1 AND ip.investigation_id = $2 AND ip.deleted_at IS NULL`) + " ORDER BY t.created_at ASC"
	items, err := queryListJSON[model.InvestigationParty](ctx, r.db, query, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if err := r.decryptParty(&items[i]); err != nil {
			return nil, err
		}
	}
	return items, nil
}

func (r *InvestigationRepository) UpdateParty(ctx context.Context, q Queryer, p *model.InvestigationParty) error {
	identifier, contact, err := r.encryptPartyPII(p.Identifier, p.Contact)
	if err != nil {
		return err
	}
	metaJSON, err := json.Marshal(orEmptyMap(p.Metadata))
	if err != nil {
		return fmt.Errorf("marshal investigation party metadata: %w", err)
	}
	query := `
		UPDATE legal_investigation_parties
		SET role = $4, name = $5, identifier = $6, contact = $7, metadata = $8::jsonb, updated_at = now()
		WHERE tenant_id = $1 AND investigation_id = $2 AND id = $3 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		p.TenantID, p.InvestigationID, p.ID, p.Role, p.Name, identifier, contact, metaJSON,
	).Scan(&p.UpdatedAt)
}

func (r *InvestigationRepository) SoftDeleteParty(ctx context.Context, q Queryer, tenantID, investigationID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `UPDATE legal_investigation_parties SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND investigation_id = $2 AND id = $3 AND deleted_at IS NULL`, tenantID, investigationID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- statements: legal_investigation_statements -----------------------------

func (r *InvestigationRepository) CreateStatement(ctx context.Context, q Queryer, s *model.InvestigationStatement) error {
	statement, err := r.encryptOne(s.Statement)
	if err != nil {
		return err
	}
	metaJSON, err := json.Marshal(orEmptyMap(s.Metadata))
	if err != nil {
		return fmt.Errorf("marshal investigation statement metadata: %w", err)
	}
	query := `
		INSERT INTO legal_investigation_statements (
			id, tenant_id, investigation_id, deponent_party_id, deponent_name, statement, taken_at, taken_by, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		s.ID, s.TenantID, s.InvestigationID, s.DeponentPartyID, s.DeponentName, statement, s.TakenAt, s.TakenBy, metaJSON, s.CreatedBy,
	).Scan(&s.CreatedAt, &s.UpdatedAt)
}

func (r *InvestigationRepository) GetStatement(ctx context.Context, tenantID, investigationID, id uuid.UUID) (*model.InvestigationStatement, error) {
	query := investigationStatementJSONSelect(`ist.tenant_id = $1 AND ist.investigation_id = $2 AND ist.id = $3 AND ist.deleted_at IS NULL`)
	s, err := queryRowJSON[model.InvestigationStatement](ctx, r.db, query, tenantID, investigationID, id)
	if err != nil {
		return nil, err
	}
	if err := r.decryptStatement(s); err != nil {
		return nil, err
	}
	return s, nil
}

func (r *InvestigationRepository) ListStatements(ctx context.Context, tenantID, investigationID uuid.UUID) ([]model.InvestigationStatement, error) {
	query := investigationStatementJSONSelect(`ist.tenant_id = $1 AND ist.investigation_id = $2 AND ist.deleted_at IS NULL`) + " ORDER BY t.taken_at ASC"
	items, err := queryListJSON[model.InvestigationStatement](ctx, r.db, query, tenantID, investigationID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if err := r.decryptStatement(&items[i]); err != nil {
			return nil, err
		}
	}
	return items, nil
}

func (r *InvestigationRepository) SoftDeleteStatement(ctx context.Context, q Queryer, tenantID, investigationID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `UPDATE legal_investigation_statements SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND investigation_id = $2 AND id = $3 AND deleted_at IS NULL`, tenantID, investigationID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- evidence: legal_investigation_evidence ---------------------------------

func (r *InvestigationRepository) CreateEvidence(ctx context.Context, q Queryer, e *model.InvestigationEvidence) error {
	metaJSON, err := json.Marshal(orEmptyMap(e.Metadata))
	if err != nil {
		return fmt.Errorf("marshal investigation evidence metadata: %w", err)
	}
	query := `
		INSERT INTO legal_investigation_evidence (
			id, tenant_id, investigation_id, file_id, title, description, evidence_type, collected_by, collected_at, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		e.ID, e.TenantID, e.InvestigationID, e.FileID, e.Title, e.Description, e.EvidenceType, e.CollectedBy, e.CollectedAt, metaJSON, e.CreatedBy,
	).Scan(&e.CreatedAt, &e.UpdatedAt)
}

func (r *InvestigationRepository) ListEvidence(ctx context.Context, tenantID, investigationID uuid.UUID) ([]model.InvestigationEvidence, error) {
	query := investigationEvidenceJSONSelect(`ie.tenant_id = $1 AND ie.investigation_id = $2 AND ie.deleted_at IS NULL`) + " ORDER BY t.created_at ASC"
	return queryListJSON[model.InvestigationEvidence](ctx, r.db, query, tenantID, investigationID)
}

func (r *InvestigationRepository) SoftDeleteEvidence(ctx context.Context, q Queryer, tenantID, investigationID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `UPDATE legal_investigation_evidence SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND investigation_id = $2 AND id = $3 AND deleted_at IS NULL`, tenantID, investigationID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- governance: legal_investigation_audit_log (append-only) -----------------

func (r *InvestigationRepository) AppendAudit(ctx context.Context, q Queryer, entry *model.InvestigationAuditEntry) error {
	detailJSON, err := json.Marshal(orEmptyMap(entry.Detail))
	if err != nil {
		return fmt.Errorf("marshal investigation audit detail: %w", err)
	}
	query := `
		INSERT INTO legal_investigation_audit_log (
			id, tenant_id, investigation_id, action, from_status, to_status, detail, actor_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.InvestigationID, entry.Action, entry.FromStatus, entry.ToStatus, detailJSON, entry.ActorUserID,
	).Scan(&entry.CreatedAt)
}

// AppendAuditFull writes one append-only governance audit row carrying explicit
// before/after JSONB snapshots and a free-text reason in addition to the legacy
// from_status/to_status/detail columns. The before/after/reason columns are added
// by the staged round-2 migration (legal_investigation_audit_log additive ALTER);
// this method requires them. It mirrors the classification audit's before/after
// contract so the investigation ledger captures full mutation diffs. Immutable:
// the table has no UPDATE/DELETE RLS policy.
func (r *InvestigationRepository) AppendAuditFull(ctx context.Context, q Queryer, entry *model.InvestigationAuditEntry, before, after any, reason string) error {
	detailJSON, err := json.Marshal(orEmptyMap(entry.Detail))
	if err != nil {
		return fmt.Errorf("marshal investigation audit detail: %w", err)
	}
	beforeJSON, err := marshalAuditSnapshot(before)
	if err != nil {
		return fmt.Errorf("marshal investigation audit before: %w", err)
	}
	afterJSON, err := marshalAuditSnapshot(after)
	if err != nil {
		return fmt.Errorf("marshal investigation audit after: %w", err)
	}
	var reasonArg any
	if trimmed := strings.TrimSpace(reason); trimmed != "" {
		reasonArg = trimmed
	}
	query := `
		INSERT INTO legal_investigation_audit_log (
			id, tenant_id, investigation_id, action, from_status, to_status, detail, actor_user_id, before, after, reason
		) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.InvestigationID, entry.Action, entry.FromStatus, entry.ToStatus, detailJSON, entry.ActorUserID, beforeJSON, afterJSON, reasonArg,
	).Scan(&entry.CreatedAt)
}

func (r *InvestigationRepository) ListAudit(ctx context.Context, tenantID, investigationID uuid.UUID) ([]model.InvestigationAuditEntry, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT al.id, al.tenant_id, al.investigation_id, al.action, al.from_status, al.to_status,
			       COALESCE(al.detail, '{}'::jsonb) AS detail,
			       al.before, al.after, al.reason, al.actor_user_id, al.created_at
			FROM legal_investigation_audit_log al
			WHERE al.tenant_id = $1 AND al.investigation_id = $2
			ORDER BY al.created_at ASC
		) t`
	return queryListJSON[model.InvestigationAuditEntry](ctx, r.db, query, tenantID, investigationID)
}

// --- crypto helpers ----------------------------------------------------------

func (r *InvestigationRepository) encryptOne(value string) (string, error) {
	if r.crypto == nil {
		return value, nil
	}
	return r.crypto.Encrypt(value)
}

func (r *InvestigationRepository) encryptRoot(subject, lead, findings, recs string) (string, string, string, string, error) {
	if r.crypto == nil {
		return subject, lead, findings, recs, nil
	}
	encSubject, err := r.crypto.Encrypt(subject)
	if err != nil {
		return "", "", "", "", err
	}
	encLead, err := r.crypto.Encrypt(lead)
	if err != nil {
		return "", "", "", "", err
	}
	encFindings, err := r.crypto.Encrypt(findings)
	if err != nil {
		return "", "", "", "", err
	}
	encRecs, err := r.crypto.Encrypt(recs)
	if err != nil {
		return "", "", "", "", err
	}
	return encSubject, encLead, encFindings, encRecs, nil
}

func (r *InvestigationRepository) decryptRoot(inv *model.LegalInvestigation) error {
	if r.crypto == nil || inv == nil {
		return nil
	}
	var err error
	if inv.Subject, err = r.crypto.Decrypt(inv.Subject); err != nil {
		return err
	}
	if inv.LeadInvestigator, err = r.crypto.Decrypt(inv.LeadInvestigator); err != nil {
		return err
	}
	if inv.Findings, err = r.crypto.Decrypt(inv.Findings); err != nil {
		return err
	}
	if inv.Recommendations, err = r.crypto.Decrypt(inv.Recommendations); err != nil {
		return err
	}
	return nil
}

func (r *InvestigationRepository) encryptPartyPII(identifier, contact *string) (*string, *string, error) {
	if r.crypto == nil {
		return identifier, contact, nil
	}
	encID, err := r.crypto.EncryptPtr(identifier)
	if err != nil {
		return nil, nil, err
	}
	encContact, err := r.crypto.EncryptPtr(contact)
	if err != nil {
		return nil, nil, err
	}
	return encID, encContact, nil
}

func (r *InvestigationRepository) decryptParty(p *model.InvestigationParty) error {
	if r.crypto == nil || p == nil {
		return nil
	}
	var err error
	if p.Identifier, err = r.crypto.DecryptPtr(p.Identifier); err != nil {
		return err
	}
	if p.Contact, err = r.crypto.DecryptPtr(p.Contact); err != nil {
		return err
	}
	return nil
}

func (r *InvestigationRepository) decryptStatement(s *model.InvestigationStatement) error {
	if r.crypto == nil || s == nil {
		return nil
	}
	var err error
	if s.Statement, err = r.crypto.Decrypt(s.Statement); err != nil {
		return err
	}
	return nil
}

// --- JSON projections + sort allow-list -------------------------------------

func investigationJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT li.id, li.tenant_id, li.investigation_number, li.subject, li.lead_investigator,
			       li.status, li.priority, li.case_id, li.findings, li.recommendations, li.ai_drafted,
			       li.department, li.workflow_instance_id, li.reminder_obligation_id,
			       (SELECT clock.turnaround_due_at
			        FROM legal_sla_clocks clock
			        WHERE clock.tenant_id = li.tenant_id
			          AND clock.legal_request_id = li.id
			          AND clock.outcome = 'pending'
			        ORDER BY clock.cycle DESC
			        LIMIT 1) AS sla_deadline,
			       li.late_justification, li.late_justification_submitted_by,
			       li.late_justification_submitted_at, li.late_justification_manager_role,
			       COALESCE(li.metadata, '{}'::jsonb) AS metadata,
			       li.created_by, li.closed_by, li.closed_at, li.closure_reason,
			       li.created_at, li.updated_at, li.deleted_at
			FROM legal_investigations li
			WHERE ` + where + `
		) t`
}

func investigationPartyJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT ip.id, ip.tenant_id, ip.investigation_id, ip.role, ip.name, ip.identifier,
			       ip.contact, COALESCE(ip.metadata, '{}'::jsonb) AS metadata,
			       ip.created_by, ip.created_at, ip.updated_at, ip.deleted_at
			FROM legal_investigation_parties ip
			WHERE ` + where + `
		) t`
}

func investigationStatementJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT ist.id, ist.tenant_id, ist.investigation_id, ist.deponent_party_id, ist.deponent_name,
			       ist.statement, ist.taken_at, ist.taken_by, COALESCE(ist.metadata, '{}'::jsonb) AS metadata,
			       ist.created_by, ist.created_at, ist.updated_at, ist.deleted_at
			FROM legal_investigation_statements ist
			WHERE ` + where + `
		) t`
}

func investigationEvidenceJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT ie.id, ie.tenant_id, ie.investigation_id, ie.file_id, ie.title, ie.description,
			       ie.evidence_type, ie.collected_by, ie.collected_at, COALESCE(ie.metadata, '{}'::jsonb) AS metadata,
			       ie.created_by, ie.created_at, ie.updated_at, ie.deleted_at
			FROM legal_investigation_evidence ie
			WHERE ` + where + `
		) t`
}

func investigationSortColumn(column string) (string, bool) {
	switch column {
	case "li.investigation_number":
		return "t.investigation_number", true
	case "li.status":
		return "t.status", true
	case "li.priority":
		return "t.priority", true
	case "li.updated_at":
		return "t.updated_at", true
	case "li.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
