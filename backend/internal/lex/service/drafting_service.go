package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	llmprovider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/drafting"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

// DraftingService is the application service for AID-* generative drafting. It
// validates input, delegates LLM generation to the governed drafting engine, and
// maps engine sentinels to HTTP-shaped app errors. AID-08 (template assembly) is
// deterministic; the rest call the governed LLM via the engine.
type DraftingService struct {
	drafter *drafting.Drafter
	db      *pgxpool.Pool
	prompts *repository.PromptTemplateRepository
	logger  zerolog.Logger

	// Feature 4: engine-backed draft human reviews. Wired via WithReviewEngine;
	// when unset SubmitDraftForReview/GetDraftReview/CompleteDraftReview return 503.
	reviewDefRepo   *workflowrepo.DefinitionRepository
	reviewInstRepo  *workflowrepo.InstanceRepository
	reviews         *repository.DraftReviewRepository
	reviewMetrics   *metrics.Metrics
	reviewPublisher Publisher
	reviewTopic     string
	now             func() time.Time
}

// NewDraftingService builds the service. drafter may be a disabled engine (nil
// provider manager) in which case generation methods return 503 and assembly
// (deterministic) still works.
func NewDraftingService(drafter *drafting.Drafter, logger zerolog.Logger) *DraftingService {
	return &DraftingService{drafter: drafter, logger: logger.With().Str("service", "lex-drafting").Logger()}
}

// WithPromptLibrary wires the AID-09 prompt-library persistence. When unset, the
// prompt-library endpoints return 503 (the generation/assembly endpoints work
// regardless).
func (s *DraftingService) WithPromptLibrary(db *pgxpool.Pool, prompts *repository.PromptTemplateRepository) *DraftingService {
	s.db = db
	s.prompts = prompts
	return s
}

// Enabled reports whether LLM-backed generation is available.
func (s *DraftingService) Enabled() bool { return s.drafter != nil && s.drafter.Enabled() }

func draftingUnavailable() error {
	// Message left empty so suiteapi.WriteError localizes DRAFTING_UNAVAILABLE
	// from the bilingual catalog (Arabic drafting panel renders Arabic copy).
	return &apperrors.AppError{
		Status: http.StatusServiceUnavailable,
		Code:   "DRAFTING_UNAVAILABLE",
	}
}

// mapDraftErr converts engine sentinels into app errors; everything else is a
// 500 with the wrapped cause.
func (s *DraftingService) mapDraftErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, drafting.ErrDraftingDisabled):
		return draftingUnavailable()
	case errors.Is(err, llmprovider.ErrNotConfigured):
		// The feature flag can be enabled while this tenant/deployment still has
		// no usable provider credential. Treat that as unavailable instead of
		// leaking a generic 500 after the user has asked for a draft.
		return draftingUnavailable()
	case errors.Is(err, context.DeadlineExceeded):
		return &apperrors.AppError{
			Status: http.StatusGatewayTimeout,
			Code:   "DRAFTING_TIMEOUT",
			Err:    err,
		}
	case errors.Is(err, drafting.ErrNoToolCall), errors.Is(err, drafting.ErrInvalidOutput):
		// Empty message → localized from the catalog per request locale.
		return &apperrors.AppError{Status: http.StatusBadGateway, Code: "DRAFTING_NO_OUTPUT"}
	default:
		var appErr *apperrors.AppError
		if errors.As(err, &appErr) {
			return appErr
		}
		return &apperrors.AppError{
			Status: http.StatusBadGateway,
			Code:   "DRAFTING_PROVIDER_ERROR",
			Err:    err,
		}
	}
}

func requireText(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return validationError(field+" is required", map[string]string{field: "required"})
	}
	return nil
}

// ---- AID-01 ----
func (s *DraftingService) GenerateClause(ctx context.Context, tenantID uuid.UUID, req drafting.ClauseRequest) (*drafting.GeneratedClause, error) {
	if err := requireText("intent", req.Intent); err != nil {
		return nil, err
	}
	out, err := s.drafter.GenerateClause(ctx, tenantID, req)
	return out, s.mapDraftErr(err)
}

// GenerateClauseStream is the streaming twin of GenerateClause: it streams the
// clause text through emit as it generates and returns the assembled clause.
func (s *DraftingService) GenerateClauseStream(ctx context.Context, tenantID uuid.UUID, req drafting.ClauseRequest, emit func(delta string)) (*drafting.GeneratedClause, error) {
	if err := requireText("intent", req.Intent); err != nil {
		return nil, err
	}
	out, err := s.drafter.GenerateClauseStream(ctx, tenantID, req, emit)
	return out, s.mapDraftErr(err)
}

// ---- AID-02 ----
func (s *DraftingService) DraftContract(ctx context.Context, tenantID uuid.UUID, req drafting.ContractDraftRequest) (*drafting.ContractDraft, error) {
	if err := requireText("contract_type", req.ContractType); err != nil {
		return nil, err
	}
	if len(req.DealTerms) == 0 {
		return nil, validationError("deal_terms is required", map[string]string{"deal_terms": "required"})
	}
	out, err := s.drafter.DraftContract(ctx, tenantID, req)
	return out, s.mapDraftErr(err)
}

// ---- AID-03 ----
func (s *DraftingService) RewriteClause(ctx context.Context, tenantID uuid.UUID, req drafting.RewriteRequest) (*drafting.ClauseRewrite, error) {
	if err := requireText("text", req.Text); err != nil {
		return nil, err
	}
	out, err := s.drafter.RewriteClause(ctx, tenantID, req)
	return out, s.mapDraftErr(err)
}

// ---- AID-04 ----
func (s *DraftingService) SuggestFallbacks(ctx context.Context, tenantID uuid.UUID, req drafting.FallbackRequest) (*drafting.FallbackSet, error) {
	if err := requireText("clause_text", req.ClauseText); err != nil {
		return nil, err
	}
	out, err := s.drafter.SuggestFallbacks(ctx, tenantID, req)
	return out, s.mapDraftErr(err)
}

// ---- AID-05 ----
func (s *DraftingService) Translate(ctx context.Context, tenantID uuid.UUID, req drafting.TranslateRequest) (*drafting.TranslationResult, error) {
	if err := requireText("text", req.Text); err != nil {
		return nil, err
	}
	if err := requireText("target_lang", req.TargetLang); err != nil {
		return nil, err
	}
	out, err := s.drafter.Translate(ctx, tenantID, req)
	return out, s.mapDraftErr(err)
}

// ---- AID-06 ----
func (s *DraftingService) Summarize(ctx context.Context, tenantID uuid.UUID, req drafting.SummaryRequest) (*drafting.ContractSummary, error) {
	if err := requireText("text", req.Text); err != nil {
		return nil, err
	}
	out, err := s.drafter.Summarize(ctx, tenantID, req)
	return out, s.mapDraftErr(err)
}

// ---- AID-07 ----
func (s *DraftingService) Glossary(ctx context.Context, tenantID uuid.UUID, req drafting.GlossaryRequest) (*drafting.GlossaryResult, error) {
	if err := requireText("text", req.Text); err != nil {
		return nil, err
	}
	out, err := s.drafter.Glossary(ctx, tenantID, req)
	return out, s.mapDraftErr(err)
}

// ---- AID-08 (deterministic) ----
func (s *DraftingService) Assemble(_ context.Context, _ uuid.UUID, req drafting.AssembleRequest) (*drafting.AssemblyResult, error) {
	if len(req.Sections) == 0 {
		return nil, validationError("sections is required", map[string]string{"sections": "required"})
	}
	out, err := drafting.Assemble(req)
	if err != nil {
		return nil, validationError(err.Error(), nil)
	}
	return out, nil
}

// ---- AID-10 ----
func (s *DraftingService) DraftRFPResponse(ctx context.Context, tenantID uuid.UUID, req drafting.RFPRequest) (*drafting.RFPResponse, error) {
	if err := requireText("requirements", req.Requirements); err != nil {
		return nil, err
	}
	out, err := s.drafter.DraftRFPResponse(ctx, tenantID, req)
	return out, s.mapDraftErr(err)
}

// ---- AID-11 ----
func (s *DraftingService) ReviewObligationExtraction(ctx context.Context, tenantID uuid.UUID, req drafting.ObligationQARequest) (*drafting.ObligationQAReview, error) {
	if err := requireText("contract_text", req.ContractText); err != nil {
		return nil, err
	}
	if len(req.Obligations) == 0 {
		return nil, validationError("obligations is required", map[string]string{"obligations": "required"})
	}
	out, err := s.drafter.ReviewObligationExtraction(ctx, tenantID, req)
	return out, s.mapDraftErr(err)
}

// ====================== AID-09: prompt library ======================

func (s *DraftingService) promptLibraryReady() error {
	if s.prompts == nil || s.db == nil {
		return draftingUnavailable()
	}
	return nil
}

// CreatePrompt persists a reusable prompt template (AID-09).
func (s *DraftingService) CreatePrompt(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreatePromptTemplateRequest) (*model.PromptTemplate, error) {
	if err := s.promptLibraryReady(); err != nil {
		return nil, err
	}
	req.Normalize()
	if req.Name == "" {
		return nil, validationError("name is required", map[string]string{"name": "required"})
	}
	if req.UserPrompt == "" {
		return nil, validationError("user_prompt is required", map[string]string{"user_prompt": "required"})
	}
	t := &model.PromptTemplate{
		ID:           uuid.New(),
		TenantID:     tenantID,
		Name:         req.Name,
		Description:  req.Description,
		Category:     req.Category,
		SystemPrompt: req.SystemPrompt,
		UserPrompt:   req.UserPrompt,
		Variables:    req.Variables,
		Metadata:     req.Metadata,
		CreatedBy:    userID,
	}
	if err := s.prompts.Create(ctx, s.db, t); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a prompt template with this name already exists")
		}
		return nil, internalError("create prompt template", err)
	}
	return t, nil
}

// UpdatePrompt replaces a prompt template's fields (AID-09).
func (s *DraftingService) UpdatePrompt(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdatePromptTemplateRequest) (*model.PromptTemplate, error) {
	if err := s.promptLibraryReady(); err != nil {
		return nil, err
	}
	req.Normalize()
	if req.Name == "" {
		return nil, validationError("name is required", map[string]string{"name": "required"})
	}
	if req.UserPrompt == "" {
		return nil, validationError("user_prompt is required", map[string]string{"user_prompt": "required"})
	}
	t := &model.PromptTemplate{
		ID:           id,
		TenantID:     tenantID,
		Name:         req.Name,
		Description:  req.Description,
		Category:     req.Category,
		SystemPrompt: req.SystemPrompt,
		UserPrompt:   req.UserPrompt,
		Variables:    req.Variables,
		Metadata:     req.Metadata,
	}
	if err := s.prompts.Update(ctx, s.db, t, userID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("prompt template not found")
		}
		if isUniqueViolation(err) {
			return nil, conflictError("a prompt template with this name already exists")
		}
		return nil, internalError("update prompt template", err)
	}
	return t, nil
}

// GetPrompt returns a single template (AID-09).
func (s *DraftingService) GetPrompt(ctx context.Context, tenantID, id uuid.UUID) (*model.PromptTemplate, error) {
	if err := s.promptLibraryReady(); err != nil {
		return nil, err
	}
	t, err := s.prompts.Get(ctx, tenantID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("prompt template not found")
		}
		return nil, internalError("get prompt template", err)
	}
	return t, nil
}

// ListPrompts returns a tenant's templates (AID-09).
func (s *DraftingService) ListPrompts(ctx context.Context, tenantID uuid.UUID, page, perPage int) ([]model.PromptTemplate, int, error) {
	if err := s.promptLibraryReady(); err != nil {
		return nil, 0, err
	}
	items, total, err := s.prompts.List(ctx, tenantID, page, perPage)
	if err != nil {
		return nil, 0, internalError("list prompt templates", err)
	}
	return items, total, nil
}

// DeletePrompt soft-deletes a template (AID-09).
func (s *DraftingService) DeletePrompt(ctx context.Context, tenantID, id uuid.UUID) error {
	if err := s.promptLibraryReady(); err != nil {
		return err
	}
	if err := s.prompts.SoftDelete(ctx, tenantID, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFoundError("prompt template not found")
		}
		return internalError("delete prompt template", err)
	}
	return nil
}

// RunPrompt substitutes the supplied variables into a saved template and runs it
// against the governed per-tenant LLM (AID-09). Declared template variables that
// are not supplied are rejected so a run never silently emits unfilled
// placeholders.
func (s *DraftingService) RunPrompt(ctx context.Context, tenantID, id uuid.UUID, req dto.RunPromptRequest) (*drafting.PromptRunResult, error) {
	if err := s.promptLibraryReady(); err != nil {
		return nil, err
	}
	tmpl, err := s.GetPrompt(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if missing := missingVars(tmpl.Variables, req.Variables); len(missing) > 0 {
		return nil, validationError("missing required variables: "+strings.Join(missing, ", "), nil)
	}
	sysPrompt, _ := drafting.Substitute(tmpl.SystemPrompt, req.Variables)
	userPrompt, _ := drafting.Substitute(tmpl.UserPrompt, req.Variables)
	out, err := s.drafter.RunPrompt(ctx, tenantID, sysPrompt, userPrompt)
	return out, s.mapDraftErr(err)
}

func missingVars(declared []string, supplied map[string]any) []string {
	var missing []string
	for _, v := range declared {
		if _, ok := supplied[v]; !ok {
			missing = append(missing, v)
		}
	}
	return missing
}
