package rehearsalproof

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/gameday"
	drmodel "github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/runbookstudio"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

type proofService interface {
	GameDayProof(ctx context.Context, tenantID uuid.UUID, runID string) (*ProofRecord, error)
	RunbookProof(ctx context.Context, tenantID uuid.UUID, runID string) (*ProofRecord, error)
	FailoverDrillProof(ctx context.Context, tenantID, runID uuid.UUID) (*ProofRecord, error)

	SealingEnabled() bool

	GenerateGameDayProof(ctx context.Context, tenantID uuid.UUID, runID string) (*SealedProof, error)
	GenerateRunbookProof(ctx context.Context, tenantID uuid.UUID, runID string) (*SealedProof, error)
	GenerateFailoverDrillProof(ctx context.Context, tenantID, runID uuid.UUID) (*SealedProof, error)

	GetPersistedGameDayProof(ctx context.Context, tenantID uuid.UUID, runID string) (*SealedProof, error)
	GetPersistedRunbookProof(ctx context.Context, tenantID uuid.UUID, runID string) (*SealedProof, error)
	GetPersistedFailoverDrillProof(ctx context.Context, tenantID uuid.UUID, runID string) (*SealedProof, error)
}

type Router struct {
	svc    proofService
	logger zerolog.Logger
}

func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-rehearsal-proof").Logger()}
}

func newRouter(svc proofService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes exposes proof envelopes for real rehearsal records.
//
// Compute (backward-compat, dr:read) — returns the freshly-assembled envelope:
//
//	GET  /api/v1/dr/rehearsal-proofs/gameday/{runID}
//	GET  /api/v1/dr/rehearsal-proofs/runbook-runs/{runID}
//	GET  /api/v1/dr/rehearsal-proofs/failover-runs/{runID}
//
// Persisted (dr:read) — returns the stored, signed, WORM-sealed, ledger-anchored
// proof with its signature + ledger inclusion reference:
//
//	GET  /api/v1/dr/rehearsal-proofs/gameday/{runID}/sealed
//	GET  /api/v1/dr/rehearsal-proofs/runbook-runs/{runID}/sealed
//	GET  /api/v1/dr/rehearsal-proofs/failover-runs/{runID}/sealed
//
// Seal (dr:write) — assembles, signs, seals, anchors and persists a proof:
//
//	POST /api/v1/dr/rehearsal-proofs/gameday/{runID}/seal
//	POST /api/v1/dr/rehearsal-proofs/runbook-runs/{runID}/seal
//	POST /api/v1/dr/rehearsal-proofs/failover-runs/{runID}/seal
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/rehearsal-proofs/gameday/{runID}", h.getGameDay)
		r.Get("/rehearsal-proofs/runbook-runs/{runID}", h.getRunbook)
		r.Get("/rehearsal-proofs/failover-runs/{runID}", h.getFailover)

		r.Get("/rehearsal-proofs/gameday/{runID}/sealed", h.getSealedGameDay)
		r.Get("/rehearsal-proofs/runbook-runs/{runID}/sealed", h.getSealedRunbook)
		r.Get("/rehearsal-proofs/failover-runs/{runID}/sealed", h.getSealedFailover)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/rehearsal-proofs/gameday/{runID}/seal", h.sealGameDay)
		r.Post("/rehearsal-proofs/runbook-runs/{runID}/seal", h.sealRunbook)
		r.Post("/rehearsal-proofs/failover-runs/{runID}/seal", h.sealFailover)
	})

	return r
}

func (h *Router) getGameDay(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	runID, err := suiteapi.UUIDParam(r, "runID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	proof, err := h.svc.GameDayProof(r.Context(), tenantID, runID.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, proof)
}

func (h *Router) getRunbook(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	runID, err := suiteapi.UUIDParam(r, "runID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	proof, err := h.svc.RunbookProof(r.Context(), tenantID, runID.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, proof)
}

func (h *Router) getFailover(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	runID, err := suiteapi.UUIDParam(r, "runID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	proof, err := h.svc.FailoverDrillProof(r.Context(), tenantID, runID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, proof)
}

// --- sealed (persisted) GET handlers ---

func (h *Router) getSealedGameDay(w http.ResponseWriter, r *http.Request) {
	h.getSealed(w, r, func(ctx context.Context, tenantID, runID uuid.UUID) (*SealedProof, error) {
		return h.svc.GetPersistedGameDayProof(ctx, tenantID, runID.String())
	})
}

func (h *Router) getSealedRunbook(w http.ResponseWriter, r *http.Request) {
	h.getSealed(w, r, func(ctx context.Context, tenantID, runID uuid.UUID) (*SealedProof, error) {
		return h.svc.GetPersistedRunbookProof(ctx, tenantID, runID.String())
	})
}

func (h *Router) getSealedFailover(w http.ResponseWriter, r *http.Request) {
	h.getSealed(w, r, func(ctx context.Context, tenantID, runID uuid.UUID) (*SealedProof, error) {
		return h.svc.GetPersistedFailoverDrillProof(ctx, tenantID, runID.String())
	})
}

func (h *Router) getSealed(w http.ResponseWriter, r *http.Request, load func(context.Context, uuid.UUID, uuid.UUID) (*SealedProof, error)) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	if !h.svc.SealingEnabled() {
		suiteapi.WriteError(w, r, http.StatusNotImplemented, "sealing_disabled", ErrSealingDisabled.Error(), nil)
		return
	}
	runID, err := suiteapi.UUIDParam(r, "runID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	proof, err := load(r.Context(), tenantID, runID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, proof)
}

// --- seal (persist-on-generate) POST handlers ---

func (h *Router) sealGameDay(w http.ResponseWriter, r *http.Request) {
	h.seal(w, r, func(ctx context.Context, tenantID, runID uuid.UUID) (*SealedProof, error) {
		return h.svc.GenerateGameDayProof(ctx, tenantID, runID.String())
	})
}

func (h *Router) sealRunbook(w http.ResponseWriter, r *http.Request) {
	h.seal(w, r, func(ctx context.Context, tenantID, runID uuid.UUID) (*SealedProof, error) {
		return h.svc.GenerateRunbookProof(ctx, tenantID, runID.String())
	})
}

func (h *Router) sealFailover(w http.ResponseWriter, r *http.Request) {
	h.seal(w, r, func(ctx context.Context, tenantID, runID uuid.UUID) (*SealedProof, error) {
		return h.svc.GenerateFailoverDrillProof(ctx, tenantID, runID)
	})
}

func (h *Router) seal(w http.ResponseWriter, r *http.Request, gen func(context.Context, uuid.UUID, uuid.UUID) (*SealedProof, error)) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	if !h.svc.SealingEnabled() {
		suiteapi.WriteError(w, r, http.StatusNotImplemented, "sealing_disabled", ErrSealingDisabled.Error(), nil)
		return
	}
	runID, err := suiteapi.UUIDParam(r, "runID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	proof, err := gen(r.Context(), tenantID, runID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, proof)
}

func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, gameday.ErrRunNotFound), errors.Is(err, runbookstudio.ErrNotFound), errors.Is(err, drmodel.ErrNotFound), errors.Is(err, ErrProofNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrSealingDisabled):
		suiteapi.WriteError(w, r, http.StatusNotImplemented, "sealing_disabled", err.Error(), nil)
	case errors.Is(err, ErrDuplicate):
		suiteapi.WriteError(w, r, http.StatusConflict, "already_sealed", err.Error(), nil)
	case errors.Is(err, ErrRunNotRehearsal):
		suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "not_rehearsal", err.Error(), nil)
	case errors.Is(err, ErrMissingRun), errors.Is(err, ErrMissingTenant), errors.Is(err, ErrUnsupportedRunType):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr rehearsal proof request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

var _ proofService = (*Service)(nil)
