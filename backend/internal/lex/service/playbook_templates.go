package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/lex/model"
)

// playbook_templates.go provides the WTQ-RSK-02 #7 read-only template library and
// cloning. Templates are a small, static, in-code set of standard per-contract-type
// playbooks (no DB table, no migration). A clone always lands as a DRAFT playbook
// owned by the cloning user — it is NEVER auto-activated — so it must still go
// through the normal Update/approval path to become active. There is also a generic
// clone of any existing stored playbook (`ClonePlaybook`).

// PlaybookTemplate is one entry in the static template library.
type PlaybookTemplate struct {
	Key          string                 `json:"key"`
	Name         string                 `json:"name"`
	Description  string                 `json:"description"`
	ContractType model.ContractType     `json:"contract_type"`
	Clauses      []model.PlaybookClause `json:"clauses"`
}

// playbookTemplates is the curated static library, keyed by template key. Standard
// texts are intentionally short, generic baselines an author refines before
// activation.
var playbookTemplates = []PlaybookTemplate{
	{
		Key:          "nda_standard",
		Name:         "Standard NDA Playbook",
		Description:  "Baseline standard clauses expected in a mutual non-disclosure agreement.",
		ContractType: model.ContractTypeNDA,
		Clauses: []model.PlaybookClause{
			{ClauseType: model.ClauseTypeConfidentiality, Title: "Confidentiality", StandardText: "Each party shall keep the other party's Confidential Information secret and shall not disclose it to any third party without prior written consent.", Required: true, RiskWeight: 1.0},
			{ClauseType: model.ClauseTypeTermination, Title: "Term and Termination", StandardText: "The confidentiality obligations survive termination of this agreement for a period of five (5) years.", Required: true, RiskWeight: 0.7},
			{ClauseType: model.ClauseTypeGoverningLaw, Title: "Governing Law", StandardText: "This agreement is governed by the laws of the Kingdom of Saudi Arabia.", Required: true, RiskWeight: 0.6},
			{ClauseType: model.ClauseTypeDisputeResolution, Title: "Dispute Resolution", StandardText: "Any dispute arising out of this agreement shall be resolved by the competent courts of the Kingdom of Saudi Arabia.", Required: false, RiskWeight: 0.5},
		},
	},
	{
		Key:          "service_agreement_standard",
		Name:         "Standard Service Agreement Playbook",
		Description:  "Baseline standard clauses expected in a services agreement.",
		ContractType: model.ContractTypeServiceAgreement,
		Clauses: []model.PlaybookClause{
			{ClauseType: model.ClauseTypePaymentTerms, Title: "Payment Terms", StandardText: "Fees are payable within thirty (30) days of the date of a valid invoice.", Required: true, RiskWeight: 0.9},
			{ClauseType: model.ClauseTypeLimitationOfLiability, Title: "Limitation of Liability", StandardText: "Neither party's aggregate liability shall exceed the total fees paid in the twelve (12) months preceding the claim.", Required: true, RiskWeight: 1.0},
			{ClauseType: model.ClauseTypeIndemnification, Title: "Indemnification", StandardText: "Each party shall indemnify the other against third-party claims arising from its breach of this agreement.", Required: true, RiskWeight: 0.9},
			{ClauseType: model.ClauseTypeTermination, Title: "Termination", StandardText: "Either party may terminate for material breach not cured within thirty (30) days of written notice.", Required: true, RiskWeight: 0.7},
			{ClauseType: model.ClauseTypeConfidentiality, Title: "Confidentiality", StandardText: "Each party shall protect the other party's confidential information using no less than reasonable care.", Required: false, RiskWeight: 0.6},
			{ClauseType: model.ClauseTypeGoverningLaw, Title: "Governing Law", StandardText: "This agreement is governed by the laws of the Kingdom of Saudi Arabia.", Required: true, RiskWeight: 0.6},
		},
	},
	{
		Key:          "vendor_standard",
		Name:         "Standard Vendor Agreement Playbook",
		Description:  "Baseline standard clauses expected in a vendor/procurement agreement.",
		ContractType: model.ContractTypeVendor,
		Clauses: []model.PlaybookClause{
			{ClauseType: model.ClauseTypePaymentTerms, Title: "Payment Terms", StandardText: "Payment is due net thirty (30) days from receipt of goods or services and a valid invoice.", Required: true, RiskWeight: 0.9},
			{ClauseType: model.ClauseTypeWarranty, Title: "Warranty", StandardText: "Vendor warrants that all goods and services conform to the agreed specifications and are free from defects.", Required: true, RiskWeight: 0.8},
			{ClauseType: model.ClauseTypeIndemnification, Title: "Indemnification", StandardText: "Vendor shall indemnify the customer against third-party claims arising from the goods or services supplied.", Required: true, RiskWeight: 0.9},
			{ClauseType: model.ClauseTypeInsurance, Title: "Insurance", StandardText: "Vendor shall maintain commercially reasonable insurance coverage throughout the term.", Required: false, RiskWeight: 0.5},
			{ClauseType: model.ClauseTypeTermination, Title: "Termination", StandardText: "Customer may terminate for convenience on thirty (30) days written notice.", Required: true, RiskWeight: 0.7},
			{ClauseType: model.ClauseTypeGoverningLaw, Title: "Governing Law", StandardText: "This agreement is governed by the laws of the Kingdom of Saudi Arabia.", Required: true, RiskWeight: 0.6},
		},
	},
	{
		Key:          "employment_standard",
		Name:         "Standard Employment Contract Playbook",
		Description:  "Baseline standard clauses expected in an employment contract.",
		ContractType: model.ContractTypeEmployment,
		Clauses: []model.PlaybookClause{
			{ClauseType: model.ClauseTypeConfidentiality, Title: "Confidentiality", StandardText: "The employee shall keep all proprietary and confidential information of the employer secret during and after employment.", Required: true, RiskWeight: 0.9},
			{ClauseType: model.ClauseTypeIPOwnership, Title: "Intellectual Property", StandardText: "All work product created in the course of employment is the exclusive property of the employer.", Required: true, RiskWeight: 1.0},
			{ClauseType: model.ClauseTypeNonCompete, Title: "Non-Compete", StandardText: "The employee shall not engage in competing activities for a reasonable period after termination, as permitted by applicable law.", Required: false, RiskWeight: 0.7},
			{ClauseType: model.ClauseTypeTermination, Title: "Termination", StandardText: "Either party may terminate the contract in accordance with the notice periods set by the applicable labour law.", Required: true, RiskWeight: 0.7},
			{ClauseType: model.ClauseTypeGoverningLaw, Title: "Governing Law", StandardText: "This contract is governed by the labour laws of the Kingdom of Saudi Arabia.", Required: true, RiskWeight: 0.6},
		},
	},
}

// ListTemplates returns the static template library (WTQ-RSK-02 #7). It does not
// touch the database and is identical for all tenants.
func (s *PlaybookService) ListTemplates() []PlaybookTemplate {
	out := make([]PlaybookTemplate, len(playbookTemplates))
	copy(out, playbookTemplates)
	return out
}

// findTemplate looks up a template by key.
func findTemplate(key string) (*PlaybookTemplate, bool) {
	key = strings.TrimSpace(key)
	for i := range playbookTemplates {
		if playbookTemplates[i].Key == key {
			return &playbookTemplates[i], true
		}
	}
	return nil, false
}

// CloneTemplate creates a new DRAFT playbook for the tenant from a static template
// (WTQ-RSK-02 #7). The new playbook is never auto-activated. An optional name
// override lets the author name the clone; the name must be unique per tenant
// (a collision returns 409).
func (s *PlaybookService) CloneTemplate(ctx context.Context, tenantID, userID uuid.UUID, key, nameOverride string) (*model.ClausePlaybook, error) {
	tmpl, ok := findTemplate(key)
	if !ok {
		return nil, notFoundError("playbook template not found")
	}
	name := strings.TrimSpace(nameOverride)
	if name == "" {
		name = tmpl.Name
	}
	clauses := make([]model.PlaybookClause, len(tmpl.Clauses))
	copy(clauses, tmpl.Clauses)
	playbook := &model.ClausePlaybook{
		ID:           uuid.New(),
		TenantID:     tenantID,
		Name:         name,
		Description:  tmpl.Description,
		ContractType: tmpl.ContractType,
		Status:       model.PlaybookStatusDraft, // clones are ALWAYS drafts
		Clauses:      clauses,
		Metadata:     map[string]any{"cloned_from_template": tmpl.Key},
		CreatedBy:    userID,
	}
	if err := s.playbooks.Create(ctx, s.db, playbook); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a playbook with this name already exists; pass a unique name")
		}
		return nil, internalError("clone playbook template", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.playbook.created", tenantID, &userID, map[string]any{
		"id":            playbook.ID,
		"name":          playbook.Name,
		"contract_type": playbook.ContractType,
		"status":        playbook.Status,
		"cloned_from":   "template:" + tmpl.Key,
	}, s.logger)
	return playbook, nil
}

// ClonePlaybook creates a new DRAFT playbook from an existing stored playbook
// (WTQ-RSK-02 #7 generic clone). The clone is never auto-activated regardless of the
// source's status. nameOverride defaults to "<source name> (copy)".
func (s *PlaybookService) ClonePlaybook(ctx context.Context, tenantID, userID, sourceID uuid.UUID, nameOverride string) (*model.ClausePlaybook, error) {
	source, err := s.playbooks.Get(ctx, tenantID, sourceID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause playbook not found")
		}
		return nil, internalError("load source playbook", err)
	}
	name := strings.TrimSpace(nameOverride)
	if name == "" {
		name = fmt.Sprintf("%s (copy)", source.Name)
	}
	clauses := make([]model.PlaybookClause, len(source.Clauses))
	copy(clauses, source.Clauses)
	metadata := map[string]any{"cloned_from_playbook": source.ID.String()}
	playbook := &model.ClausePlaybook{
		ID:           uuid.New(),
		TenantID:     tenantID,
		Name:         name,
		Description:  source.Description,
		ContractType: source.ContractType,
		Status:       model.PlaybookStatusDraft, // clones are ALWAYS drafts
		Clauses:      clauses,
		Metadata:     metadata,
		CreatedBy:    userID,
	}
	if err := s.playbooks.Create(ctx, s.db, playbook); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a playbook with this name already exists; pass a unique name")
		}
		return nil, internalError("clone playbook", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.playbook.created", tenantID, &userID, map[string]any{
		"id":            playbook.ID,
		"name":          playbook.Name,
		"contract_type": playbook.ContractType,
		"status":        playbook.Status,
		"cloned_from":   "playbook:" + source.ID.String(),
	}, s.logger)
	return playbook, nil
}
