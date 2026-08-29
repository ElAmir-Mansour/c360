package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/drafting"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

const pleadingGenerationTimeout = 60 * time.Second

type PleadingGenerationStatus string

const (
	PleadingGenerationQueued    PleadingGenerationStatus = "queued"
	PleadingGenerationRunning   PleadingGenerationStatus = "running"
	PleadingGenerationCompleted PleadingGenerationStatus = "completed"
	PleadingGenerationFailed    PleadingGenerationStatus = "failed"
	PleadingGenerationCancelled PleadingGenerationStatus = "cancelled"
)

// PleadingGenerationState is stored inside legal_pleadings.metadata so browser
// reconnects can recover the latest partial text and terminal result without an
// additional queue/database migration.
type PleadingGenerationState struct {
	JobID        uuid.UUID                `json:"job_id"`
	PleadingID   uuid.UUID                `json:"pleading_id"`
	Status       PleadingGenerationStatus `json:"status"`
	Progress     int                      `json:"progress"`
	PartialBody  string                   `json:"body,omitempty"`
	ErrorCode    string                   `json:"error_code,omitempty"`
	ErrorMessage string                   `json:"error_message,omitempty"`
	Model        string                   `json:"model,omitempty"`
	Language     string                   `json:"language,omitempty"`
	DraftPrompt  string                   `json:"draft_prompt,omitempty"`
	BaseVersion  int                      `json:"base_version"`
	StartedAt    time.Time                `json:"started_at"`
	UpdatedAt    time.Time                `json:"updated_at"`
	CompletedAt  *time.Time               `json:"completed_at,omitempty"`
}

type PleadingGenerationEvent struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

type pleadingGenerationRuntime struct {
	jobID     uuid.UUID
	cancel    context.CancelFunc
	cancelled atomic.Bool

	mu          sync.Mutex
	closed      bool
	subscribers map[chan PleadingGenerationEvent]struct{}
}

func newPleadingGenerationRuntime(jobID uuid.UUID, cancel context.CancelFunc) *pleadingGenerationRuntime {
	return &pleadingGenerationRuntime{
		jobID:       jobID,
		cancel:      cancel,
		subscribers: make(map[chan PleadingGenerationEvent]struct{}),
	}
}

func (r *pleadingGenerationRuntime) subscribe() (<-chan PleadingGenerationEvent, func()) {
	ch := make(chan PleadingGenerationEvent, 128)
	r.mu.Lock()
	if r.closed {
		close(ch)
	} else {
		r.subscribers[ch] = struct{}{}
	}
	r.mu.Unlock()
	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			r.mu.Lock()
			if _, ok := r.subscribers[ch]; ok {
				delete(r.subscribers, ch)
				close(ch)
			}
			r.mu.Unlock()
		})
	}
	return ch, unsubscribe
}

func (r *pleadingGenerationRuntime) broadcast(event PleadingGenerationEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	for ch := range r.subscribers {
		select {
		case ch <- event:
		default:
			// Slow/disconnected clients can recover the latest partial body from
			// GET /generation; never let a browser stall the provider stream.
		}
	}
}

func (r *pleadingGenerationRuntime) close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	r.closed = true
	for ch := range r.subscribers {
		close(ch)
		delete(r.subscribers, ch)
	}
}

func (s *LitigationPleadingService) StartPleadingGeneration(
	ctx context.Context,
	tenantID, userID, caseID, pleadingID uuid.UUID,
	req dto.GeneratePleadingRequest,
) (*PleadingGenerationState, <-chan PleadingGenerationEvent, func(), error) {
	req.Normalize()
	if s.drafter == nil || !s.drafter.Enabled() {
		return nil, nil, nil, draftingUnavailable()
	}
	p, err := s.pleadings.Get(ctx, tenantID, caseID, pleadingID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, nil, notFoundError("pleading not found")
		}
		return nil, nil, nil, internalError("load pleading", err)
	}
	if p.Status != model.PleadingStatusDraft && p.Status != model.PleadingStatusRejected {
		return nil, nil, nil, conflictError("only draft or rejected pleadings can be generated")
	}
	c, err := s.loadCase(ctx, tenantID, caseID)
	if err != nil {
		return nil, nil, nil, err
	}

	s.generationMu.Lock()
	if active := s.generations[pleadingID]; active != nil {
		s.generationMu.Unlock()
		return nil, nil, nil, conflictError("pleading generation is already running")
	}
	jobID := uuid.New()
	runCtx, cancel := context.WithTimeout(context.Background(), pleadingGenerationTimeout)
	runtime := newPleadingGenerationRuntime(jobID, cancel)
	s.generations[pleadingID] = runtime
	events, unsubscribe := runtime.subscribe()
	s.generationMu.Unlock()

	now := s.now().UTC()
	state := &PleadingGenerationState{
		JobID:       jobID,
		PleadingID:  pleadingID,
		Status:      PleadingGenerationQueued,
		Language:    req.Language,
		DraftPrompt: req.DraftPrompt,
		BaseVersion: p.CurrentVersion,
		StartedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.pleadings.SetGenerationMetadata(ctx, tenantID, caseID, pleadingID, jobID, state, false); err != nil {
		cancel()
		runtime.close()
		s.removePleadingGeneration(pleadingID, runtime)
		return nil, nil, nil, internalError("persist pleading generation state", err)
	}

	go s.runPleadingGeneration(runCtx, runtime, tenantID, userID, caseID, c, p, req, state)
	return state, events, unsubscribe, nil
}

func (s *LitigationPleadingService) RetryPleadingGeneration(
	ctx context.Context,
	tenantID, userID, caseID, pleadingID uuid.UUID,
	req dto.GeneratePleadingRequest,
) (*PleadingGenerationState, <-chan PleadingGenerationEvent, func(), error) {
	previous, err := s.GetPleadingGeneration(ctx, tenantID, caseID, pleadingID)
	if err != nil {
		return nil, nil, nil, err
	}
	if previous.Status == PleadingGenerationQueued || previous.Status == PleadingGenerationRunning {
		return nil, nil, nil, conflictError("pleading generation is already running")
	}
	if strings.TrimSpace(req.Language) == "" {
		req.Language = previous.Language
	}
	if strings.TrimSpace(req.DraftPrompt) == "" {
		req.DraftPrompt = previous.DraftPrompt
	}
	return s.StartPleadingGeneration(ctx, tenantID, userID, caseID, pleadingID, req)
}

func (s *LitigationPleadingService) GetPleadingGeneration(
	ctx context.Context,
	tenantID, caseID, pleadingID uuid.UUID,
) (*PleadingGenerationState, error) {
	p, err := s.pleadings.Get(ctx, tenantID, caseID, pleadingID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("pleading not found")
		}
		return nil, internalError("load pleading generation", err)
	}
	state := pleadingGenerationFromMetadata(p.Metadata)
	if state == nil {
		return nil, notFoundError("pleading generation has not been started")
	}

	// A process restart detaches in-memory work. Report it as retryable instead
	// of leaving the client permanently stuck on "generating".
	if state.Status == PleadingGenerationQueued || state.Status == PleadingGenerationRunning {
		s.generationMu.Lock()
		runtime := s.generations[pleadingID]
		s.generationMu.Unlock()
		if runtime == nil || runtime.jobID != state.JobID {
			now := s.now().UTC()
			state.Status = PleadingGenerationFailed
			state.ErrorCode = "DRAFTING_INTERRUPTED"
			state.ErrorMessage = "generation was interrupted and can be retried"
			state.UpdatedAt = now
			state.CompletedAt = &now
			if err := s.pleadings.SetGenerationMetadata(ctx, tenantID, caseID, pleadingID, state.JobID, state, true); err != nil {
				return nil, internalError("reconcile pleading generation", err)
			}
		}
	}
	return state, nil
}

func (s *LitigationPleadingService) SubscribePleadingGeneration(
	ctx context.Context,
	tenantID, caseID, pleadingID uuid.UUID,
) (*PleadingGenerationState, <-chan PleadingGenerationEvent, func(), error) {
	state, err := s.GetPleadingGeneration(ctx, tenantID, caseID, pleadingID)
	if err != nil {
		return nil, nil, nil, err
	}
	s.generationMu.Lock()
	runtime := s.generations[pleadingID]
	s.generationMu.Unlock()
	if runtime == nil || runtime.jobID != state.JobID {
		ch := make(chan PleadingGenerationEvent, 1)
		ch <- PleadingGenerationEvent{Type: "snapshot", Data: state}
		close(ch)
		return state, ch, func() {}, nil
	}
	ch, unsubscribe := runtime.subscribe()
	runtime.broadcast(PleadingGenerationEvent{Type: "snapshot", Data: state})
	return state, ch, unsubscribe, nil
}

func (s *LitigationPleadingService) CancelPleadingGeneration(
	ctx context.Context,
	tenantID, caseID, pleadingID uuid.UUID,
) (*PleadingGenerationState, error) {
	state, err := s.GetPleadingGeneration(ctx, tenantID, caseID, pleadingID)
	if err != nil {
		return nil, err
	}
	if state.Status == PleadingGenerationCompleted || state.Status == PleadingGenerationFailed || state.Status == PleadingGenerationCancelled {
		return state, nil
	}

	s.generationMu.Lock()
	runtime := s.generations[pleadingID]
	s.generationMu.Unlock()
	if runtime != nil && runtime.jobID == state.JobID {
		runtime.cancelled.Store(true)
		runtime.cancel()
	}
	now := s.now().UTC()
	state.Status = PleadingGenerationCancelled
	state.UpdatedAt = now
	state.CompletedAt = &now
	if err := s.pleadings.SetGenerationMetadata(ctx, tenantID, caseID, pleadingID, state.JobID, state, true); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return s.GetPleadingGeneration(ctx, tenantID, caseID, pleadingID)
		}
		return nil, internalError("cancel pleading generation", err)
	}
	if runtime != nil && runtime.jobID == state.JobID {
		runtime.broadcast(PleadingGenerationEvent{Type: "cancelled", Data: state})
		runtime.close()
		s.removePleadingGeneration(pleadingID, runtime)
	}
	return state, nil
}

func (s *LitigationPleadingService) runPleadingGeneration(
	ctx context.Context,
	runtime *pleadingGenerationRuntime,
	tenantID, userID, caseID uuid.UUID,
	c *model.LegalCase,
	p *model.LegalPleading,
	req dto.GeneratePleadingRequest,
	initial *PleadingGenerationState,
) {
	defer runtime.cancel()
	defer s.removePleadingGeneration(p.ID, runtime)

	state := *initial
	state.Status = PleadingGenerationRunning
	state.Progress = 2
	state.UpdatedAt = s.now().UTC()
	_ = s.pleadings.SetGenerationMetadata(context.Background(), tenantID, caseID, p.ID, runtime.jobID, &state, true)
	runtime.broadcast(PleadingGenerationEvent{Type: "generation_started", Data: &state})

	draftReq := drafting.PleadingDraftRequest{
		PleadingType:    string(p.Type),
		Direction:       string(p.Direction),
		PleadingTitle:   p.Title,
		CaseNumber:      c.CaseNumber,
		CaseType:        c.CaseType,
		CompanyStatus:   string(c.CompanyStatus),
		CaseTitleAR:     c.Title.AR,
		CaseTitleEN:     c.Title.EN,
		CaseDescription: c.Description,
		Recipient:       pleadingOptionalString(p.Recipient),
		CourtReference: pleadingOptionalString(
			p.CourtReference,
		),
		Instructions: req.DraftPrompt,
		Language:     req.Language,
	}

	var partial strings.Builder
	lastPersist := time.Time{}
	emit := func(delta string) {
		if delta == "" || runtime.cancelled.Load() {
			return
		}
		partial.WriteString(delta)
		state.Progress = pleadingGenerationProgress(partial.Len())
		runtime.broadcast(PleadingGenerationEvent{
			Type: "delta",
			Data: map[string]any{
				"text":     delta,
				"progress": state.Progress,
			},
		})
		if time.Since(lastPersist) < 500*time.Millisecond {
			return
		}
		lastPersist = time.Now()
		state.PartialBody = partial.String()
		state.UpdatedAt = s.now().UTC()
		_ = s.pleadings.SetGenerationMetadata(context.Background(), tenantID, caseID, p.ID, runtime.jobID, &state, true)
	}

	out, err := s.drafter.DraftPleadingStream(ctx, tenantID, draftReq, emit)
	if runtime.cancelled.Load() {
		return
	}
	if err != nil {
		state.PartialBody = partial.String()
		state.Status = PleadingGenerationFailed
		state.ErrorCode, state.ErrorMessage = pleadingGenerationError(err)
		now := s.now().UTC()
		state.UpdatedAt = now
		state.CompletedAt = &now
		_ = s.pleadings.SetGenerationMetadata(context.Background(), tenantID, caseID, p.ID, runtime.jobID, &state, true)
		runtime.broadcast(PleadingGenerationEvent{
			Type: "generation_failed",
			Data: map[string]any{
				"code":      state.ErrorCode,
				"message":   state.ErrorMessage,
				"can_retry": true,
			},
		})
		runtime.close()
		return
	}

	body := strings.TrimSpace(out.Body)
	if body == "" {
		body = strings.TrimSpace(partial.String())
	}
	state.PartialBody = body
	state.Status = PleadingGenerationCompleted
	state.Progress = 100
	state.ErrorCode = ""
	state.ErrorMessage = ""
	state.Model = generationModel(out.Meta)
	now := s.now().UTC()
	state.UpdatedAt = now
	state.CompletedAt = &now

	updated, err := s.applyGeneratedPleading(context.Background(), tenantID, userID, caseID, p.ID, body, &state)
	if err != nil {
		state.Status = PleadingGenerationFailed
		state.ErrorCode = "DRAFTING_SAVE_FAILED"
		state.ErrorMessage = "the generated pleading could not be saved"
		state.UpdatedAt = s.now().UTC()
		_ = s.pleadings.SetGenerationMetadata(context.Background(), tenantID, caseID, p.ID, runtime.jobID, &state, true)
		runtime.broadcast(PleadingGenerationEvent{
			Type: "generation_failed",
			Data: map[string]any{
				"code":      state.ErrorCode,
				"message":   state.ErrorMessage,
				"can_retry": true,
			},
		})
		runtime.close()
		s.logger.Error().Err(err).Str("pleading_id", p.ID.String()).Msg("save generated pleading")
		return
	}
	runtime.broadcast(PleadingGenerationEvent{
		Type: "generation_completed",
		Data: map[string]any{
			"pleading_id": state.PleadingID,
			"job_id":      state.JobID,
			"body":        state.PartialBody,
			"progress":    100,
			"generation":  &state,
			"pleading":    updated,
		},
	})
	runtime.close()
}

func (s *LitigationPleadingService) applyGeneratedPleading(
	ctx context.Context,
	tenantID, userID, caseID, pleadingID uuid.UUID,
	body string,
	state *PleadingGenerationState,
) (*model.LegalPleading, error) {
	if strings.TrimSpace(body) == "" {
		return nil, validationError("generated pleading body is empty", map[string]string{"body": "required"})
	}
	p, err := s.pleadings.Get(ctx, tenantID, caseID, pleadingID)
	if err != nil {
		return nil, err
	}
	if p.Status != model.PleadingStatusDraft && p.Status != model.PleadingStatusRejected {
		return nil, conflictError("only draft or rejected pleadings can be generated")
	}
	if p.CurrentVersion != state.BaseVersion {
		return nil, conflictError("pleading was edited while generation was running")
	}
	current := pleadingGenerationFromMetadata(p.Metadata)
	if current == nil || current.JobID != state.JobID {
		return nil, conflictError("a newer pleading generation has already started")
	}
	p.Body = strings.TrimSpace(body)
	p.AIGenerated = true
	p.CurrentVersion++
	p.Metadata = withPleadingGeneration(p.Metadata, state)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start generated pleading transaction", err)
	}
	defer tx.Rollback(ctx)
	var lockedJobID, lockedStatus string
	if err := tx.QueryRow(ctx, `
		SELECT
			COALESCE(metadata #>> '{ai_generation,job_id}', ''),
			COALESCE(metadata #>> '{ai_generation,status}', '')
		FROM legal_pleadings
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, caseID, pleadingID,
	).Scan(&lockedJobID, &lockedStatus); err != nil {
		return nil, internalError("lock generated pleading", err)
	}
	if lockedJobID != state.JobID.String() ||
		lockedStatus == string(PleadingGenerationCancelled) ||
		lockedStatus == string(PleadingGenerationCompleted) ||
		lockedStatus == string(PleadingGenerationFailed) {
		return nil, conflictError("pleading generation is no longer active")
	}
	if err := s.pleadings.UpdateDraft(ctx, tx, p); err != nil {
		return nil, internalError("save generated pleading", err)
	}
	version := &model.LegalPleadingVersion{
		ID:           uuid.New(),
		TenantID:     tenantID,
		PleadingID:   pleadingID,
		Title:        p.Title,
		Body:         p.Body,
		AIGenerated:  true,
		ChangeReason: "ai_generation_completed",
		CreatedBy:    &userID,
	}
	if err := s.pleadings.AppendVersion(ctx, tx, version); err != nil {
		return nil, internalError("append generated pleading version", err)
	}
	if err := s.appendPleadingAudit(ctx, tx, p, userID, "pleading.ai_generated", nil, nil, nil, nil, pleadingAuditState(p), map[string]any{
		"version": p.CurrentVersion,
		"job_id":  state.JobID,
		"model":   state.Model,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit generated pleading", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.pleading.ai_generated", tenantID, &userID, map[string]any{
		"id": p.ID, "case_id": caseID, "version": p.CurrentVersion, "job_id": state.JobID,
	}, s.logger)
	return s.GetPleading(ctx, tenantID, caseID, pleadingID)
}

func (s *LitigationPleadingService) removePleadingGeneration(pleadingID uuid.UUID, runtime *pleadingGenerationRuntime) {
	s.generationMu.Lock()
	if s.generations[pleadingID] == runtime {
		delete(s.generations, pleadingID)
	}
	s.generationMu.Unlock()
}

func pleadingGenerationFromMetadata(metadata map[string]any) *PleadingGenerationState {
	if metadata == nil {
		return nil
	}
	raw, ok := metadata["ai_generation"]
	if !ok || raw == nil {
		return nil
	}
	payload, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var state PleadingGenerationState
	if err := json.Unmarshal(payload, &state); err != nil || state.JobID == uuid.Nil {
		return nil
	}
	return &state
}

func withPleadingGeneration(metadata map[string]any, state *PleadingGenerationState) map[string]any {
	out := make(map[string]any, len(metadata)+1)
	for key, value := range metadata {
		out[key] = value
	}
	payload, _ := json.Marshal(state)
	var normalized map[string]any
	_ = json.Unmarshal(payload, &normalized)
	out["ai_generation"] = normalized
	return out
}

func pleadingGenerationError(err error) (string, string) {
	mapped := mapDraftingError(err)
	var appErr *apperrors.AppError
	if errors.As(mapped, &appErr) {
		message := appErr.Message
		if message == "" {
			message = appErr.Code
		}
		return appErr.Code, message
	}
	return "DRAFTING_PROVIDER_ERROR", "AI pleading generation failed"
}

func generationModel(meta map[string]any) string {
	if meta == nil {
		return ""
	}
	if modelName, ok := meta["model"].(string); ok {
		return modelName
	}
	return ""
}

func pleadingGenerationProgress(bodyBytes int) int {
	if bodyBytes <= 0 {
		return 2
	}
	progress := 5 + (bodyBytes * 90 / 9000)
	if progress > 95 {
		return 95
	}
	return progress
}

func pleadingOptionalString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
