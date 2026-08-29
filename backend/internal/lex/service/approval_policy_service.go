package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
)

func (s *WorkflowService) CreateApprovalPolicy(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateApprovalPolicyRequest) (*model.ApprovalPolicy, error) {
	policy, err := approvalPolicyFromCreateRequest(tenantID, userID, req)
	if err != nil {
		return nil, err
	}
	approversJSON, err := json.Marshal(policy.Approvers)
	if err != nil {
		return nil, internalError("marshal approval policy approvers", err)
	}
	formFieldsJSON, err := json.Marshal(policy.FormFields)
	if err != nil {
		return nil, internalError("marshal approval policy form fields", err)
	}
	metadataJSON, err := json.Marshal(policy.Metadata)
	if err != nil {
		return nil, internalError("marshal approval policy metadata", err)
	}

	// Identical-scope duplicates hard-fail; overlapping scopes only warn (the
	// warning is surfaced by CreateApprovalPolicyWithConflicts).
	if conflicts, cerr := s.ConflictCheckApprovalPolicy(ctx, tenantID, policy, nil); cerr == nil {
		if hasIdenticalConflict(conflicts) {
			return nil, conflictError("an active approval policy already targets the identical scope")
		}
	} else if !isPolicyGovUnconfigured(cerr) {
		return nil, cerr
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("begin create approval policy", err)
	}
	defer tx.Rollback(ctx)

	row := tx.QueryRow(ctx, `
		INSERT INTO lex_approval_policies (
			id, tenant_id, name, description, status, priority, contract_type, department,
			min_value, max_value, currency, mode, quorum, quorum_n, approvers, form_fields,
			require_authority_evidence, required_role, required_authority_amount, metadata,
			created_by, valid_from, valid_until, template_id
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,
			$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,
			$17,$18,$19,$20::jsonb,
			$21,$22,$23,$24
		)
		RETURNING id, tenant_id, name, description, status, priority, contract_type, department,
		          min_value, max_value, currency, mode, quorum, quorum_n, approvers, form_fields,
		          require_authority_evidence, required_role, required_authority_amount, metadata,
		          created_by, updated_by, created_at, updated_at,
		          version, valid_from, valid_until, template_id`,
		policy.ID, tenantID, policy.Name, policy.Description, policy.Status, policy.Priority, policy.ContractType, policy.Department,
		policy.MinValue, policy.MaxValue, policy.Currency, policy.Mode, policy.Quorum, policy.QuorumN, approversJSON, formFieldsJSON,
		policy.RequireAuthorityEvidence, policy.RequiredRole, policy.RequiredAuthorityAmount, metadataJSON,
		userID, policy.ValidFrom, policy.ValidUntil, policy.TemplateID,
	)
	created, err := scanApprovalPolicy(row)
	if err != nil {
		return nil, internalError("create approval policy", err)
	}
	if err := s.appendApprovalPolicyAudit(ctx, tx, tenantID, created.ID, model.ApprovalPolicyAuditCreated, userID, nil, created); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit create approval policy", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.workflows.approval_policy_created", tenantID, &userID, map[string]any{
		"id":     created.ID,
		"name":   created.Name,
		"status": created.Status,
	}, s.logger)
	return created, nil
}

func (s *WorkflowService) UpdateApprovalPolicy(ctx context.Context, tenantID, userID, policyID uuid.UUID, req dto.UpdateApprovalPolicyRequest) (*model.ApprovalPolicy, error) {
	if policyID == uuid.Nil {
		return nil, validationError("approval policy id is invalid", map[string]string{"id": "invalid"})
	}
	existing, err := s.getApprovalPolicy(ctx, tenantID, policyID)
	if err != nil {
		return nil, err
	}
	createReq := approvalPolicyCreateRequestFromModel(existing)
	applyApprovalPolicyUpdateRequest(&createReq, req)
	// Preserve the template linkage across updates (it is not an updatable field
	// on the request); approvalPolicyCreateRequestFromModel already carried it.
	policy, err := approvalPolicyFromCreateRequest(tenantID, existing.CreatedBy, createReq)
	if err != nil {
		return nil, err
	}

	// Warn-not-block: only an identical-scope duplicate hard-fails an update.
	if conflicts, cerr := s.ConflictCheckApprovalPolicy(ctx, tenantID, policy, &policyID); cerr == nil {
		if hasIdenticalConflict(conflicts) {
			return nil, conflictError("another active approval policy already targets the identical scope")
		}
	} else if !isPolicyGovUnconfigured(cerr) {
		return nil, cerr
	}

	updated, err := s.updateApprovalPolicyTx(ctx, tenantID, userID, policyID, existing, policy, model.ApprovalPolicyAuditUpdated)
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.workflows.approval_policy_updated", tenantID, &userID, map[string]any{
		"id":     updated.ID,
		"name":   updated.Name,
		"status": updated.Status,
	}, s.logger)
	return updated, nil
}

// updateApprovalPolicyTx applies the desired policy state in a single
// transaction: it first snapshots the CURRENT (pre-update) policy into the
// immutable version history under its existing version number, then bumps the
// policy's version and persists the new state, then appends an audit entry. The
// audit action distinguishes a plain update from a restore. `existing` is the
// pre-update state used for both the snapshot and the audit "before".
func (s *WorkflowService) updateApprovalPolicyTx(ctx context.Context, tenantID, userID, policyID uuid.UUID, existing, desired *model.ApprovalPolicy, action model.ApprovalPolicyAuditAction) (*model.ApprovalPolicy, error) {
	approversJSON, err := json.Marshal(desired.Approvers)
	if err != nil {
		return nil, internalError("marshal approval policy approvers", err)
	}
	formFieldsJSON, err := json.Marshal(desired.FormFields)
	if err != nil {
		return nil, internalError("marshal approval policy form fields", err)
	}
	metadataJSON, err := json.Marshal(desired.Metadata)
	if err != nil {
		return nil, internalError("marshal approval policy metadata", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("begin update approval policy", err)
	}
	defer tx.Rollback(ctx)

	// 1. Snapshot the current policy into immutable history (best-effort if the
	//    governance repo is wired). The snapshot keeps the version it had.
	if s.policyGov != nil {
		snapshot := *existing
		version := &model.ApprovalPolicyVersion{
			PolicyID:     policyID,
			TenantID:     tenantID,
			Version:      existing.Version,
			Snapshot:     snapshot,
			ChangeReason: string(action),
			CreatedBy:    &userID,
		}
		if err := s.policyGov.SaveApprovalPolicyVersion(ctx, tx, version); err != nil {
			return nil, internalError("snapshot approval policy version", err)
		}
	}

	// 2. Persist the new state with an incremented version.
	row := tx.QueryRow(ctx, `
		UPDATE lex_approval_policies
		SET name = $3,
		    description = $4,
		    status = $5,
		    priority = $6,
		    contract_type = $7,
		    department = $8,
		    min_value = $9,
		    max_value = $10,
		    currency = $11,
		    mode = $12,
		    quorum = $13,
		    quorum_n = $14,
		    approvers = $15::jsonb,
		    form_fields = $16::jsonb,
		    require_authority_evidence = $17,
		    required_role = $18,
		    required_authority_amount = $19,
		    metadata = $20::jsonb,
		    updated_by = $21,
		    valid_from = $22,
		    valid_until = $23,
		    template_id = $24,
		    version = version + 1,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING id, tenant_id, name, description, status, priority, contract_type, department,
		          min_value, max_value, currency, mode, quorum, quorum_n, approvers, form_fields,
		          require_authority_evidence, required_role, required_authority_amount, metadata,
		          created_by, updated_by, created_at, updated_at,
		          version, valid_from, valid_until, template_id`,
		tenantID, policyID,
		desired.Name, desired.Description, desired.Status, desired.Priority, desired.ContractType, desired.Department,
		desired.MinValue, desired.MaxValue, desired.Currency, desired.Mode, desired.Quorum, desired.QuorumN, approversJSON, formFieldsJSON,
		desired.RequireAuthorityEvidence, desired.RequiredRole, desired.RequiredAuthorityAmount, metadataJSON,
		userID, desired.ValidFrom, desired.ValidUntil, desired.TemplateID,
	)
	updated, err := scanApprovalPolicy(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("approval policy not found")
		}
		return nil, internalError("update approval policy", err)
	}

	// 3. Append the audit entry (before = pre-update, after = new state).
	if err := s.appendApprovalPolicyAudit(ctx, tx, tenantID, policyID, action, userID, existing, updated); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit update approval policy", err)
	}
	return updated, nil
}

func (s *WorkflowService) ArchiveApprovalPolicy(ctx context.Context, tenantID, userID, policyID uuid.UUID) error {
	if policyID == uuid.Nil {
		return validationError("approval policy id is invalid", map[string]string{"id": "invalid"})
	}
	existing, err := s.getApprovalPolicy(ctx, tenantID, policyID)
	if err != nil {
		return err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("begin archive approval policy", err)
	}
	defer tx.Rollback(ctx)

	if s.policyGov != nil {
		snapshot := *existing
		version := &model.ApprovalPolicyVersion{
			PolicyID:     policyID,
			TenantID:     tenantID,
			Version:      existing.Version,
			Snapshot:     snapshot,
			ChangeReason: string(model.ApprovalPolicyAuditArchived),
			CreatedBy:    &userID,
		}
		if err := s.policyGov.SaveApprovalPolicyVersion(ctx, tx, version); err != nil {
			return internalError("snapshot approval policy version", err)
		}
	}

	archived, err := scanApprovalPolicy(tx.QueryRow(ctx, `
		UPDATE lex_approval_policies
		SET status = 'archived',
		    updated_by = $3,
		    version = version + 1,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING id, tenant_id, name, description, status, priority, contract_type, department,
		          min_value, max_value, currency, mode, quorum, quorum_n, approvers, form_fields,
		          require_authority_evidence, required_role, required_authority_amount, metadata,
		          created_by, updated_by, created_at, updated_at,
		          version, valid_from, valid_until, template_id`,
		tenantID, policyID, userID,
	))
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("approval policy not found")
		}
		return internalError("archive approval policy", err)
	}
	if err := s.appendApprovalPolicyAudit(ctx, tx, tenantID, policyID, model.ApprovalPolicyAuditArchived, userID, existing, archived); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit archive approval policy", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.workflows.approval_policy_archived", tenantID, &userID, map[string]any{
		"id":     archived.ID,
		"name":   archived.Name,
		"status": archived.Status,
	}, s.logger)
	return nil
}

func (s *WorkflowService) ListApprovalPolicies(ctx context.Context, tenantID uuid.UUID, page, perPage int) ([]model.ApprovalPolicy, int, error) {
	page, perPage = serviceNormalizePage(page, perPage)
	var total int
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM lex_approval_policies
		WHERE tenant_id = $1 AND deleted_at IS NULL`,
		tenantID,
	).Scan(&total); err != nil {
		return nil, 0, internalError("count approval policies", err)
	}
	if total == 0 {
		return []model.ApprovalPolicy{}, 0, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, tenant_id, name, description, status, priority, contract_type, department,
		       min_value, max_value, currency, mode, quorum, quorum_n, approvers, form_fields,
		       require_authority_evidence, required_role, required_authority_amount, metadata,
		       created_by, updated_by, created_at, updated_at,
		       version, valid_from, valid_until, template_id
		FROM lex_approval_policies
		WHERE tenant_id = $1 AND deleted_at IS NULL
		ORDER BY priority DESC, updated_at DESC
		LIMIT $2 OFFSET $3`,
		tenantID, perPage, (page-1)*perPage,
	)
	if err != nil {
		return nil, 0, internalError("list approval policies", err)
	}
	defer rows.Close()
	items := make([]model.ApprovalPolicy, 0)
	for rows.Next() {
		item, err := scanApprovalPolicy(rows)
		if err != nil {
			return nil, 0, internalError("scan approval policy", err)
		}
		items = append(items, *item)
	}
	return items, total, rows.Err()
}

func (s *WorkflowService) RecommendApprovalPolicy(ctx context.Context, tenantID, contractID uuid.UUID) (*model.ApprovalPolicyRecommendation, error) {
	contract, err := s.contracts.Get(ctx, tenantID, contractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	policy, err := s.recommendApprovalPolicyForContract(ctx, tenantID, contract)
	if err != nil {
		return nil, err
	}
	if policy == nil {
		return &model.ApprovalPolicyRecommendation{Matched: false, Reason: "no active approval policy matched this contract"}, nil
	}
	return &model.ApprovalPolicyRecommendation{Policy: policy, Matched: true, Reason: "matched by contract type, department, currency, value range, and priority"}, nil
}

func (s *WorkflowService) ApprovalPolicyAnalytics(ctx context.Context, tenantID uuid.UUID) (*model.ApprovalPolicyAnalytics, error) {
	rows, err := s.db.Query(ctx, `
		SELECT lp.id,
		       lp.name,
		       lp.status,
		       lp.mode,
		       lp.quorum,
		       lp.quorum_n,
		       lp.require_authority_evidence,
		       COUNT(wt.id),
		       COUNT(wt.id) FILTER (WHERE wt.status IN ('pending','claimed','escalated')),
		       COUNT(wt.id) FILTER (WHERE wt.status = 'completed'),
		       COUNT(wt.id) FILTER (WHERE wt.status = 'rejected'),
		       COUNT(wt.id) FILTER (WHERE wt.status = 'cancelled'),
		       COUNT(wt.id) FILTER (
		           WHERE wt.status IN ('pending','claimed','escalated')
		             AND wt.metadata->>'approval_chain' = 'true'
		       ),
		       AVG(EXTRACT(EPOCH FROM (COALESCE(wt.completed_at, wt.updated_at) - wt.created_at)) / 3600.0)
		           FILTER (WHERE wt.status IN ('completed','rejected','cancelled')),
		       MAX(wt.created_at)
		FROM lex_approval_policies lp
		LEFT JOIN workflow_tasks wt
		  ON wt.tenant_id = lp.tenant_id
		 AND wt.metadata->'approval_policy'->>'policy_id' = lp.id::text
		WHERE lp.tenant_id = $1
		  AND lp.deleted_at IS NULL
		GROUP BY lp.id, lp.name, lp.status, lp.mode, lp.quorum, lp.quorum_n, lp.require_authority_evidence, lp.priority, lp.updated_at
		ORDER BY COUNT(wt.id) DESC, lp.priority DESC, lp.updated_at DESC`,
		tenantID,
	)
	if err != nil {
		return nil, internalError("load approval policy analytics", err)
	}
	defer rows.Close()

	analytics := &model.ApprovalPolicyAnalytics{
		TenantID:    tenantID,
		GeneratedAt: s.now().UTC(),
		Policies:    []model.ApprovalPolicyAnalyticsPolicy{},
	}
	var weightedDecisionHours float64
	var terminalDecisionTasks int
	for rows.Next() {
		var item model.ApprovalPolicyAnalyticsPolicy
		var status string
		var totalTasks, activeTasks, completedTasks, rejectedTasks, cancelledTasks, awaitingQuorumTasks int64
		var avgDecision sql.NullFloat64
		var lastTask sql.NullTime
		if err := rows.Scan(
			&item.PolicyID,
			&item.Name,
			&status,
			&item.Mode,
			&item.Quorum,
			&item.QuorumN,
			&item.RequireAuthorityEvidence,
			&totalTasks,
			&activeTasks,
			&completedTasks,
			&rejectedTasks,
			&cancelledTasks,
			&awaitingQuorumTasks,
			&avgDecision,
			&lastTask,
		); err != nil {
			return nil, internalError("scan approval policy analytics", err)
		}
		item.Status = model.ApprovalPolicyStatus(status)
		item.TotalTasks = int(totalTasks)
		item.ActiveTasks = int(activeTasks)
		item.CompletedTasks = int(completedTasks)
		item.RejectedTasks = int(rejectedTasks)
		item.CancelledTasks = int(cancelledTasks)
		item.AwaitingQuorumTasks = int(awaitingQuorumTasks)
		if avgDecision.Valid {
			value := avgDecision.Float64
			item.AverageDecisionHours = &value
			terminalTasks := item.CompletedTasks + item.RejectedTasks + item.CancelledTasks
			weightedDecisionHours += value * float64(terminalTasks)
			terminalDecisionTasks += terminalTasks
		}
		if lastTask.Valid {
			value := lastTask.Time
			item.LastTaskAt = &value
		}

		analytics.TotalPolicies++
		switch item.Status {
		case model.ApprovalPolicyStatusActive:
			analytics.ActivePolicies++
		case model.ApprovalPolicyStatusDraft:
			analytics.DraftPolicies++
		case model.ApprovalPolicyStatusArchived:
			analytics.ArchivedPolicies++
		}
		analytics.TotalRoutedTasks += item.TotalTasks
		analytics.ActiveTasks += item.ActiveTasks
		analytics.CompletedTasks += item.CompletedTasks
		analytics.RejectedTasks += item.RejectedTasks
		analytics.CancelledTasks += item.CancelledTasks
		analytics.AwaitingQuorumTasks += item.AwaitingQuorumTasks
		analytics.Policies = append(analytics.Policies, item)
	}
	if err := rows.Err(); err != nil {
		return nil, internalError("iterate approval policy analytics", err)
	}
	if terminalDecisionTasks > 0 {
		value := weightedDecisionHours / float64(terminalDecisionTasks)
		analytics.AverageDecisionHours = &value
	}
	return analytics, nil
}

func (s *WorkflowService) resolveReviewApprovalPolicy(ctx context.Context, tenantID uuid.UUID, contract *model.Contract, req dto.ReviewContractRequest) (*model.ApprovalPolicy, error) {
	if req.ApprovalPolicyID != nil {
		if *req.ApprovalPolicyID == uuid.Nil {
			return nil, validationError("approval_policy_id must be a valid approval policy id", map[string]string{"approval_policy_id": "invalid"})
		}
		policy, err := s.getApprovalPolicy(ctx, tenantID, *req.ApprovalPolicyID)
		if err != nil {
			return nil, err
		}
		if policy.Status != model.ApprovalPolicyStatusActive {
			return nil, validationError("approval policy must be active", map[string]string{"approval_policy_id": "inactive"})
		}
		if !policy.IsEffectiveAt(s.now().UTC()) {
			return nil, validationError("approval policy is outside its effective window", map[string]string{"approval_policy_id": "expired"})
		}
		return policy, nil
	}
	if req.ApprovalPolicy != nil {
		return nil, nil
	}
	return s.recommendApprovalPolicyForContract(ctx, tenantID, contract)
}

func approvalPolicyHasApprovers(policy *watheeqApprovalPolicy) bool {
	return policy != nil && len(policy.Approvers) > 0
}

func approvalPolicyApproversForStart(policy *watheeqApprovalPolicy) []approvalPolicyApprover {
	if policy == nil || len(policy.Approvers) == 0 {
		return nil
	}
	if strings.EqualFold(policy.Mode, workflowexec.ApprovalModeSequential) {
		return policy.Approvers[:1]
	}
	return policy.Approvers
}

func approvalPolicyID(policy *watheeqApprovalPolicy) string {
	if policy == nil {
		return ""
	}
	return policy.PolicyID
}

func approvalPolicyMode(policy *watheeqApprovalPolicy) string {
	if policy == nil {
		return ""
	}
	return policy.Mode
}

func approvalPolicyQuorum(policy *watheeqApprovalPolicy) string {
	if policy == nil {
		return ""
	}
	return policy.Quorum
}

func serviceNormalizePage(page, perPage int) (int, int) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 25
	}
	if perPage > 100 {
		perPage = 100
	}
	return page, perPage
}

func (s *WorkflowService) getApprovalPolicy(ctx context.Context, tenantID, policyID uuid.UUID) (*model.ApprovalPolicy, error) {
	policy, err := scanApprovalPolicy(s.db.QueryRow(ctx, `
		SELECT id, tenant_id, name, description, status, priority, contract_type, department,
		       min_value, max_value, currency, mode, quorum, quorum_n, approvers, form_fields,
		       require_authority_evidence, required_role, required_authority_amount, metadata,
		       created_by, updated_by, created_at, updated_at,
		       version, valid_from, valid_until, template_id
		FROM lex_approval_policies
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, policyID,
	))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("approval policy not found")
		}
		return nil, internalError("load approval policy", err)
	}
	return policy, nil
}

func (s *WorkflowService) recommendApprovalPolicyForContract(ctx context.Context, tenantID uuid.UUID, contract *model.Contract) (*model.ApprovalPolicy, error) {
	value := float64(0)
	if contract.TotalValue != nil {
		value = *contract.TotalValue
	}
	var department any
	if contract.Department != nil && strings.TrimSpace(*contract.Department) != "" {
		department = strings.TrimSpace(*contract.Department)
	}
	// Only consider policies that are active AND currently within their
	// effective window [valid_from, valid_until]; an expired or not-yet-effective
	// policy must never be recommended.
	now := s.now().UTC()
	policy, err := scanApprovalPolicy(s.db.QueryRow(ctx, `
		SELECT id, tenant_id, name, description, status, priority, contract_type, department,
		       min_value, max_value, currency, mode, quorum, quorum_n, approvers, form_fields,
		       require_authority_evidence, required_role, required_authority_amount, metadata,
		       created_by, updated_by, created_at, updated_at,
		       version, valid_from, valid_until, template_id
		FROM lex_approval_policies
		WHERE tenant_id = $1
		  AND status = 'active'
		  AND deleted_at IS NULL
		  AND (contract_type IS NULL OR contract_type = $2)
		  AND (department IS NULL OR department = $3)
		  AND (currency = '' OR currency = $4)
		  AND (min_value IS NULL OR min_value <= $5)
		  AND (max_value IS NULL OR max_value >= $5)
		  AND (valid_from IS NULL OR valid_from <= $6)
		  AND (valid_until IS NULL OR valid_until >= $6)
		ORDER BY priority DESC,
		         CASE WHEN contract_type IS NULL THEN 0 ELSE 1 END DESC,
		         CASE WHEN department IS NULL THEN 0 ELSE 1 END DESC,
		         min_value DESC NULLS LAST,
		         created_at DESC
		LIMIT 1`,
		tenantID, contract.Type, department, normalizeWorkflowCurrency(contract.Currency), value, now,
	))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, internalError("recommend approval policy", err)
	}
	return policy, nil
}

func approvalPolicyFromCreateRequest(tenantID, userID uuid.UUID, req dto.CreateApprovalPolicyRequest) (*model.ApprovalPolicy, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, validationError("approval policy name is required", map[string]string{"name": "required"})
	}
	status := req.Status
	if status == "" {
		status = model.ApprovalPolicyStatusActive
	}
	switch status {
	case model.ApprovalPolicyStatusDraft, model.ApprovalPolicyStatusActive, model.ApprovalPolicyStatusArchived:
	default:
		return nil, validationError("approval policy status is invalid", map[string]string{"status": "invalid"})
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = workflowexec.ApprovalModeParallel
	}
	quorum := strings.ToLower(strings.TrimSpace(req.Quorum))
	if quorum == "" {
		quorum = workflowexec.QuorumAll
	}
	if quorum != workflowexec.QuorumNofM && req.QuorumN != nil {
		return nil, validationError("quorum_n is only allowed when quorum is n_of_m", map[string]string{"quorum_n": "invalid"})
	}
	approvers := make([]model.ApprovalPolicyApprover, 0, len(req.Approvers))
	configApprovers := make([]any, 0, len(req.Approvers))
	for idx, approver := range req.Approvers {
		typ := strings.ToLower(strings.TrimSpace(approver.Type))
		ref := strings.TrimSpace(approver.Ref)
		if typ != "user" && typ != "role" {
			return nil, validationError("approval policy approver type must be user or role", map[string]string{fmt.Sprintf("approvers.%d.type", idx): "invalid"})
		}
		if ref == "" {
			return nil, validationError("approval policy approver ref is required", map[string]string{fmt.Sprintf("approvers.%d.ref", idx): "required"})
		}
		approvers = append(approvers, model.ApprovalPolicyApprover{Type: typ, Ref: ref, Label: strings.TrimSpace(approver.Label)})
		configApprovers = append(configApprovers, map[string]any{"type": typ, "ref": ref})
	}
	cfgMap := map[string]any{"approvers": configApprovers, "mode": mode, "quorum": quorum}
	if req.QuorumN != nil {
		cfgMap["quorum_n"] = *req.QuorumN
	}
	if _, err := workflowexec.ParseApprovalConfig(cfgMap); err != nil {
		return nil, validationError("approval policy routing is invalid", map[string]string{"approvers": err.Error()})
	}
	formFields, err := approvalPolicyFormFields(req.FormFields)
	if err != nil {
		return nil, err
	}
	if req.MinValue != nil && *req.MinValue < 0 {
		return nil, validationError("min_value must be non-negative", map[string]string{"min_value": "invalid"})
	}
	if req.MaxValue != nil && *req.MaxValue < 0 {
		return nil, validationError("max_value must be non-negative", map[string]string{"max_value": "invalid"})
	}
	if req.MinValue != nil && req.MaxValue != nil && *req.MinValue > *req.MaxValue {
		return nil, validationError("min_value cannot exceed max_value", map[string]string{"min_value": "invalid"})
	}
	requireEvidence := true
	if req.RequireAuthorityEvidence != nil {
		requireEvidence = *req.RequireAuthorityEvidence
	}
	requiredRole := normalizeOptionalString(req.RequiredRole)
	if requiredRole != nil {
		normalized := normalizeWorkflowRole(*requiredRole)
		requiredRole = &normalized
	}
	if req.RequiredAuthorityAmount != nil && *req.RequiredAuthorityAmount < 0 {
		return nil, validationError("required_authority_amount must be non-negative", map[string]string{"required_authority_amount": "invalid"})
	}
	department := normalizeOptionalString(req.Department)
	metadata := cloneAnyMap(req.Metadata)
	if err := validateApprovalPolicyWindow(req.ValidFrom, req.ValidUntil); err != nil {
		return nil, err
	}
	return &model.ApprovalPolicy{
		ID:                       uuid.New(),
		TenantID:                 tenantID,
		Name:                     name,
		Description:              strings.TrimSpace(req.Description),
		Status:                   status,
		Priority:                 req.Priority,
		ContractType:             req.ContractType,
		Department:               department,
		MinValue:                 req.MinValue,
		MaxValue:                 req.MaxValue,
		Currency:                 normalizeWorkflowCurrency(req.Currency),
		Mode:                     mode,
		Quorum:                   quorum,
		QuorumN:                  req.QuorumN,
		Approvers:                approvers,
		FormFields:               formFields,
		RequireAuthorityEvidence: requireEvidence,
		RequiredRole:             requiredRole,
		RequiredAuthorityAmount:  req.RequiredAuthorityAmount,
		Metadata:                 metadata,
		ValidFrom:                cloneTimePtr(req.ValidFrom),
		ValidUntil:               cloneTimePtr(req.ValidUntil),
		TemplateID:               cloneUUIDPtr(req.TemplateID),
		CreatedBy:                userID,
	}, nil
}

func cloneTimePtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	out := *value
	return &out
}

func cloneUUIDPtr(value *uuid.UUID) *uuid.UUID {
	if value == nil {
		return nil
	}
	out := *value
	return &out
}

func approvalPolicyCreateRequestFromModel(policy *model.ApprovalPolicy) dto.CreateApprovalPolicyRequest {
	if policy == nil {
		return dto.CreateApprovalPolicyRequest{}
	}
	approvers := make([]dto.ApprovalPolicyApprover, 0, len(policy.Approvers))
	for _, approver := range policy.Approvers {
		approvers = append(approvers, dto.ApprovalPolicyApprover{
			Type:  approver.Type,
			Ref:   approver.Ref,
			Label: approver.Label,
		})
	}
	formFields := make([]dto.ApprovalFormFieldRequest, 0, len(policy.FormFields))
	for _, field := range policy.FormFields {
		formFields = append(formFields, dto.ApprovalFormFieldRequest{
			Name:        field.Name,
			Type:        field.Type,
			Label:       field.Label,
			Required:    field.Required,
			Options:     append([]string(nil), field.Options...),
			Placeholder: field.Placeholder,
			Description: field.Description,
			VisibleWhen: field.VisibleWhen,
		})
	}
	return dto.CreateApprovalPolicyRequest{
		Name:                     policy.Name,
		Description:              policy.Description,
		Status:                   policy.Status,
		Priority:                 policy.Priority,
		ContractType:             cloneContractTypePtr(policy.ContractType),
		Department:               cloneStringPtr(policy.Department),
		MinValue:                 cloneFloat64Ptr(policy.MinValue),
		MaxValue:                 cloneFloat64Ptr(policy.MaxValue),
		Currency:                 policy.Currency,
		Mode:                     policy.Mode,
		Quorum:                   policy.Quorum,
		QuorumN:                  cloneIntPtr(policy.QuorumN),
		Approvers:                approvers,
		FormFields:               formFields,
		RequireAuthorityEvidence: cloneBoolPtr(&policy.RequireAuthorityEvidence),
		RequiredRole:             cloneStringPtr(policy.RequiredRole),
		RequiredAuthorityAmount:  cloneFloat64Ptr(policy.RequiredAuthorityAmount),
		Metadata:                 cloneAnyMap(policy.Metadata),
		ValidFrom:                cloneTimePtr(policy.ValidFrom),
		ValidUntil:               cloneTimePtr(policy.ValidUntil),
		TemplateID:               cloneUUIDPtr(policy.TemplateID),
	}
}

func applyApprovalPolicyUpdateRequest(req *dto.CreateApprovalPolicyRequest, patch dto.UpdateApprovalPolicyRequest) {
	if patch.Name != nil {
		req.Name = *patch.Name
	}
	if patch.Description != nil {
		req.Description = *patch.Description
	}
	if patch.Status != nil {
		req.Status = *patch.Status
	}
	if patch.Priority != nil {
		req.Priority = *patch.Priority
	}
	if patch.ContractType != nil {
		req.ContractType = cloneContractTypePtr(patch.ContractType)
	}
	if patch.ShouldClear("contract_type") {
		req.ContractType = nil
	}
	if patch.Department != nil {
		req.Department = cloneStringPtr(patch.Department)
	}
	if patch.ShouldClear("department") {
		req.Department = nil
	}
	if patch.MinValue != nil {
		req.MinValue = cloneFloat64Ptr(patch.MinValue)
	}
	if patch.ShouldClear("min_value") {
		req.MinValue = nil
	}
	if patch.MaxValue != nil {
		req.MaxValue = cloneFloat64Ptr(patch.MaxValue)
	}
	if patch.ShouldClear("max_value") {
		req.MaxValue = nil
	}
	if patch.Currency != nil {
		req.Currency = *patch.Currency
	}
	if patch.Mode != nil {
		req.Mode = *patch.Mode
	}
	if patch.Quorum != nil {
		req.Quorum = *patch.Quorum
		if strings.ToLower(strings.TrimSpace(*patch.Quorum)) != workflowexec.QuorumNofM && patch.QuorumN == nil {
			req.QuorumN = nil
		}
	}
	if patch.QuorumN != nil {
		req.QuorumN = cloneIntPtr(patch.QuorumN)
	}
	if patch.ShouldClear("quorum_n") {
		req.QuorumN = nil
	}
	if patch.Approvers != nil {
		req.Approvers = patch.Approvers
	}
	if patch.FormFields != nil {
		req.FormFields = patch.FormFields
	}
	if patch.RequireAuthorityEvidence != nil {
		req.RequireAuthorityEvidence = cloneBoolPtr(patch.RequireAuthorityEvidence)
	}
	if patch.RequiredRole != nil {
		req.RequiredRole = cloneStringPtr(patch.RequiredRole)
	}
	if patch.ShouldClear("required_role") {
		req.RequiredRole = nil
	}
	if patch.RequiredAuthorityAmount != nil {
		req.RequiredAuthorityAmount = cloneFloat64Ptr(patch.RequiredAuthorityAmount)
	}
	if patch.ShouldClear("required_authority_amount") {
		req.RequiredAuthorityAmount = nil
	}
	if patch.Metadata != nil {
		req.Metadata = cloneAnyMap(patch.Metadata)
	}
	if patch.ShouldClear("metadata") {
		req.Metadata = map[string]any{}
	}
	if patch.ValidFrom != nil {
		req.ValidFrom = cloneTimePtr(patch.ValidFrom)
	}
	if patch.ShouldClear("valid_from") {
		req.ValidFrom = nil
	}
	if patch.ValidUntil != nil {
		req.ValidUntil = cloneTimePtr(patch.ValidUntil)
	}
	if patch.ShouldClear("valid_until") {
		req.ValidUntil = nil
	}
}

func cloneStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	out := *value
	return &out
}

func cloneFloat64Ptr(value *float64) *float64 {
	if value == nil {
		return nil
	}
	out := *value
	return &out
}

func cloneIntPtr(value *int) *int {
	if value == nil {
		return nil
	}
	out := *value
	return &out
}

func cloneBoolPtr(value *bool) *bool {
	if value == nil {
		return nil
	}
	out := *value
	return &out
}

func cloneContractTypePtr(value *model.ContractType) *model.ContractType {
	if value == nil {
		return nil
	}
	out := *value
	return &out
}

func approvalPolicyFormFields(fields []dto.ApprovalFormFieldRequest) ([]model.ApprovalPolicyFormField, error) {
	out := make([]model.ApprovalPolicyFormField, 0, len(fields))
	seen := map[string]struct{}{}
	for _, reqField := range fields {
		field, err := approvalFormField(reqField)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[field.Name]; exists {
			return nil, validationError("approval policy form field names must be unique", map[string]string{"form_fields.name": "duplicate"})
		}
		seen[field.Name] = struct{}{}
		out = append(out, model.ApprovalPolicyFormField{
			Name:        field.Name,
			Type:        field.Type,
			Label:       field.Label,
			Required:    field.Required,
			Options:     field.Options,
			Placeholder: field.Placeholder,
			Description: field.Description,
			VisibleWhen: field.VisibleWhen,
		})
	}
	return out, nil
}

func workflowFormFieldsFromApprovalPolicy(policy *model.ApprovalPolicy) []dto.ApprovalFormFieldRequest {
	if policy == nil {
		return nil
	}
	out := make([]dto.ApprovalFormFieldRequest, 0, len(policy.FormFields))
	for _, field := range policy.FormFields {
		out = append(out, dto.ApprovalFormFieldRequest{
			Name:        field.Name,
			Type:        field.Type,
			Label:       field.Label,
			Required:    field.Required,
			Options:     append([]string(nil), field.Options...),
			Placeholder: field.Placeholder,
			Description: field.Description,
			VisibleWhen: field.VisibleWhen,
		})
	}
	return out
}

func scanApprovalPolicy(row pgx.Row) (*model.ApprovalPolicy, error) {
	var item model.ApprovalPolicy
	var status string
	var approversJSON []byte
	var formFieldsJSON []byte
	var metadataJSON []byte
	if err := row.Scan(
		&item.ID, &item.TenantID, &item.Name, &item.Description, &status, &item.Priority, &item.ContractType, &item.Department,
		&item.MinValue, &item.MaxValue, &item.Currency, &item.Mode, &item.Quorum, &item.QuorumN, &approversJSON, &formFieldsJSON,
		&item.RequireAuthorityEvidence, &item.RequiredRole, &item.RequiredAuthorityAmount, &metadataJSON,
		&item.CreatedBy, &item.UpdatedBy, &item.CreatedAt, &item.UpdatedAt,
		&item.Version, &item.ValidFrom, &item.ValidUntil, &item.TemplateID,
	); err != nil {
		return nil, err
	}
	item.Status = model.ApprovalPolicyStatus(status)
	if len(approversJSON) > 0 {
		if err := json.Unmarshal(approversJSON, &item.Approvers); err != nil {
			return nil, fmt.Errorf("decode approval policy approvers: %w", err)
		}
	}
	if len(formFieldsJSON) > 0 {
		if err := json.Unmarshal(formFieldsJSON, &item.FormFields); err != nil {
			return nil, fmt.Errorf("decode approval policy form fields: %w", err)
		}
	}
	item.Metadata = map[string]any{}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &item.Metadata); err != nil {
			return nil, fmt.Errorf("decode approval policy metadata: %w", err)
		}
	}
	if item.Approvers == nil {
		item.Approvers = []model.ApprovalPolicyApprover{}
	}
	if item.FormFields == nil {
		item.FormFields = []model.ApprovalPolicyFormField{}
	}
	return &item, nil
}

func approvalPolicyToWatheeqPolicy(policy *model.ApprovalPolicy, contract *model.Contract) *watheeqApprovalPolicy {
	if policy == nil {
		return nil
	}
	requiredAmount := policy.RequiredAuthorityAmount
	if requiredAmount == nil && contract != nil && contract.TotalValue != nil {
		amount := *contract.TotalValue
		requiredAmount = &amount
	}
	requiredRole := ""
	if policy.RequiredRole != nil {
		requiredRole = *policy.RequiredRole
	}
	approvers := make([]approvalPolicyApprover, 0, len(policy.Approvers))
	for _, approver := range policy.Approvers {
		approvers = append(approvers, approvalPolicyApprover{
			Type:  approver.Type,
			Ref:   approver.Ref,
			Label: approver.Label,
		})
	}
	return &watheeqApprovalPolicy{
		PolicyID:                 policy.ID.String(),
		Name:                     policy.Name,
		RequiredRole:             requiredRole,
		RequiredAuthorityAmount:  requiredAmount,
		Currency:                 normalizeWorkflowCurrency(policy.Currency),
		RequireAuthorityEvidence: policy.RequireAuthorityEvidence,
		Mode:                     policy.Mode,
		Quorum:                   policy.Quorum,
		QuorumN:                  policy.QuorumN,
		Approvers:                approvers,
		Source:                   "persistent_policy",
	}
}

func approvalChainConfig(policy *watheeqApprovalPolicy) map[string]any {
	if policy == nil || len(policy.Approvers) == 0 {
		return nil
	}
	approvers := make([]any, 0, len(policy.Approvers))
	for _, approver := range policy.Approvers {
		approvers = append(approvers, map[string]any{"type": approver.Type, "ref": approver.Ref})
	}
	config := map[string]any{
		"approvers": approvers,
		"mode":      policy.Mode,
		"quorum":    policy.Quorum,
	}
	if policy.QuorumN != nil {
		config["quorum_n"] = *policy.QuorumN
	}
	return config
}

func workflowModelFormFields(fields []model.ApprovalPolicyFormField) []workflowmodel.FormField {
	out := make([]workflowmodel.FormField, 0, len(fields))
	for _, field := range fields {
		out = append(out, workflowmodel.FormField{
			Name:        field.Name,
			Type:        field.Type,
			Label:       field.Label,
			Required:    field.Required,
			Options:     append([]string(nil), field.Options...),
			Placeholder: field.Placeholder,
			Description: field.Description,
			VisibleWhen: field.VisibleWhen,
		})
	}
	return out
}
