package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// CreateApprovalPolicyTemplateRequest is the input for defining a reusable
// approval-policy template. Definition holds the policy shape (the same JSON
// fields as a CreateApprovalPolicyRequest) that InstantiateApprovalPolicyFromTemplate
// materialises into a concrete policy.
type CreateApprovalPolicyTemplateRequest struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Category    string         `json:"category"`
	Definition  map[string]any `json:"definition"`
}

// UpdateApprovalPolicyTemplateRequest patches a template. Nil fields are left
// unchanged; a non-nil Definition replaces the whole definition document.
type UpdateApprovalPolicyTemplateRequest struct {
	Name        *string        `json:"name,omitempty"`
	Description *string        `json:"description,omitempty"`
	Category    *string        `json:"category,omitempty"`
	Definition  map[string]any `json:"definition,omitempty"`
}

func (s *WorkflowService) requirePolicyGov() error {
	if s.policyGov == nil {
		return internalError("approval policy governance repository is not configured", errPolicyGovUnconfigured)
	}
	return nil
}

// CreateApprovalPolicyTemplate persists a new reusable template after validating
// that its definition materialises into a valid policy request.
func (s *WorkflowService) CreateApprovalPolicyTemplate(ctx context.Context, tenantID, userID uuid.UUID, req CreateApprovalPolicyTemplateRequest) (*model.ApprovalPolicyTemplate, error) {
	if err := s.requirePolicyGov(); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, validationError("approval policy template name is required", map[string]string{"name": "required"})
	}
	definition := cloneAnyMap(req.Definition)
	// Validate the definition is materialisable (does not persist anything).
	if _, err := approvalPolicyRequestFromDefinition(definition); err != nil {
		return nil, err
	}
	var actor *uuid.UUID
	if userID != uuid.Nil {
		actor = &userID
	}
	tmpl := &model.ApprovalPolicyTemplate{
		TenantID:    tenantID,
		Name:        name,
		Description: strings.TrimSpace(req.Description),
		Category:    strings.TrimSpace(req.Category),
		Definition:  definition,
		CreatedBy:   actor,
		UpdatedBy:   actor,
	}
	if err := s.policyGov.CreateApprovalPolicyTemplate(ctx, s.db, tmpl); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("an approval policy template with this name already exists")
		}
		return nil, internalError("create approval policy template", err)
	}
	return tmpl, nil
}

// ListApprovalPolicyTemplates returns all templates for a tenant.
func (s *WorkflowService) ListApprovalPolicyTemplates(ctx context.Context, tenantID uuid.UUID) ([]model.ApprovalPolicyTemplate, error) {
	if err := s.requirePolicyGov(); err != nil {
		return nil, err
	}
	templates, err := s.policyGov.ListApprovalPolicyTemplates(ctx, tenantID)
	if err != nil {
		return nil, internalError("list approval policy templates", err)
	}
	return templates, nil
}

// GetApprovalPolicyTemplate loads a single template.
func (s *WorkflowService) GetApprovalPolicyTemplate(ctx context.Context, tenantID, templateID uuid.UUID) (*model.ApprovalPolicyTemplate, error) {
	if err := s.requirePolicyGov(); err != nil {
		return nil, err
	}
	if templateID == uuid.Nil {
		return nil, validationError("approval policy template id is invalid", map[string]string{"id": "invalid"})
	}
	tmpl, err := s.policyGov.GetApprovalPolicyTemplate(ctx, tenantID, templateID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("approval policy template not found")
		}
		return nil, internalError("load approval policy template", err)
	}
	return tmpl, nil
}

// UpdateApprovalPolicyTemplate patches a template in place.
func (s *WorkflowService) UpdateApprovalPolicyTemplate(ctx context.Context, tenantID, userID, templateID uuid.UUID, req UpdateApprovalPolicyTemplateRequest) (*model.ApprovalPolicyTemplate, error) {
	if err := s.requirePolicyGov(); err != nil {
		return nil, err
	}
	tmpl, err := s.GetApprovalPolicyTemplate(ctx, tenantID, templateID)
	if err != nil {
		return nil, err
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			return nil, validationError("approval policy template name is required", map[string]string{"name": "required"})
		}
		tmpl.Name = name
	}
	if req.Description != nil {
		tmpl.Description = strings.TrimSpace(*req.Description)
	}
	if req.Category != nil {
		tmpl.Category = strings.TrimSpace(*req.Category)
	}
	if req.Definition != nil {
		definition := cloneAnyMap(req.Definition)
		if _, derr := approvalPolicyRequestFromDefinition(definition); derr != nil {
			return nil, derr
		}
		tmpl.Definition = definition
	}
	if userID != uuid.Nil {
		actor := userID
		tmpl.UpdatedBy = &actor
	}
	if err := s.policyGov.UpdateApprovalPolicyTemplate(ctx, s.db, tmpl); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("approval policy template not found")
		}
		if isUniqueViolation(err) {
			return nil, conflictError("an approval policy template with this name already exists")
		}
		return nil, internalError("update approval policy template", err)
	}
	return tmpl, nil
}

// DeleteApprovalPolicyTemplate removes a template. Policies referencing it keep
// existing (their template_id is nulled by the FK).
func (s *WorkflowService) DeleteApprovalPolicyTemplate(ctx context.Context, tenantID, templateID uuid.UUID) error {
	if err := s.requirePolicyGov(); err != nil {
		return err
	}
	if templateID == uuid.Nil {
		return validationError("approval policy template id is invalid", map[string]string{"id": "invalid"})
	}
	if err := s.policyGov.DeleteApprovalPolicyTemplate(ctx, s.db, tenantID, templateID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFoundError("approval policy template not found")
		}
		return internalError("delete approval policy template", err)
	}
	return nil
}

// InstantiateApprovalPolicyFromTemplate materialises a new approval policy from
// a template's definition, applies the caller-supplied overrides, stamps the
// template_id, creates the policy, and records an audit entry with
// action=template_applied. Overrides take precedence over the template's
// definition for any field they set.
func (s *WorkflowService) InstantiateApprovalPolicyFromTemplate(ctx context.Context, tenantID, userID, templateID uuid.UUID, overrides *dto.UpdateApprovalPolicyRequest) (*model.ApprovalPolicy, error) {
	if err := s.requirePolicyGov(); err != nil {
		return nil, err
	}
	tmpl, err := s.GetApprovalPolicyTemplate(ctx, tenantID, templateID)
	if err != nil {
		return nil, err
	}
	createReq, err := approvalPolicyRequestFromDefinition(tmpl.Definition)
	if err != nil {
		return nil, err
	}
	if overrides != nil {
		applyApprovalPolicyUpdateRequest(&createReq, *overrides)
	}
	createReq.TemplateID = &tmpl.ID
	if strings.TrimSpace(createReq.Name) == "" {
		createReq.Name = tmpl.Name
	}

	// Build the candidate, run the same identical-scope guard as CreateApprovalPolicy,
	// then persist with a template_applied audit entry in one transaction.
	policy, err := approvalPolicyFromCreateRequest(tenantID, userID, createReq)
	if err != nil {
		return nil, err
	}
	if conflicts, cerr := s.ConflictCheckApprovalPolicy(ctx, tenantID, policy, nil); cerr == nil {
		if hasIdenticalConflict(conflicts) {
			return nil, conflictError("an active approval policy already targets the identical scope")
		}
	} else if !isPolicyGovUnconfigured(cerr) {
		return nil, cerr
	}

	created, err := s.createApprovalPolicyFromModelTx(ctx, tenantID, userID, policy, model.ApprovalPolicyAuditTemplateApplied)
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.workflows.approval_policy_created", tenantID, &userID, map[string]any{
		"id":          created.ID,
		"name":        created.Name,
		"status":      created.Status,
		"template_id": tmpl.ID,
	}, s.logger)
	return created, nil
}

// createApprovalPolicyFromModelTx inserts an already-built policy model and
// appends an audit entry under the supplied action, in one transaction. It
// shares the insert shape with CreateApprovalPolicy but lets the caller control
// the audit action (e.g. template_applied).
func (s *WorkflowService) createApprovalPolicyFromModelTx(ctx context.Context, tenantID, userID uuid.UUID, policy *model.ApprovalPolicy, action model.ApprovalPolicyAuditAction) (*model.ApprovalPolicy, error) {
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

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("begin instantiate approval policy", err)
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
		return nil, internalError("instantiate approval policy", err)
	}
	if err := s.appendApprovalPolicyAudit(ctx, tx, tenantID, created.ID, action, userID, nil, created); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit instantiate approval policy", err)
	}
	return created, nil
}

// approvalPolicyRequestFromDefinition decodes a template definition document
// into a CreateApprovalPolicyRequest via a JSON round-trip. The definition uses
// the same JSON field names as the create request, so this both validates the
// shape and yields a typed request the rest of the pipeline can consume.
func approvalPolicyRequestFromDefinition(definition map[string]any) (dto.CreateApprovalPolicyRequest, error) {
	var req dto.CreateApprovalPolicyRequest
	if len(definition) == 0 {
		return req, nil
	}
	raw, err := json.Marshal(definition)
	if err != nil {
		return req, internalError("marshal approval policy template definition", err)
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return dto.CreateApprovalPolicyRequest{}, validationError("approval policy template definition is invalid", map[string]string{"definition": err.Error()})
	}
	return req, nil
}
