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

	"github.com/clario360/platform/internal/lex/model"
)

// LegalCaseRepository persists the first-class litigation case aggregate
// (CAP-032..051) plus its append-only governance audit log and immutable version
// history. Queries filter by tenant_id (primary predicate) with table RLS as a
// backstop, mirroring matter_repo. Reads project rows through row_to_json so the
// bilingual title (forms.LocalizedText) round-trips via json.Unmarshal. Writes
// that participate in a transaction accept a Queryer so the case row, its
// governance audit row and a version snapshot commit atomically.
type LegalCaseRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewLegalCaseRepository(db *pgxpool.Pool, logger zerolog.Logger) *LegalCaseRepository {
	return &LegalCaseRepository{db: db, logger: logger}
}

func (r *LegalCaseRepository) Create(ctx context.Context, q Queryer, c *model.LegalCase) error {
	titleJSON, err := json.Marshal(c.Title)
	if err != nil {
		return fmt.Errorf("marshal legal case title: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal legal case metadata: %w", err)
	}
	query := `
		INSERT INTO legal_cases (
			id, tenant_id, case_number, court_number, case_type, other_case_type, classification_id,
			court_id, contract_id, company_status, competent_court, chamber, filing_date, title, description, strength,
			claim_amount, court_fees, legal_fees, currency, expected_resolution_date, status, priority,
			section_manager_id, supervisor_id, handling_officer_id, responsible_lawyer,
			department, request_id, workflow_instance_id, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,
			$17,$18,$19,$20,$21,$22,$23,
			$24,$25,$26,$27,
			$28,$29,$30,$31::jsonb,$32
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		c.ID, c.TenantID, c.CaseNumber, c.CourtNumber, c.CaseType, c.OtherCaseType, c.ClassificationID,
		c.CourtID, c.ContractID, c.CompanyStatus, c.CompetentCourt, c.Chamber, legalCaseDatePtr(c.FilingDate),
		titleJSON, c.Description, c.Strength,
		c.ClaimAmount, c.CourtFees, c.LegalFees, c.Currency, legalCaseDatePtr(c.ExpectedResolution),
		c.Status, c.Priority,
		c.SectionManagerID, c.SupervisorID, c.HandlingOfficerID, c.ResponsibleLawyer,
		c.Department, c.RequestID, c.WorkflowInstanceID, metaJSON, c.CreatedBy,
	).Scan(&c.CreatedAt, &c.UpdatedAt)
}

func (r *LegalCaseRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalCase, error) {
	query := legalCaseJSONSelect(`lc.tenant_id = $1 AND lc.id = $2 AND lc.deleted_at IS NULL`)
	return queryRowJSON[model.LegalCase](ctx, r.db, query, tenantID, id)
}

func (r *LegalCaseRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.LegalCaseListFilters) ([]model.LegalCase, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"lc.tenant_id = $1", "lc.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf(`(
			lc.case_number ILIKE '%%' || $%[1]d || '%%'
			OR lc.court_number ILIKE '%%' || $%[1]d || '%%'
			OR lc.title->>'ar' ILIKE '%%' || $%[1]d || '%%'
			OR lc.title->>'en' ILIKE '%%' || $%[1]d || '%%'
			OR lc.description ILIKE '%%' || $%[1]d || '%%'
			OR lc.competent_court ILIKE '%%' || $%[1]d || '%%'
			OR lc.responsible_lawyer ILIKE '%%' || $%[1]d || '%%'
			OR lc.department ILIKE '%%' || $%[1]d || '%%'
			OR EXISTS (
				SELECT 1 FROM legal_case_parties p
				WHERE p.tenant_id = lc.tenant_id
				  AND p.case_id = lc.id
				  AND p.deleted_at IS NULL
				  AND (p.name ILIKE '%%' || $%[1]d || '%%'
				       OR p.identifier ILIKE '%%' || $%[1]d || '%%'
				       OR p.contact ILIKE '%%' || $%[1]d || '%%')
			)
			OR EXISTS (
				SELECT 1 FROM legal_pleadings pl
				WHERE pl.tenant_id = lc.tenant_id
				  AND pl.case_id = lc.id
				  AND pl.deleted_at IS NULL
				  AND (pl.pleading_number ILIKE '%%' || $%[1]d || '%%'
				       OR pl.title ILIKE '%%' || $%[1]d || '%%'
				       OR pl.body ILIKE '%%' || $%[1]d || '%%')
			)
			OR EXISTS (
				SELECT 1 FROM legal_judgments j
				WHERE j.tenant_id = lc.tenant_id
				  AND j.case_id = lc.id
				  AND j.deleted_at IS NULL
				  AND (j.judgment_ref ILIKE '%%' || $%[1]d || '%%'
				       OR j.summary ILIKE '%%' || $%[1]d || '%%'
				       OR j.study_notes ILIKE '%%' || $%[1]d || '%%')
			)
			OR EXISTS (
				SELECT 1 FROM legal_defendant_cases dc
				WHERE dc.tenant_id = lc.tenant_id
				  AND dc.case_id = lc.id
				  AND dc.deleted_at IS NULL
				  AND (dc.plaintiff_name ILIKE '%%' || $%[1]d || '%%'
				       OR dc.court_name ILIKE '%%' || $%[1]d || '%%'
				       OR dc.company_representative ILIKE '%%' || $%[1]d || '%%'
				       OR dc.najiz_reference ILIKE '%%' || $%[1]d || '%%'
				       OR dc.concerned_department ILIKE '%%' || $%[1]d || '%%'
				       OR dc.response_memo ILIKE '%%' || $%[1]d || '%%')
			)
			OR EXISTS (
				SELECT 1
				FROM legal_case_documents cd
				JOIN legal_documents d
				  ON d.tenant_id = cd.tenant_id
				 AND d.id = cd.document_id
				 AND d.deleted_at IS NULL
				WHERE cd.tenant_id = lc.tenant_id
				  AND cd.case_id = lc.id
				  AND cd.deleted_at IS NULL
				  AND (cd.source ILIKE '%%' || $%[1]d || '%%'
				       OR cd.category ILIKE '%%' || $%[1]d || '%%'
				       OR cd.notes ILIKE '%%' || $%[1]d || '%%'
				       OR d.title ILIKE '%%' || $%[1]d || '%%'
				       OR d.description ILIKE '%%' || $%[1]d || '%%'
				       OR d.file_name ILIKE '%%' || $%[1]d || '%%'
				       OR d.category ILIKE '%%' || $%[1]d || '%%'
				       OR EXISTS (
				          SELECT 1 FROM unnest(COALESCE(d.tags, '{}')) tag
				          WHERE tag ILIKE '%%' || $%[1]d || '%%'
				       ))
			)
		)`, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("lc.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if len(filters.Statuses) > 0 {
		statuses := make([]string, 0, len(filters.Statuses))
		for _, status := range filters.Statuses {
			statuses = append(statuses, string(status))
		}
		conditions = append(conditions, fmt.Sprintf("lc.status = ANY($%d)", arg))
		args = append(args, statuses)
		arg++
	}
	if filters.CompanyStatus != nil {
		conditions = append(conditions, fmt.Sprintf("lc.company_status = $%d", arg))
		args = append(args, *filters.CompanyStatus)
		arg++
	}
	if filters.Strength != nil {
		conditions = append(conditions, fmt.Sprintf("lc.strength = $%d", arg))
		args = append(args, *filters.Strength)
		arg++
	}
	if filters.RiskRating != nil {
		conditions = append(conditions, fmt.Sprintf("lc.risk_rating = $%d", arg))
		args = append(args, *filters.RiskRating)
		arg++
	}
	if filters.Priority != nil {
		conditions = append(conditions, fmt.Sprintf("lc.priority = $%d", arg))
		args = append(args, *filters.Priority)
		arg++
	}
	if filters.CaseType != "" {
		conditions = append(conditions, fmt.Sprintf("lc.case_type = $%d", arg))
		args = append(args, filters.CaseType)
		arg++
	}
	if filters.CaseTypeUnassigned {
		conditions = append(conditions, "NULLIF(BTRIM(lc.case_type), '') IS NULL")
	}
	if filters.ExpectedResolutionFrom != nil {
		conditions = append(conditions, fmt.Sprintf("lc.expected_resolution_date >= $%d", arg))
		args = append(args, *filters.ExpectedResolutionFrom)
		arg++
	}
	if filters.ExpectedResolutionTo != nil {
		conditions = append(conditions, fmt.Sprintf("lc.expected_resolution_date <= $%d", arg))
		args = append(args, *filters.ExpectedResolutionTo)
		arg++
	}
	if filters.ClassificationID != nil {
		conditions = append(conditions, fmt.Sprintf("lc.classification_id = $%d", arg))
		args = append(args, *filters.ClassificationID)
		arg++
	}
	if filters.SectionManagerID != nil {
		conditions = append(conditions, fmt.Sprintf("lc.section_manager_id = $%d", arg))
		args = append(args, *filters.SectionManagerID)
		arg++
	}
	if filters.SupervisorID != nil {
		conditions = append(conditions, fmt.Sprintf("lc.supervisor_id = $%d", arg))
		args = append(args, *filters.SupervisorID)
		arg++
	}
	if filters.HandlingOfficerID != nil {
		conditions = append(conditions, fmt.Sprintf("lc.handling_officer_id = $%d", arg))
		args = append(args, *filters.HandlingOfficerID)
		arg++
	}
	if filters.HandlingOfficerUnassigned {
		conditions = append(conditions, "lc.handling_officer_id IS NULL")
	}
	if filters.Department != "" {
		conditions = append(conditions, fmt.Sprintf("lc.department = $%d", arg))
		args = append(args, filters.Department)
		arg++
	}
	if filters.RequestID != nil {
		conditions = append(conditions, fmt.Sprintf("lc.request_id = $%d", arg))
		args = append(args, *filters.RequestID)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_cases lc WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.LegalCase{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := legalCaseSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := legalCaseJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.LegalCase](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *LegalCaseRepository) Update(ctx context.Context, q Queryer, c *model.LegalCase) error {
	titleJSON, err := json.Marshal(c.Title)
	if err != nil {
		return fmt.Errorf("marshal legal case title: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal legal case metadata: %w", err)
	}
	query := `
		UPDATE legal_cases
		SET case_number = $3,
		    court_number = $4,
		    case_type = $5,
		    classification_id = $6,
		    company_status = $7,
		    competent_court = $8,
		    chamber = $9,
		    filing_date = $10,
		    title = $11::jsonb,
		    description = $12,
		    strength = $13,
		    claim_amount = $14,
		    court_fees = $15,
		    legal_fees = $16,
		    currency = $17,
		    expected_resolution_date = $18,
		    responsible_lawyer = $19,
		    department = $20,
		    metadata = $21::jsonb,
		    priority = $22,
		    other_case_type = $23,
		    court_id = $24,
		    contract_id = $25,
		    request_id = $26,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		c.TenantID, c.ID, c.CaseNumber, c.CourtNumber, c.CaseType, c.ClassificationID,
		c.CompanyStatus, c.CompetentCourt, c.Chamber, legalCaseDatePtr(c.FilingDate),
		titleJSON, c.Description, c.Strength, c.ClaimAmount, c.CourtFees, c.LegalFees,
		c.Currency, legalCaseDatePtr(c.ExpectedResolution),
		c.ResponsibleLawyer, c.Department, metaJSON, c.Priority,
		c.OtherCaseType, c.CourtID, c.ContractID, c.RequestID,
	).Scan(&c.UpdatedAt)
}

// LockStatus loads + row-locks the case (FOR UPDATE) inside tx and returns its
// current FSM status. Used by the case approval orchestrator subject hook.
func (r *LegalCaseRepository) LockStatus(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (string, error) {
	var status string
	err := tx.QueryRow(ctx, `
		SELECT status
		FROM legal_cases
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, id,
	).Scan(&status)
	return status, err
}

// UpdateStatusTx advances the case FSM inside a transaction, optionally linking a
// workflow instance (COALESCE leaves it unchanged when nil). It bumps lock_version
// so a concurrent guarded transition observes the change.
func (r *LegalCaseRepository) UpdateStatusTx(ctx context.Context, q Queryer, tenantID, id uuid.UUID, status model.CaseStatus, workflowInstanceID *uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_cases
		SET status = $3,
		    workflow_instance_id = COALESCE($4, workflow_instance_id),
		    lock_version = lock_version + 1,
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

// CaseStatusTransition is the guarded-transition payload for UpdateStatusGuarded.
// ClockStartedAt, when non-nil, stamps the SLA-clock-start instant on case open
// (WS3/C-2); HoldCategory/HoldReason carry the classified delay facts on an
// on_hold transition and are cleared (set to NULL) on any non-hold target.
type CaseStatusTransition struct {
	ExpectedFrom                 model.CaseStatus
	To                           model.CaseStatus
	ClockStartedAt               *time.Time
	HoldCategory                 *model.DelayCategory
	HoldReason                   *string
	LateJustification            *string
	LateJustificationSubmittedBy *uuid.UUID
	LateJustificationSubmittedAt *time.Time
	LateJustificationManagerRole *string
}

// UpdateStatusGuarded advances the case FSM with an optimistic guard: the UPDATE
// only matches when the row is STILL in ExpectedFrom (and not soft-deleted), and
// it bumps lock_version. 0 rows affected => the row moved under us (concurrent
// transition) => pgx.ErrNoRows, which the service maps to 409. clock_started_at is
// stamped only when ClockStartedAt is non-nil AND currently NULL (idempotent: a
// re-open never overwrites the original clock start). hold_category/hold_reason are
// set on an on_hold target and cleared on every other target.
func (r *LegalCaseRepository) UpdateStatusGuarded(ctx context.Context, q Queryer, tenantID, id uuid.UUID, t CaseStatusTransition) error {
	holdCategory := any(nil)
	if t.HoldCategory != nil {
		holdCategory = string(*t.HoldCategory)
	}
	holdReason := any(nil)
	if t.HoldReason != nil {
		holdReason = *t.HoldReason
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_cases
		SET status = $4,
		    clock_started_at = CASE WHEN $5::timestamptz IS NOT NULL AND clock_started_at IS NULL
		                            THEN $5::timestamptz ELSE clock_started_at END,
		    hold_category = $6,
		    hold_reason = $7,
		    late_justification = $8,
		    late_justification_submitted_by = $9,
		    late_justification_submitted_at = $10,
		    late_justification_manager_role = $11,
		    lock_version = lock_version + 1,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND status = $3 AND deleted_at IS NULL`,
		tenantID, id, t.ExpectedFrom, t.To, t.ClockStartedAt, holdCategory, holdReason,
		t.LateJustification, t.LateJustificationSubmittedBy, t.LateJustificationSubmittedAt,
		t.LateJustificationManagerRole,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// CaseConcurrencyState is the small concurrency/timeline projection the service
// reads (within a tx, FOR UPDATE) before a guarded transition: the current FSM
// status, the optimistic counter, and whether the SLA clock has already started.
type CaseConcurrencyState struct {
	Status         model.CaseStatus
	LockVersion    int
	ClockStartedAt *time.Time
}

// LockState row-locks the case (FOR UPDATE) inside tx and returns its status,
// lock_version and clock_started_at. Used by UpdateStatus to read the expected
// from-status + decide whether to start the SLA clock, all under the same lock the
// guarded UPDATE will contend on.
func (r *LegalCaseRepository) LockState(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (*CaseConcurrencyState, error) {
	var st CaseConcurrencyState
	err := tx.QueryRow(ctx, `
		SELECT status, lock_version, clock_started_at
		FROM legal_cases
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, id,
	).Scan(&st.Status, &st.LockVersion, &st.ClockStartedAt)
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// UpdateStrength records the litigation-strength assessment (CAP-034).
func (r *LegalCaseRepository) UpdateStrength(ctx context.Context, q Queryer, tenantID, id uuid.UUID, strength model.CaseStrength) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_cases SET strength = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, strength,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// UpdateRiskRating records the graded litigation-risk assessment (Othaim PRD 8.2)
// in a single guarded UPDATE: the resolved band plus its optional matrix inputs,
// monetary exposure and rationale, stamping the assessing actor and instant.
// likelihood/impact/exposure*/rationale are nil-safe (NULL when omitted).
func (r *LegalCaseRepository) UpdateRiskRating(
	ctx context.Context,
	q Queryer,
	tenantID, id uuid.UUID,
	rating model.RiskLevel,
	likelihood, impact *int,
	exposureValue *float64,
	exposureCurrency, rationale *string,
	assessedBy uuid.UUID,
) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_cases
		SET risk_rating = $3,
		    risk_likelihood = $4,
		    risk_impact = $5,
		    risk_exposure_value = $6,
		    risk_exposure_currency = $7,
		    risk_rationale = $8,
		    risk_assessed_by = $9,
		    risk_assessed_at = now(),
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, rating, likelihood, impact, exposureValue, exposureCurrency, rationale, assessedBy,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// UpdatePriority sets the case priority (CAP-041).
func (r *LegalCaseRepository) UpdatePriority(ctx context.Context, q Queryer, tenantID, id uuid.UUID, priority model.LegalPriority) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_cases SET priority = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, priority,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// UpdateAssignment sets one of the management-assignment columns (CAP-037/038/039).
// column MUST be one of the allow-listed assignment columns; the service is the
// only caller and passes a constant.
func (r *LegalCaseRepository) UpdateAssignment(ctx context.Context, q Queryer, tenantID, id uuid.UUID, column string, value uuid.UUID) error {
	if !legalCaseAssignmentColumns[column] {
		return fmt.Errorf("illegal case assignment column %q", column)
	}
	ct, err := q.Exec(ctx, fmt.Sprintf(`
		UPDATE legal_cases SET %s = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, column),
		tenantID, id, value,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LegalCaseRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_cases SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// AppendAudit appends an immutable governance audit row (CAP-051). Accepts a
// Queryer so it runs inside the mutating transaction.
func (r *LegalCaseRepository) AppendAudit(ctx context.Context, q Queryer, entry *model.LegalCaseAuditEntry) error {
	detailJSON, err := json.Marshal(orEmptyMap(entry.Detail))
	if err != nil {
		return fmt.Errorf("marshal legal case audit detail: %w", err)
	}
	query := `
		INSERT INTO legal_case_audit_log (
			id, tenant_id, case_id, action, from_status, to_status, detail, actor_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.CaseID, entry.Action, entry.FromStatus, entry.ToStatus, detailJSON, entry.ActorUserID,
	).Scan(&entry.CreatedAt)
}

func (r *LegalCaseRepository) ListAudit(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.LegalCaseAuditEntry, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT al.id, al.tenant_id, al.case_id, al.action, al.from_status, al.to_status,
			       COALESCE(al.detail, '{}'::jsonb) AS detail, al.actor_user_id, al.created_at
			FROM legal_case_audit_log al
			WHERE al.tenant_id = $1 AND al.case_id = $2
			ORDER BY al.created_at ASC
		) t`
	return queryListJSON[model.LegalCaseAuditEntry](ctx, r.db, query, tenantID, caseID)
}

// LegalCaseSubAuditEntry is one append-only audit row for a case sub-resource
// (party/hearing/task) capturing a real before/after diff (WS4). It is a
// persistence-layer record (the case-level FSM/management audit uses
// model.LegalCaseAuditEntry); it lives in the repository package because both the
// repo (writer/reader) and the legal-case service (constructor) consume it and it
// maps 1:1 onto legal_case_sub_audit_log. before/after are nil-safe (a create has
// no before, a delete has no after).
type LegalCaseSubAuditEntry struct {
	ID           uuid.UUID      `json:"id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	CaseID       uuid.UUID      `json:"case_id"`
	ResourceType string         `json:"resource_type"`
	ResourceID   uuid.UUID      `json:"resource_id"`
	Action       string         `json:"action"`
	BeforeState  map[string]any `json:"before_state,omitempty"`
	AfterState   map[string]any `json:"after_state,omitempty"`
	Reason       *string        `json:"reason,omitempty"`
	ActorUserID  uuid.UUID      `json:"actor_user_id"`
	CreatedAt    time.Time      `json:"created_at"`
}

// AppendSubAudit appends one immutable sub-resource audit row (WS4) for a
// party/hearing/task create/update/delete, capturing a real before/after diff.
// Accepts a Queryer so it commits inside the mutating transaction. before/after
// are nil-safe: a create has no before, a delete has no after.
func (r *LegalCaseRepository) AppendSubAudit(ctx context.Context, q Queryer, entry *LegalCaseSubAuditEntry) error {
	var beforeJSON, afterJSON []byte
	if entry.BeforeState != nil {
		b, err := json.Marshal(entry.BeforeState)
		if err != nil {
			return fmt.Errorf("marshal sub-audit before state: %w", err)
		}
		beforeJSON = b
	}
	if entry.AfterState != nil {
		a, err := json.Marshal(entry.AfterState)
		if err != nil {
			return fmt.Errorf("marshal sub-audit after state: %w", err)
		}
		afterJSON = a
	}
	query := `
		INSERT INTO legal_case_sub_audit_log (
			id, tenant_id, case_id, resource_type, resource_id, action,
			before_state, after_state, reason, actor_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.CaseID, entry.ResourceType, entry.ResourceID, entry.Action,
		beforeJSON, afterJSON, entry.Reason, entry.ActorUserID,
	).Scan(&entry.CreatedAt)
}

// ListSubAudit returns the append-only sub-resource audit trail for a case (WS4).
func (r *LegalCaseRepository) ListSubAudit(ctx context.Context, tenantID, caseID uuid.UUID) ([]LegalCaseSubAuditEntry, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT al.id, al.tenant_id, al.case_id, al.resource_type, al.resource_id,
			       al.action, al.before_state, al.after_state, al.reason,
			       al.actor_user_id, al.created_at
			FROM legal_case_sub_audit_log al
			WHERE al.tenant_id = $1 AND al.case_id = $2
			ORDER BY al.created_at ASC
		) t`
	return queryListJSON[LegalCaseSubAuditEntry](ctx, r.db, query, tenantID, caseID)
}

// AppendVersion appends an immutable case snapshot (CAP-051). The version number
// is computed as max(version)+1 for the case so callers need not race it. Accepts
// a Queryer so it runs inside the mutating transaction.
func (r *LegalCaseRepository) AppendVersion(ctx context.Context, q Queryer, version *model.LegalCaseVersion) error {
	snapshotJSON, err := json.Marshal(orEmptyMap(version.Snapshot))
	if err != nil {
		return fmt.Errorf("marshal legal case snapshot: %w", err)
	}
	query := `
		INSERT INTO legal_case_versions (
			id, tenant_id, case_id, version, snapshot, change_reason, created_by
		) VALUES (
			$1, $2, $3,
			COALESCE((SELECT MAX(version) FROM legal_case_versions WHERE case_id = $3), 0) + 1,
			$4::jsonb, $5, $6
		)
		RETURNING version, created_at`
	return q.QueryRow(ctx, query,
		version.ID, version.TenantID, version.CaseID, snapshotJSON, version.ChangeReason, version.CreatedBy,
	).Scan(&version.Version, &version.CreatedAt)
}

func (r *LegalCaseRepository) ListVersions(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.LegalCaseVersion, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT v.id, v.tenant_id, v.case_id, v.version,
			       COALESCE(v.snapshot, '{}'::jsonb) AS snapshot, v.change_reason,
			       v.created_by, v.created_at
			FROM legal_case_versions v
			WHERE v.tenant_id = $1 AND v.case_id = $2
			ORDER BY v.version DESC
		) t`
	return queryListJSON[model.LegalCaseVersion](ctx, r.db, query, tenantID, caseID)
}

func legalCaseJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT lc.id, lc.tenant_id, lc.case_number, lc.court_number, lc.case_type,
			       lc.other_case_type, lc.classification_id, lc.court_id,
			       CASE WHEN court.id IS NULL THEN NULL ELSE jsonb_build_object(
			           'id', court.id, 'tenant_id', court.tenant_id, 'code', court.code,
			           'name', court.name, 'active', court.active, 'is_system', court.is_system,
			           'sort', court.sort, 'metadata', COALESCE(court.metadata, '{}'::jsonb),
			           'created_by', court.created_by, 'created_at', court.created_at,
			           'updated_at', court.updated_at
			       ) END AS court,
			       lc.contract_id, lc.company_status, lc.competent_court,
			       lc.chamber,
			       (lc.filing_date::timestamp AT TIME ZONE 'UTC') AS filing_date,
			       lc.title, lc.description, lc.strength,
			       lc.claim_amount::double precision AS claim_amount,
			       lc.court_fees::double precision AS court_fees,
			       lc.legal_fees::double precision AS legal_fees,
			       lc.currency,
			       (lc.expected_resolution_date::timestamp AT TIME ZONE 'UTC') AS expected_resolution_date,
			       lc.risk_rating, lc.risk_likelihood, lc.risk_impact,
			       lc.risk_exposure_value, lc.risk_exposure_currency, lc.risk_rationale,
			       lc.risk_assessed_by, lc.risk_assessed_at,
			       lc.status, lc.priority,
			       lc.section_manager_id, lc.supervisor_id, lc.handling_officer_id,
			       lc.responsible_lawyer, lc.department, lc.request_id, lc.workflow_instance_id,
			       lc.late_justification, lc.late_justification_submitted_by,
			       lc.late_justification_submitted_at, lc.late_justification_manager_role,
			       COALESCE(lc.metadata, '{}'::jsonb) AS metadata,
			       lc.created_by, lc.created_at, lc.updated_at, lc.deleted_at
			FROM legal_cases lc
			LEFT JOIN legal_courts court
			  ON court.tenant_id = lc.tenant_id AND court.id = lc.court_id AND court.deleted_at IS NULL
			WHERE ` + where + `
		) t`
}

func legalCaseSortColumn(column string) (string, bool) {
	switch column {
	case "lc.case_number":
		return "t.case_number", true
	case "lc.status":
		return "t.status", true
	case "lc.priority":
		return "t.priority", true
	case "lc.case_type":
		return "t.case_type", true
	case "lc.company_status":
		return "t.company_status", true
	case "lc.expected_resolution_date":
		return "t.expected_resolution_date", true
	case "lc.updated_at":
		return "t.updated_at", true
	case "lc.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}

// legalCaseAssignmentColumns is the allow-list of columns UpdateAssignment may set
// (CAP-037/038/039), preventing SQL injection through the dynamic column name.
var legalCaseAssignmentColumns = map[string]bool{
	"section_manager_id":  true,
	"supervisor_id":       true,
	"handling_officer_id": true,
}

// legalCaseDatePtr normalizes an optional date to midnight UTC, mirroring the
// matter repo helper (reused for hearing/task date columns).
func legalCaseDatePtr(value *time.Time) *time.Time {
	return lexDatePtr(value)
}
