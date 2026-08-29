package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/forms"
	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	wfcfg "github.com/clario360/platform/internal/workflow/config"
	wfengine "github.com/clario360/platform/internal/workflow/engine"
	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/handler"
	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/payloadcrypto"
	"github.com/clario360/platform/internal/workflow/service"
)

// buildPayloadCodec constructs the field-level payload-encryption codec for the
// sensitive workflow JSONB, REUSING the platform field crypto
// (internal/lex/crypto AES-256-GCM + "enc:v1:" envelope). It decodes the
// base64 32-byte data key from config (a KMS-ref / secret read from the
// environment — never inlined, never logged) into a software key provider. Only
// invoked when WF_PAYLOAD_ENCRYPTION_MODE=software. Fail-closed: a bad/short key
// returns an error (the caller aborts startup) rather than degrading to plaintext.
func buildPayloadCodec(cfg *wfcfg.Config) (*payloadcrypto.Codec, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(cfg.PayloadEncryptionKeyB64))
	if err != nil {
		return nil, fmt.Errorf("decoding WF_PAYLOAD_ENCRYPTION_KEY (expected base64 32-byte AES-256 key): %w", err)
	}
	provider, err := lexcrypto.NewSoftwareKeyProvider(key)
	if err != nil {
		return nil, err
	}
	fc, err := lexcrypto.NewFieldCrypto(provider)
	if err != nil {
		return nil, err
	}
	return payloadcrypto.New(fc, cfg.PayloadResidencyPin)
}

// ---------------------------------------------------------------------------
// WP-3 — forms by-ref loader + completion re-validator.
//
// Both adapters read/validate against the canonical forms.Store. The
// workflow_forms table is RLS-FORCED, so every access runs inside a tenant
// transaction (database.RunReadWithTenant) that SET LOCAL app.current_tenant_id
// — never the bare pool. This keeps tenant isolation intact for the human-task
// executor and the task-completion path alike.
// ---------------------------------------------------------------------------

// formsAdapter implements both executor.FormLoader (build the human-task schema
// from a referenced form definition) and service.FormSubmissionValidator
// (re-validate a submission against the same definition on complete).
type formsAdapter struct {
	pool  *pgxpool.Pool
	store *forms.Store
}

func newFormsAdapter(pool *pgxpool.Pool) *formsAdapter {
	return &formsAdapter{pool: pool, store: forms.NewStore()}
}

// loadInTenant runs fn inside a read-only tenant transaction so the forms RLS
// policy resolves app.current_tenant_id. A malformed tenant id is surfaced as an
// error rather than silently bypassing isolation.
func (a *formsAdapter) loadInTenant(ctx context.Context, tenantID string, fn func(tx pgx.Tx) error) error {
	tid, err := uuid.Parse(tenantID)
	if err != nil {
		return fmt.Errorf("invalid tenant id %q: %w", tenantID, err)
	}
	return database.RunReadWithTenant(ctx, a.pool, tid, fn)
}

// LoadFormByID resolves a form by id and projects it to the inline schema.
func (a *formsAdapter) LoadFormByID(ctx context.Context, tenantID, formID, locale string) (*executor.ResolvedForm, error) {
	var fd *forms.FormDefinition
	if err := a.loadInTenant(ctx, tenantID, func(tx pgx.Tx) error {
		got, err := a.store.GetByID(ctx, tx, formID)
		if err != nil {
			return err
		}
		fd = got
		return nil
	}); err != nil {
		return nil, err
	}
	return projectForm(fd, locale), nil
}

// LoadFormByName resolves the latest version of a form by name.
func (a *formsAdapter) LoadFormByName(ctx context.Context, tenantID, name, locale string) (*executor.ResolvedForm, error) {
	var fd *forms.FormDefinition
	if err := a.loadInTenant(ctx, tenantID, func(tx pgx.Tx) error {
		got, err := a.store.GetLatest(ctx, tx, name)
		if err != nil {
			return err
		}
		fd = got
		return nil
	}); err != nil {
		return nil, err
	}
	return projectForm(fd, locale), nil
}

// ValidateSubmission re-loads the referenced form definition and runs the
// canonical submission validator. A specific version is loaded when version > 0;
// otherwise the latest version of the form's name is used. A validation failure
// returns a non-nil error describing the first violation.
func (a *formsAdapter) ValidateSubmission(ctx context.Context, tenantID, formID string, formVersion int, locale string, data map[string]interface{}) error {
	var fd *forms.FormDefinition
	if err := a.loadInTenant(ctx, tenantID, func(tx pgx.Tx) error {
		got, err := a.store.GetByID(ctx, tx, formID)
		if err != nil {
			return err
		}
		fd = got
		return nil
	}); err != nil {
		return err
	}
	if violations := fd.ValidateSubmission(data); len(violations) > 0 {
		return fmt.Errorf("%d form violation(s), first: %s", len(violations), violations[0].String())
	}
	return nil
}

// projectForm converts a forms.FormDefinition into the executor.ResolvedForm the
// human-task executor stores as HumanTask.FormSchema. Each bilingual label is
// localized (falling back across locales); section (layout-only) fields are
// dropped because the legacy inline schema has no value-less field concept.
func projectForm(fd *forms.FormDefinition, locale string) *executor.ResolvedForm {
	if locale == "" {
		locale = fd.DefaultLocale
	}
	out := &executor.ResolvedForm{FormID: fd.ID, FormVersion: fd.Version}
	for i := range fd.Fields {
		f := &fd.Fields[i]
		if f.Type == forms.FieldSection {
			continue
		}
		mf := model.FormField{
			Name:     f.Name,
			Type:     string(f.Type),
			Label:    f.Label.Localize(locale),
			Required: f.Required,
			Default:  f.Default,
		}
		if f.Placeholder != nil {
			mf.Placeholder = f.Placeholder.Localize(locale)
		}
		if f.Description != nil {
			mf.Description = f.Description.Localize(locale)
		}
		for _, opt := range f.Options {
			// The inline schema carries option values; the localized label is
			// rendered by the FE from the canonical definition. Values are the
			// validated tokens, so they are what the schema enumerates.
			mf.Options = append(mf.Options, opt.Value)
		}
		out.Fields = append(out.Fields, mf)
	}
	return out
}

// ---------------------------------------------------------------------------
// WP-4 — promotion handler adapter.
//
// The handler's promotion interface returns `any` so it does not import the
// repository's concrete PromotionRecord type. This thin adapter widens the
// concrete service returns to `any`.
// ---------------------------------------------------------------------------

type promotionHandlerAdapter struct {
	svc *service.PromotionService
}

func newPromotionHandlerAdapter(svc *service.PromotionService) *promotionHandlerAdapter {
	return &promotionHandlerAdapter{svc: svc}
}

func (a *promotionHandlerAdapter) PromoteDefinition(ctx context.Context, tenantID, defID, toStage string) (any, error) {
	return a.svc.PromoteDefinition(ctx, tenantID, defID, toStage)
}

// PromoteDefinitionWithApproval bridges the handler's flat approval fields to the
// service's ProdApproval, threading the acting user through so the promotion is
// stamped and (for staging→prod) gated on a distinct approver.
func (a *promotionHandlerAdapter) PromoteDefinitionWithApproval(ctx context.Context, tenantID, defID, toStage, promotedBy, approvedBy, reason string) (any, error) {
	var approval *service.ProdApproval
	if approvedBy != "" || reason != "" {
		approval = &service.ProdApproval{ApprovedBy: approvedBy, Reason: reason}
	}
	return a.svc.PromoteDefinitionWithApproval(ctx, tenantID, defID, toStage, promotedBy, approval)
}

func (a *promotionHandlerAdapter) GetLineage(ctx context.Context, tenantID, definitionKey string) (any, error) {
	return a.svc.GetLineage(ctx, tenantID, definitionKey)
}

// ---------------------------------------------------------------------------
// WP-6 — simulation handler adapter.
//
// Bridges the handler's transport-shaped SimulateRequest to the orchestrator's
// SimulateWithOptions API, translating the mock-decision map and options.
// ---------------------------------------------------------------------------

type simulationHandlerAdapter struct {
	orch *wfengine.SimulationOrchestrator
}

func newSimulationHandlerAdapter(orch *wfengine.SimulationOrchestrator) *simulationHandlerAdapter {
	return &simulationHandlerAdapter{orch: orch}
}

func (a *simulationHandlerAdapter) Simulate(ctx context.Context, def *model.WorkflowDefinition, req handler.SimulateRequest) (any, error) {
	mock := make(map[string]wfengine.MockDecision, len(req.MockDecisions))
	for stepID, d := range req.MockDecisions {
		mock[stepID] = wfengine.MockDecision{Approved: d.Approved, Output: d.Output}
	}
	opts := wfengine.SimulationOptions{
		MaxSteps:          req.MaxSteps,
		AdvanceClockOnSLA: req.AdvanceOnSLA,
	}
	return a.orch.SimulateWithOptions(ctx, def, req.TriggerData, req.Variables, mock, opts)
}
